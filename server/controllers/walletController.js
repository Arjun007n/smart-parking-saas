const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const wallets = require("../services/walletService");
const { parsePlate, escapeRegex } = require("../utils/plate");
const { getAccessibleLocation } = require("../utils/scope");
const { isCompanyWide } = require("../config/permissions");
const Wallet = require("../models/Wallet");
const WalletTxn = require("../models/WalletTxn");
const Shift = require("../models/Shift");

const PAGE_SIZE = 50;
const pageFrom = (req) => Math.max(1, Number.parseInt(req.query.page, 10) || 1);

const findInScope = async (req) => {
  const wallet = await Wallet.findOne({ _id: req.params.id, ...req.tenantFilter });
  if (!wallet) throw new AppError("Wallet not found", 404);
  return wallet;
};

const view = (wallet) => ({ ...wallet.toJSON(), low: wallets.isLow(wallet) });

// GET /api/wallets?q=&status=&low=&page=
const listWallets = async (req, res) => {
  const conditions = [req.tenantFilter];
  if (req.query.status === "ACTIVE" || req.query.status === "BLOCKED") conditions.push({ status: req.query.status });
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q) {
    const text = new RegExp(escapeRegex(q.slice(0, 40)), "i");
    const plate = q.toUpperCase().replace(/[\s-]/g, "");
    conditions.push({ $or: [{ number: text }, { holderName: text }, { phone: text }, ...(plate.length >= 3 ? [{ vehicles: new RegExp(escapeRegex(plate)) }] : [])] });
  }
  const filter = { $and: conditions };
  const page = pageFrom(req);
  const [items, total] = await Promise.all([
    Wallet.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    Wallet.countDocuments(filter),
  ]);
  res.json({ success: true, data: { wallets: items.map(view), total, page, pageSize: PAGE_SIZE } });
};

// GET /api/wallets/lookup?number= | plate= | phone=
// For the gate staff: find the wallet of a customer.
const lookupWallet = async (req, res) => {
  const wallet = await wallets.lookup(req.companyId, req.query);
  res.json({ success: true, data: { wallet: wallet ? { ...wallets.brief(wallet), vehicles: wallet.vehicles } : null } });
};

// GET /api/wallets/:id
const getWallet = async (req, res) => {
  const wallet = await findInScope(req);
  const recent = await WalletTxn.find({ walletId: wallet._id }).sort({ createdAt: -1 }).limit(PAGE_SIZE).populate("by", "name");
  res.json({ success: true, data: { wallet: view(wallet), transactions: recent } });
};

// GET /api/wallets/:id/transactions?page=
const listTransactions = async (req, res) => {
  const wallet = await findInScope(req);
  const page = pageFrom(req);
  const [items, total] = await Promise.all([
    WalletTxn.find({ walletId: wallet._id }).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate("by", "name"),
    WalletTxn.countDocuments({ walletId: wallet._id }),
  ]);
  res.json({ success: true, data: { transactions: items, total, page, pageSize: PAGE_SIZE } });
};

// POST /api/wallets
const createWallet = async (req, res) => {
  const { holderName, phone, vehicles, notes, lowBalanceAlert } = req.body;
  const wallet = await wallets.createWallet({
    companyId: req.companyId, holderName, phone, vehicles, notes, lowBalanceAlert, createdBy: req.user._id,
  });
  await audit.record(req, "WALLET_CREATE", { entity: "Wallet", entityId: wallet._id, companyId: wallet.companyId, meta: { number: wallet.number } });
  res.status(201).json({ success: true, data: view(wallet) });
};

// PUT /api/wallets/:id   (details, vehicles, block / unblock)
const updateWallet = async (req, res) => {
  const wallet = await findInScope(req);
  const { vehicles, status, statusReason, ...rest } = req.body;
  Object.assign(wallet, rest);
  if (vehicles) wallet.vehicles = wallets.cleanVehicles(vehicles);
  if (status && status !== wallet.status) {
    if (status === "BLOCKED" && !statusReason) throw new AppError("Give a reason for blocking the wallet", 400);
    wallet.status = status;
    wallet.statusReason = status === "BLOCKED" ? statusReason : undefined;
  }
  try {
    await wallet.save();
  } catch (error) {
    throw wallets.duplicateVehicleError(error) || error;
  }
  await audit.record(req, "WALLET_UPDATE", {
    entity: "Wallet", entityId: wallet._id, companyId: wallet.companyId,
    meta: { number: wallet.number, changed: Object.keys(req.body) },
  });
  res.json({ success: true, data: view(wallet) });
};

// POST /api/wallets/:id/topup   (whoever collects payments)
// Money was handed over at the counter. Cash is counted in the operator's open shift.
const topUp = async (req, res) => {
  const wallet = await findInScope(req);
  const { amount, method, reference, requestId, locationId } = req.body;
  if (method === "CASH" && reference) throw new AppError("Cash has no payment reference", 400);
  const location = await getAccessibleLocation(req, locationId, { mustBeActive: true });
  if (String(location.companyId) !== String(wallet.companyId)) throw new AppError("Wallet not found", 404);
  const shift = await Shift.findOne({ operatorId: req.user._id, locationId: location._id, status: "OPEN" });

  const result = await wallets.topUp({
    wallet, amount, method, reference, requestId, locationId: location._id, shiftId: shift ? shift._id : undefined, by: req.user._id,
  });
  if (!result.repeated) {
    await audit.record(req, "WALLET_TOPUP", {
      entity: "Wallet", entityId: wallet._id, companyId: wallet.companyId,
      meta: { number: wallet.number, amount, method, locationId: location._id },
    });
  }
  res.status(result.repeated ? 200 : 201).json({ success: true, data: { wallet: view(result.wallet), transaction: result.txn, repeated: result.repeated } });
};

// POST /api/wallets/:id/adjust   (company admin; a correction needs a reason)
const adjust = async (req, res) => {
  // Changing someone's balance by hand is a company-level decision.
  if (!isCompanyWide(req.user.role)) throw new AppError("Only a company admin can correct a wallet balance", 403);
  const wallet = await findInScope(req);
  const { amount, reason, requestId } = req.body;
  if (amount === 0) throw new AppError("The amount cannot be zero", 400);
  const result = await wallets.adjust({ wallet, amount, reason, requestId, by: req.user._id });
  if (!result.repeated) {
    await audit.record(req, "WALLET_ADJUST", {
      entity: "Wallet", entityId: wallet._id, companyId: wallet.companyId,
      meta: { number: wallet.number, amount, reason },
    });
  }
  res.json({ success: true, data: { wallet: view(result.wallet), transaction: result.txn, repeated: result.repeated } });
};

// GET /api/wallets/:id/verify   (admins) does the balance match the ledger?
const verifyWallet = async (req, res) => {
  const wallet = await findInScope(req);
  res.json({ success: true, data: await wallets.verify(wallet) });
};

module.exports = {
  listWallets, lookupWallet, getWallet, listTransactions, createWallet, updateWallet, topUp, adjust, verifyWallet,
};
