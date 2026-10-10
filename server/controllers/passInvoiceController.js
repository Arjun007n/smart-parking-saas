const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const passes = require("../services/passService");
const { escapeRegex } = require("../utils/plate");
const { getAccessibleLocation, locationScopedFilter } = require("../utils/scope");
const { round2 } = require("../services/collectionService");
const { respond, wantsExport, pageFrom, CSV_LIMIT } = require("./reportController");
const passController = require("./passController");
const Company = require("../models/Company");
const Location = require("../models/Location");
const Pass = require("../models/Pass");
const PassCompany = require("../models/PassCompany");
const PassUser = require("../models/PassUser");
const PassInvoice = require("../models/PassInvoice");

const LIMITS = [25, 50, 100, 200, 500, 1000, 2000];
const DEFAULT_TAX = 18;
const FIRST_NUMBER = 100001;
const toId = (id) => new mongoose.Types.ObjectId(String(id));

// The tax rate of an invoice: the one typed, else the company's pass GST rate, else 18%.
const taxRateFor = async (companyId, requested) => {
  if (requested !== undefined && requested !== null) return requested;
  const company = await Company.findById(companyId).select("passGstPercent").lean();
  return company && company.passGstPercent > 0 ? company.passGstPercent : DEFAULT_TAX;
};

// The passes that can still be put on an invoice for one location and one company (or one user with no company).
const eligibleFilter = (req, { locationId, passCompanyId, passUserId }) => {
  const conditions = [
    passes.scopeFilter(req),
    { status: { $ne: "CANCELLED" } },
    { approval: { $ne: "PENDING" } },
    { passInvoiceId: { $exists: false } },
    { $or: [{ locationIds: toId(locationId) }, { "locationIds.0": { $exists: false } }] },
  ];
  if (passCompanyId && passCompanyId !== "none") conditions.push({ passCompanyId: toId(passCompanyId) });
  else {
    conditions.push({ passCompanyId: { $exists: false } });
    if (passUserId) conditions.push({ passUserId: toId(passUserId) });
  }
  return { $and: conditions };
};

const checkChoice = async (req, { locationId, passCompanyId, passUserId }) => {
  if (!locationId) throw new AppError("Please select location.", 400);
  if (!passCompanyId) throw new AppError("Please select company.", 400);
  if (passCompanyId === "none" && !passUserId) throw new AppError("Please select User Name from dropdown when No Company is selected.", 400);
  for (const [name, value] of [["locationId", locationId], ["passUserId", passUserId]]) {
    if (value && !mongoose.isValidObjectId(value)) throw new AppError(`Invalid ${name}`, 400);
  }
  if (passCompanyId !== "none" && !mongoose.isValidObjectId(passCompanyId)) throw new AppError("Invalid company", 400);
  const location = await getAccessibleLocation(req, locationId);
  return location;
};

// GET /api/pass-invoices/eligible?locationId=&passCompanyId=(id|none)&passUserId=
// The passes you can tick to make an invoice.
const eligible = async (req, res) => {
  const choice = { locationId: req.query.locationId, passCompanyId: req.query.passCompanyId, passUserId: req.query.passUserId };
  await checkChoice(req, choice);
  const list = await Pass.find(eligibleFilter(req, choice)).sort({ startDate: 1, _id: 1 }).limit(500);
  const amountOf = await passController.amountsOf(list);
  const [companies, locations] = await Promise.all([
    PassCompany.find({ _id: { $in: list.map((p) => p.passCompanyId).filter(Boolean) } }).select("name").lean(),
    Location.find({ _id: { $in: list.flatMap((p) => p.locationIds) } }).select("name").lean(),
  ]);
  const companyName = new Map(companies.map((c) => [String(c._id), c.name]));
  const locationName = new Map(locations.map((l) => [String(l._id), l.name]));
  const rows = list
    .map((pass) => ({
      _id: pass._id, passNumber: pass.passNumber, company: pass.passCompanyId ? companyName.get(String(pass.passCompanyId)) || "" : "",
      userName: pass.holderName, mobile: pass.phone || "", email: pass.email || "",
      vehicles: passes.passVehicles(pass).map((v) => v.number), vehicleType: pass.vehicleType,
      locations: pass.locationIds.length ? pass.locationIds.map((id) => locationName.get(String(id))).filter(Boolean) : [],
      startDate: pass.startDate, endDate: pass.endDate, amount: amountOf(pass), state: passes.passState(pass),
    }))
    .filter((row) => row.amount > 0);
  res.json({ success: true, data: { passes: rows } });
};

// Loads and checks the passes chosen for an invoice, and works the money out.
const build = async (req, body) => {
  const { locationId, passCompanyId, passUserId } = body;
  const location = await checkChoice(req, { locationId, passCompanyId, passUserId });
  const ids = [...new Set(body.passIds || [])];
  if (ids.length === 0) throw new AppError("Please select at least one pass.", 400);
  const found = await Pass.find({ $and: [eligibleFilter(req, { locationId, passCompanyId, passUserId }), { _id: { $in: ids.map(toId) } }] });
  if (found.length !== ids.length) {
    throw new AppError("Some of these passes can no longer be invoiced (already on an invoice, cancelled or waiting for approval). Reload the list.", 409);
  }
  const amountOf = await passController.amountsOf(found);
  const total = round2(found.reduce((sum, p) => sum + amountOf(p), 0));
  if (total <= 0) throw new AppError("These passes have no charges to invoice", 400);
  const taxPercent = await taxRateFor(location.companyId, body.taxPercent);
  const tax = passes.taxIncluded(total, taxPercent);
  const vehicles = [...new Set(found.flatMap((p) => passes.passVehicles(p).map((v) => v.number)))];

  let billTo;
  if (passCompanyId !== "none") {
    const company = await PassCompany.findOne({ _id: passCompanyId, ...req.tenantFilter });
    if (!company) throw new AppError("Company not found", 404);
    billTo = { name: company.name, address: company.address || "", gstNumber: company.gstNumber || "", mobile: company.phone || "", email: company.email || "" };
  } else {
    const user = await PassUser.findOne({ _id: passUserId, ...req.tenantFilter });
    if (!user) throw new AppError("Pass user not found", 404);
    billTo = { name: user.name, address: user.address || "", gstNumber: user.gstNumber || "", mobile: user.mobile || "", email: user.email || "" };
  }
  return {
    location, passes: found, vehicles, billTo, taxPercent,
    figures: { quantity: vehicles.length, total, tax, taxable: round2(total - tax) },
  };
};

// POST /api/pass-invoices/preview   { locationId, passCompanyId (id | "none"), passUserId?, passIds, taxPercent? }
const preview = async (req, res) => {
  const built = await build(req, req.body);
  const company = await Company.findById(built.location.companyId).lean();
  res.json({
    success: true,
    data: {
      billTo: built.billTo, vehicles: built.vehicles, taxPercent: built.taxPercent, ...built.figures,
      seller: sellerOf(built.location, company), description: "Vehicle Parking Pass", invoiceDate: new Date(),
    },
  });
};

// Counts invoices up from 100001 inside the company.
const nextNumber = async (companyId) => {
  const last = await PassInvoice.findOne({ companyId }).sort({ invoiceNumber: -1 }).select("invoiceNumber").lean();
  return last ? last.invoiceNumber + 1 : FIRST_NUMBER;
};

// POST /api/pass-invoices   (same body as the preview)
// Makes the invoice and marks its passes as billed.
const generate = async (req, res) => {
  const built = await build(req, req.body);
  const { location } = built;
  const base = {
    companyId: location.companyId, locationId: location._id, invoiceDate: new Date(),
    ...(req.body.passCompanyId !== "none" ? { passCompanyId: req.body.passCompanyId } : {}),
    ...(req.body.passUserId ? { passUserId: req.body.passUserId } : {}),
    billTo: built.billTo, passIds: built.passes.map((p) => p._id), vehicles: built.vehicles,
    taxPercent: built.taxPercent, ...built.figures, createdBy: req.user._id,
  };

  let invoice;
  for (let attempt = 0; attempt < 5 && !invoice; attempt += 1) {
    try {
      invoice = await PassInvoice.create({ ...base, invoiceNumber: await nextNumber(location.companyId) });
    } catch (error) {
      if (!(error.code === 11000 && error.keyPattern && error.keyPattern.invoiceNumber)) throw error;
    }
  }
  if (!invoice) throw new AppError("Could not make an invoice number. Please try again.", 503);

  // Only passes nobody has billed in the meantime: two people cannot invoice the same pass twice.
  const marked = await Pass.updateMany({ _id: { $in: base.passIds }, passInvoiceId: { $exists: false } }, { $set: { passInvoiceId: invoice._id } });
  if (marked.modifiedCount !== base.passIds.length) {
    await Pass.updateMany({ passInvoiceId: invoice._id }, { $unset: { passInvoiceId: "" } });
    await PassInvoice.deleteOne({ _id: invoice._id });
    throw new AppError("Some of these passes were just put on another invoice. Reload the list.", 409);
  }
  await audit.record(req, "PASS_INVOICE_CREATE", {
    entity: "PassInvoice", entityId: invoice._id, companyId: invoice.companyId,
    meta: { invoiceNumber: invoice.invoiceNumber, passes: base.passIds.length, total: invoice.total },
  });
  res.status(201).json({ success: true, data: invoice });
};

// GET /api/pass-invoices?locationId=&passCompanyId=&passUserId=&q=&limit=&page=      (+ ?format=)
const list = async (req, res) => {
  const filter = { ...locationScopedFilter(req) };
  if (req.query.locationId) {
    if (!mongoose.isValidObjectId(req.query.locationId)) throw new AppError("Invalid locationId", 400);
    const scoped = locationScopedFilter(req).locationId;
    if (scoped && !scoped.$in.some((id) => String(id) === req.query.locationId)) throw new AppError("Location not found", 404);
    filter.locationId = toId(req.query.locationId);
  }
  if (req.query.passCompanyId) {
    if (req.query.passCompanyId === "none") filter.passCompanyId = { $exists: false };
    else if (!mongoose.isValidObjectId(req.query.passCompanyId)) throw new AppError("Invalid company", 400);
    else filter.passCompanyId = toId(req.query.passCompanyId);
  }
  if (req.query.passUserId) {
    if (!mongoose.isValidObjectId(req.query.passUserId)) throw new AppError("Invalid user", 400);
    filter.passUserId = toId(req.query.passUserId);
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40) : "";
  if (q) {
    filter.$or = [{ "billTo.name": { $regex: escapeRegex(q), $options: "i" } }, ...(/^\d{1,9}$/.test(q) ? [{ invoiceNumber: Number(q) }] : [])];
  }
  const exporting = wantsExport(req);
  const wanted = Number.parseInt(req.query.limit, 10);
  const size = LIMITS.includes(wanted) ? wanted : 25;
  const page = pageFrom(req);
  const [invoices, total] = await Promise.all([
    PassInvoice.find(filter).sort({ invoiceDate: -1, invoiceNumber: -1 }).skip(exporting ? 0 : (page - 1) * size).limit(exporting ? CSV_LIMIT : size).lean(),
    PassInvoice.countDocuments(filter),
  ]);
  const locations = await Location.find({ _id: { $in: invoices.map((i) => i.locationId) } }).select("name").lean();
  const locationName = new Map(locations.map((l) => [String(l._id), l.name]));
  const rows = invoices.map((i) => ({
    _id: i._id, invoiceDate: i.invoiceDate, invoiceNumber: i.invoiceNumber,
    userName: i.passCompanyId ? "" : (i.billTo && i.billTo.name) || "", company: i.passCompanyId ? (i.billTo && i.billTo.name) || "" : "",
    location: locationName.get(String(i.locationId)) || "", vehicles: i.quantity, taxable: i.taxable, tax: i.tax, total: i.total,
  }));
  if (exporting) {
    req.reportKey = "pass-invoices-list";
    return respond(req, res, "pass-invoices", [
      { key: "invoiceDate", label: "Invoice date" }, { key: "invoiceNumber", label: "Invoice number" }, { key: "userName", label: "User name" },
      { key: "company", label: "Company name" }, { key: "location", label: "Location" }, { key: "vehicles", label: "No of vehicle" },
      { key: "taxable", label: "Taxable amount" }, { key: "tax", label: "Tax" }, { key: "total", label: "Total amount" },
    ], rows.map((r) => ({ ...r, userName: r.userName || "N/A", company: r.company || "N/A" })), { total });
  }
  res.json({ success: true, data: { invoices: rows, total, page, pageSize: size } });
};

const addressOf = (a = {}) => [a.line1, a.city, a.state, a.pincode].filter(Boolean).join(", ");

// Who the invoice comes from: the location, with the company's GSTIN and contact.
const sellerOf = (location, company) => ({
  name: location ? location.name : company ? company.name : "",
  address: location ? addressOf(location.address) : "",
  email: (company && company.billingContact && company.billingContact.email) || "",
  phone: (location && location.contact && location.contact.phone) || (company && company.billingContact && company.billingContact.phone) || "",
  gstNumber: (company && company.gstNumber) || "",
});

// GET /api/pass-invoices/:id: everything the invoice shows, for the view and print window.
const getOne = async (req, res) => {
  const invoice = await PassInvoice.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] }).lean();
  if (!invoice) throw new AppError("Invoice not found", 404);
  const [location, company] = await Promise.all([Location.findById(invoice.locationId).lean(), Company.findById(invoice.companyId).lean()]);
  res.json({ success: true, data: { ...invoice, seller: sellerOf(location, company), description: "Vehicle Parking Pass" } });
};

module.exports = { eligible, preview, generate, list, getOne };
