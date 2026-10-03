const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const Lead = require("../models/Lead");
const { LEAD_STATUSES } = require("../models/Lead");

const PAGE_SIZE = 50;

// POST /api/leads   (public: the website's contact and enquiry forms)
const createLead = async (req, res) => {
  const { website, ...fields } = req.body;
  const reply = { success: true, message: "Thank you. We will get back to you soon." };

  // "website" is a hidden field that people never see or fill in. Automated
  // spam fills every field, so a value here means: quietly drop it.
  if (website) return res.status(201).json(reply);

  await Lead.create({ ...fields, ip: req.ip });
  res.status(201).json(reply);
};

// GET /api/leads?status=&page=   (Super Admin)
const listLeads = async (req, res) => {
  const filter = LEAD_STATUSES.includes(req.query.status) ? { status: req.query.status } : {};
  const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

  const [leads, total, fresh] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).select("-ip"),
    Lead.countDocuments(filter),
    Lead.countDocuments({ status: "NEW" }),
  ]);
  res.json({ success: true, data: { leads, total, newCount: fresh, page, pageSize: PAGE_SIZE } });
};

// PUT /api/leads/:id   (Super Admin: follow-up status and notes)
const updateLead = async (req, res) => {
  const lead = await Lead.findById(req.params.id).select("-ip");
  if (!lead) throw new AppError("Enquiry not found", 404);

  Object.assign(lead, req.body);
  await lead.save();
  await audit.record(req, "LEAD_UPDATE", { entity: "Lead", entityId: lead._id, meta: { changed: Object.keys(req.body) } });

  res.json({ success: true, data: lead });
};

module.exports = { createLead, listLeads, updateLead };
