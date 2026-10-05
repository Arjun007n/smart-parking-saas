// Prepaid wallets ("parking cards").
//
// A wallet belongs to one company and can only pay that company's parking
// fees. Money is whole PAISE. Rules this file keeps:
//  * The balance is changed in ONE atomic update that also checks the rule
//    (enough money, wallet active, under the limit), so two payments at the
//    same moment can never spend the same rupee twice.
//  * Every change writes a ledger row (WalletTxn). Rows are never edited.
//  * Every change can carry an idempotency key. Repeating the same request
//    (double tap, retry after a lost connection) changes nothing the second time.
//  * If the ledger row cannot be written, the balance change is undone.

const crypto = require("crypto");
const AppError = require("../utils/AppError");
const { parsePlate, escapeRegex } = require("../utils/plate");
const Wallet = require("../models/Wallet");
const { MAX_WALLET_VEHICLES } = require("../models/Wallet");
const WalletTxn = require("../models/WalletTxn");
const Payment = require("../models/Payment");

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMBER_PATTERN = /^W-[2-9A-HJ-NP-Z]{8}$/;

const MIN_TOPUP = 1;
const MAX_TOPUP = 100000;
// The most a wallet may hold (rupees). Set WALLET_MAX_BALANCE to change it.
const maxBalance = () => Math.max(MIN_TOPUP, Number(process.env.WALLET_MAX_BALANCE) || 50000);

const toPaise = (rupees) => {
  const n = Number(rupees);
  if (!Number.isFinite(n)) throw new AppError("Enter a valid amount", 400);
  return Math.round((n + Number.EPSILON) * 100);
};
const toRupees = (paise) => Math.round(paise) / 100;
const hasWholePaise = (rupees) => Math.abs(rupees * 100 - Math.round(rupees * 100)) < 1e-6;

const generateWalletNumber = () => {
  let code = "";
  for (let i = 0; i < 8; i += 1) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `W-${code}`;
};

// Plates of a wallet: normalised, no repeats, at most MAX_WALLET_VEHICLES.
const cleanVehicles = (list = []) => {
  const plates = [...new Set(list.map((v) => parsePlate(v)))];
  if (plates.length > MAX_WALLET_VEHICLES) {
    throw new AppError(`A wallet can have at most ${MAX_WALLET_VEHICLES} vehicles`, 400);
  }
  return plates;
};

const duplicateVehicleError = (error) => {
  if (error.code !== 11000 || !error.keyPattern || !error.keyPattern.vehicles) return null;
  return new AppError("One of these vehicles already belongs to another wallet", 409);
};

// Creates a wallet with a fresh number.
const createWallet = async ({ companyId, holderName, phone, vehicles, notes, lowBalanceAlert, createdBy }) => {
  const plates = cleanVehicles(vehicles);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Wallet.create({
        companyId, holderName, phone, notes, vehicles: plates, createdBy,
        number: generateWalletNumber(),
        ...(lowBalanceAlert !== undefined ? { lowBalanceAlert } : {}),
      });
    } catch (error) {
      const vehicleClash = duplicateVehicleError(error);
      if (vehicleClash) throw vehicleClash;
      const numberClash = error.code === 11000 && error.keyPattern && error.keyPattern.number;
      if (!numberClash) throw error;
    }
  }
  throw new AppError("Could not create a wallet number. Please try again.", 503);
};

// Why a balance change was refused.
const explainRefusal = async ({ walletId, companyId, deltaPaise, requireActive, maxPaise }) => {
  const wallet = await Wallet.findOne({ _id: walletId, companyId });
  if (!wallet) return new AppError("Wallet not found", 404);
  if (requireActive && wallet.status !== "ACTIVE") return new AppError("This wallet is blocked", 409);
  if (deltaPaise < 0 && wallet.balancePaise < -deltaPaise) {
    const error = new AppError(`Not enough balance. The wallet has ${toRupees(wallet.balancePaise).toFixed(2)}.`, 409);
    error.code = "INSUFFICIENT_BALANCE";
    return error;
  }
  if (maxPaise !== undefined && deltaPaise > 0 && wallet.balancePaise + deltaPaise > maxPaise) {
    return new AppError(`A wallet cannot hold more than ${toRupees(maxPaise).toFixed(2)}`, 409);
  }
  return new AppError("The wallet could not be changed. Please try again.", 409);
};

// The one place a balance changes.
// options: walletId, companyId, deltaPaise (+ adds, - takes), type, key, fields (ledger details),
//          requireActive (default true), maxPaise (upper limit for the balance).
// Returns { wallet, txn, repeated }.
const applyChange = async (options) => {
  const { walletId, companyId, deltaPaise, type, key, fields = {}, requireActive = true, maxPaise } = options;
  if (!Number.isInteger(deltaPaise) || deltaPaise === 0) throw new AppError("The amount cannot be zero", 400);

  const already = async () => {
    const txn = await WalletTxn.findOne({ idempotencyKey: key });
    if (!txn) return null;
    if (String(txn.walletId) !== String(walletId)) throw new AppError("This request was already used for another wallet", 409);
    if (txn.deltaPaise !== deltaPaise) throw new AppError("This request was already used for a different amount. Start again.", 409);
    return { wallet: await Wallet.findById(walletId), txn, repeated: true };
  };
  if (key) {
    const seen = await already();
    if (seen) return seen;
  }

  const filter = { _id: walletId, companyId };
  if (requireActive) filter.status = "ACTIVE";
  const balanceLimits = {};
  if (deltaPaise < 0) balanceLimits.$gte = -deltaPaise;
  if (deltaPaise > 0 && maxPaise !== undefined) balanceLimits.$lte = maxPaise - deltaPaise;
  if (Object.keys(balanceLimits).length) filter.balancePaise = balanceLimits;

  const wallet = await Wallet.findOneAndUpdate(filter, { $inc: { balancePaise: deltaPaise } }, { returnDocument: "after" });
  if (!wallet) throw await explainRefusal({ walletId, companyId, deltaPaise, requireActive, maxPaise });

  try {
    const txn = await WalletTxn.create({
      ...fields, companyId, walletId, type, deltaPaise,
      balanceAfterPaise: wallet.balancePaise,
      ...(key ? { idempotencyKey: key } : {}),
    });
    return { wallet, txn, repeated: false };
  } catch (error) {
    // No ledger row, so undo the change: the balance and the ledger must agree. The undo of a credit
    // only happens while the money is still there; a failure to undo is logged, never hides the error.
    try {
      await Wallet.updateOne(
        { _id: walletId, ...(deltaPaise > 0 ? { balancePaise: { $gte: deltaPaise } } : {}) },
        { $inc: { balancePaise: -deltaPaise } }
      );
    } catch (undoError) {
      console.error("Wallet change could not be undone:", String(walletId), undoError.message);
    }
    if (error.code === 11000 && key) {
      const seen = await already();
      if (seen) return seen;
    }
    throw error;
  }
};

// Money put in at the counter.
const topUp = ({ wallet, amount, method, reference, requestId, locationId, shiftId, by }) => {
  if (!hasWholePaise(amount)) throw new AppError("The amount can have at most 2 decimals", 400);
  const deltaPaise = toPaise(amount);
  if (deltaPaise < MIN_TOPUP * 100 || deltaPaise > MAX_TOPUP * 100) {
    throw new AppError(`A top-up must be between ${MIN_TOPUP} and ${MAX_TOPUP}`, 400);
  }
  return applyChange({
    walletId: wallet._id, companyId: wallet.companyId, deltaPaise, type: "TOPUP",
    maxPaise: toPaise(maxBalance()),
    key: requestId ? `topup:${wallet._id}:${requestId}` : undefined,
    fields: { method, reference, locationId, shiftId, by },
  });
};

// A parking fee paid from the wallet. One live debit per session: retrying the same payment
// finds the first debit instead of taking the money twice. A debit that was undone (reversed)
// no longer counts, so the customer can try again.
const debitForSession = async ({ walletId, companyId, session, amount, by, shiftId }) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const key = attempt === 0 ? `pay:${session._id}` : `pay:${session._id}:${attempt}`;
    const earlier = await WalletTxn.findOne({ idempotencyKey: key });
    if (earlier) {
      if (await WalletTxn.exists({ idempotencyKey: `rev:${earlier._id}` })) continue; // undone: a fresh try
      if (earlier.deltaPaise !== -toPaise(amount)) {
        // The fee changed since the first try (the vehicle was looked up again). If no payment was
        // recorded for that debit, give it back and charge the new amount.
        if (await Payment.exists({ transactionId: `WALLET:${earlier._id}` })) {
          throw new AppError("This session was already paid from a wallet", 409);
        }
        await reverseDebit({ txn: earlier, reason: "The fee changed", by });
        continue;
      }
    }
    return applyChange({
      walletId, companyId, deltaPaise: -toPaise(amount), type: "DEBIT", key,
      fields: { sessionId: session._id, locationId: session.locationId, shiftId, by, reason: `Parking ${session.ticketNumber || ""}`.trim() },
    });
  }
  throw new AppError("This payment was tried too many times. Ask an admin.", 409);
};

// Undoes a debit whose payment could not be completed.
const reverseDebit = ({ txn, reason, by }) =>
  applyChange({
    walletId: txn.walletId, companyId: txn.companyId, deltaPaise: -txn.deltaPaise, type: "REVERSAL",
    key: `rev:${txn._id}`, requireActive: false,
    fields: { sessionId: txn.sessionId, locationId: txn.locationId, reason, by },
  });

// A wallet payment given back (also to a blocked wallet: the money is the customer's).
const refundPayment = ({ payment, reason, by }) =>
  applyChange({
    walletId: payment.walletId, companyId: payment.companyId, deltaPaise: toPaise(payment.amount), type: "REFUND",
    key: `refund:${payment._id}`, requireActive: false,
    fields: { sessionId: payment.sessionId, paymentId: payment._id, locationId: payment.locationId, reason, by },
  });

// An admin's correction, plus or minus, always with a reason.
const adjust = ({ wallet, amount, reason, requestId, by }) => {
  if (!hasWholePaise(amount)) throw new AppError("The amount can have at most 2 decimals", 400);
  const deltaPaise = toPaise(amount);
  return applyChange({
    walletId: wallet._id, companyId: wallet.companyId, deltaPaise, type: "ADJUST", requireActive: false,
    maxPaise: toPaise(maxBalance()),
    key: requestId ? `adjust:${wallet._id}:${requestId}` : undefined,
    fields: { reason, by },
  });
};

// Compares the balance with the ledger. Returns { ok, balancePaise, ledgerPaise }.
const verify = async (wallet) => {
  const [row] = await WalletTxn.aggregate([
    { $match: { walletId: wallet._id } },
    { $group: { _id: null, total: { $sum: "$deltaPaise" } } },
  ]);
  const ledgerPaise = row ? row.total : 0;
  return { ok: ledgerPaise === wallet.balancePaise, balancePaise: wallet.balancePaise, ledgerPaise };
};

// The active wallet a vehicle pays from, if any.
const findForVehicle = (companyId, plate) =>
  Wallet.findOne({ companyId, vehicles: plate, status: "ACTIVE" });

// Finds a wallet by its number, a vehicle number or a phone number (exact, within the company).
const lookup = async (companyId, { number, plate, phone }) => {
  if (number) {
    const code = String(number).trim().toUpperCase();
    return NUMBER_PATTERN.test(code) ? Wallet.findOne({ companyId, number: code }) : null;
  }
  if (plate) return Wallet.findOne({ companyId, vehicles: parsePlate(plate) });
  if (phone) return Wallet.findOne({ companyId, phone: String(phone).trim() });
  return null;
};

// Small, safe view for the exit screen.
const brief = (wallet, amountDue) => ({
  _id: wallet._id,
  number: wallet.number,
  holderName: wallet.holderName,
  status: wallet.status,
  balance: toRupees(wallet.balancePaise),
  ...(amountDue !== undefined ? { enough: wallet.status === "ACTIVE" && wallet.balancePaise >= toPaise(amountDue) } : {}),
});

const isLow = (wallet) => wallet.lowBalanceAlert > 0 && wallet.balancePaise < toPaise(wallet.lowBalanceAlert);

module.exports = {
  NUMBER_PATTERN, MIN_TOPUP, MAX_TOPUP, maxBalance, toPaise, toRupees, hasWholePaise, generateWalletNumber,
  cleanVehicles, duplicateVehicleError, createWallet, applyChange, topUp, debitForSession, reverseDebit,
  refundPayment, adjust, verify, findForVehicle, lookup, brief, isLow, escapeRegex,
};
