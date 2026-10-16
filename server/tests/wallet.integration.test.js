// Prepaid wallets through the API: creating, topping up at the counter (shift cash), paying a parking fee
// from a wallet, refunds back to the wallet, and the safety rules (no overspending, no double debit, a ledger
// that always matches the balance). Needs MongoDB (see tests/helpers.js).
const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const ParkingSession = require("../models/ParkingSession");
const Payment = require("../models/Payment");
const Wallet = require("../models/Wallet");
const WalletTxn = require("../models/WalletTxn");
const wallets = require("../services/walletService");

setup();

const s = {};
const backdate = (sessionId, minutes) =>
  ParkingSession.updateOne({ _id: sessionId }, { $set: { entryTime: new Date(Date.now() - minutes * 60 * 1000) } });
const enter = (vehicleNumber) =>
  api("POST", "/api/parking/entry", { token: s.a.token, body: { locationId: s.loc._id, vehicleNumber, vehicleType: "CAR" } });
const quote = (vehicleNumber, token = s.exitToken) =>
  api("POST", "/api/parking/exit", { token, body: { locationId: s.loc._id, vehicleNumber } });
const pay = (body, token = s.exitToken) => api("POST", "/api/payments", { token, body });
const topup = (id, body, token = s.exitToken) =>
  api("POST", `/api/wallets/${id}/topup`, { token, body: { locationId: s.loc._id, method: "CASH", ...body } });
const make = async (body, token = s.a.token) => {
  const res = await api("POST", "/api/wallets", { token, body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
};
const balanceOf = async (id) => (await Wallet.findById(id)).balancePaise;
const sound = async (id) => assert.equal((await wallets.verify(await Wallet.findById(id))).ok, true, "the ledger matches the balance");

// 89.5 minutes is a 90 minute stay: 20 + 20 = 40 (tax included).
const FEE = 40;
const STAY = 89.5;

it("setup: company, location, tariff, an exit operator with an open shift, and another company", async () => {
  s.a = await registerCompany("wal");
  s.b = await registerCompany("walb");
  const loc = await api("POST", "/api/locations", { token: s.a.token, body: { name: "Wallet Lot", address: { line1: "MG Road" }, capacity: { car: 20 } } });
  assert.equal(loc.status, 201, JSON.stringify(loc.body));
  s.loc = loc.body.data;
  const tariff = await api("POST", "/api/tariffs", {
    token: s.a.token,
    body: { locationId: s.loc._id, name: "Car", vehicleType: "CAR", gracePeriodMinutes: 10, slabs: [{ uptoMinutes: 60, rate: 20 }], additionalPerHour: 20, taxPercent: 18, taxInclusive: true },
  });
  assert.equal(tariff.status, 201, JSON.stringify(tariff.body));
  const staff = await api("POST", "/api/users", {
    token: s.a.token, body: { name: "Exit Op", email: "wal-exit@example.com", password: "Password123", role: "EXIT_OPERATOR", locationIds: [s.loc._id] },
  });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  s.exitToken = await login("wal-exit@example.com");
  const shift = await api("POST", "/api/shifts", { token: s.exitToken, body: { locationId: s.loc._id, openingCash: 0 } });
  assert.equal(shift.status, 201, JSON.stringify(shift.body));
  s.shift = shift.body.data;
});

it("create: admins only; details are checked; a vehicle belongs to one wallet", async () => {
  assert.equal((await api("POST", "/api/wallets", { token: s.exitToken, body: { holderName: "Ravi Kumar" } })).status, 403);
  assert.equal((await api("POST", "/api/wallets", { body: { holderName: "Ravi Kumar" } })).status, 401);
  assert.equal((await api("POST", "/api/wallets", { token: s.a.token, body: {} })).status, 400);
  assert.equal((await api("POST", "/api/wallets", { token: s.a.token, body: { holderName: "R" } })).status, 400);
  assert.equal((await api("POST", "/api/wallets", { token: s.a.token, body: { holderName: "Ravi", vehicles: ["ab"] } })).status, 400);

  s.w1 = await make({ holderName: "Ravi Kumar", phone: "9876543210", vehicles: ["rj14 wl-0001", "RJ14WL0002", "RJ14WL0001"] });
  assert.match(s.w1.number, /^W-[2-9A-HJ-NP-Z]{8}$/);
  assert.deepEqual(s.w1.vehicles, ["RJ14WL0001", "RJ14WL0002"]);
  assert.equal(s.w1.balance, 0);
  assert.equal(s.w1.status, "ACTIVE");

  const clash = await api("POST", "/api/wallets", { token: s.a.token, body: { holderName: "Someone Else", vehicles: ["RJ14WL0002"] } });
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
  assert.match(clash.body.message, /another wallet/);
  // The same plate in another company is fine.
  const other = await make({ holderName: "Other Co", vehicles: ["RJ14WL0002"] }, s.b.token);
  assert.ok(other._id);
  // Wallets without vehicles can be many.
  s.w2 = await make({ holderName: "Sita Devi" });
  s.w3 = await make({ holderName: "No Vehicle" });
  assert.equal(await Wallet.countDocuments({ companyId: s.a.company._id }), 3);
});

it("top-up: cash is counted in the operator's shift; a repeat with the same request id adds nothing", async () => {
  const requestId = "topup-req-0001";
  const first = await topup(s.w1._id, { amount: 200, requestId });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.wallet.balance, 200);
  assert.equal(first.body.data.transaction.type, "TOPUP");
  assert.equal(String(first.body.data.transaction.shiftId), s.shift._id);

  const again = await topup(s.w1._id, { amount: 200, requestId });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.repeated, true);
  assert.equal(again.body.data.wallet.balance, 200);
  assert.equal(await WalletTxn.countDocuments({ walletId: s.w1._id }), 1);

  const current = await api("GET", "/api/shifts/current", { token: s.exitToken });
  assert.equal(current.body.data.totals.cashCollected, 200);
  assert.equal(current.body.data.totals.expectedCash, 200);
  assert.equal(current.body.data.totals.walletTopups.amount, 200);
  assert.equal(current.body.data.totals.collected, 200);
  await sound(s.w1._id);
});

it("top-up: bad requests are refused and change nothing", async () => {
  const before = await balanceOf(s.w1._id);
  assert.equal((await topup(s.w1._id, { amount: 0 })).status, 400);
  assert.equal((await topup(s.w1._id, { amount: -50 })).status, 400);
  assert.equal((await topup(s.w1._id, { amount: 0.5 })).status, 400, "below the 1 minimum");
  assert.equal((await topup(s.w1._id, { amount: 10.555 })).status, 400, "paise at most");
  assert.equal((await topup(s.w1._id, { amount: 100001 })).status, 400);
  assert.equal((await topup(s.w1._id, { amount: 50, method: "BITCOIN" })).status, 400);
  assert.equal((await topup(s.w1._id, { amount: 50, method: "GATEWAY" })).status, 400);
  assert.equal((await topup(s.w1._id, { amount: 50, method: "CASH", reference: "CASH-REF-1" })).status, 400, "cash has no reference");
  assert.equal((await topup(s.w1._id, { amount: 49999 })).status, 409, "over the wallet limit of 50000");
  assert.equal((await api("POST", `/api/wallets/${s.w1._id}/topup`, { token: s.exitToken, body: { amount: 50, method: "CASH" } })).status, 400, "location is required");
  assert.equal((await api("POST", `/api/wallets/${s.w1._id}/topup`, { body: { amount: 50, method: "CASH", locationId: s.loc._id } })).status, 401);
  assert.equal((await api("POST", `/api/wallets/${s.w1._id}/topup`, { token: s.b.token, body: { amount: 50, method: "CASH", locationId: s.loc._id } })).status, 404, "another company");
  assert.equal(await balanceOf(s.w1._id), before);
});

it("top-up: UPI and card carry a reference; a blocked wallet cannot be topped up", async () => {
  const upi = await topup(s.w2._id, { amount: 30.5, method: "UPI", reference: "UPI-REF-77" });
  assert.equal(upi.status, 201, JSON.stringify(upi.body));
  assert.equal(upi.body.data.wallet.balance, 30.5);
  assert.equal(upi.body.data.transaction.reference, "UPI-REF-77");

  const noReason = await api("PUT", `/api/wallets/${s.w3._id}`, { token: s.a.token, body: { status: "BLOCKED" } });
  assert.equal(noReason.status, 400);
  const blocked = await api("PUT", `/api/wallets/${s.w3._id}`, { token: s.a.token, body: { status: "BLOCKED", statusReason: "Card lost" } });
  assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
  assert.equal(blocked.body.data.status, "BLOCKED");
  assert.equal((await topup(s.w3._id, { amount: 100 })).status, 409);
  assert.equal(await balanceOf(s.w3._id), 0);
  await api("PUT", `/api/wallets/${s.w3._id}`, { token: s.a.token, body: { status: "ACTIVE" } });
});

it("exit: the wallet linked to the vehicle is offered, and pays the fee", async () => {
  const entry = await enter("RJ14WL0001");
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  s.v1 = entry.body.data.session;
  await backdate(s.v1._id, STAY);

  const res = await quote("RJ14WL0001");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.paymentRequired, true);
  assert.equal(res.body.data.session.fee.total, FEE);
  assert.equal(res.body.data.wallet.number, s.w1.number);
  assert.equal(res.body.data.wallet.balance, 200);
  assert.equal(res.body.data.wallet.enough, true);

  // Missing or wrong details are refused before any money moves.
  assert.equal((await pay({ sessionId: s.v1._id, method: "WALLET", amount: FEE })).status, 400, "which wallet?");
  assert.equal((await pay({ sessionId: s.v1._id, method: "WALLET", amount: FEE, walletId: s.w1._id, transactionId: "REF-12345" })).status, 400);
  assert.equal((await pay({ sessionId: s.v1._id, method: "WALLET", amount: FEE, walletId: s.w1._id })).status, 201 );
  s.p1 = await Payment.findOne({ sessionId: s.v1._id });
  assert.equal(s.p1.method, "WALLET");
  assert.equal(s.p1.status, "SUCCESS");
  assert.equal(s.p1.amount, FEE);
  assert.equal(String(s.p1.walletId), s.w1._id);
  assert.equal(await balanceOf(s.w1._id), 16000);

  const closed = await ParkingSession.findById(s.v1._id);
  assert.equal(closed.status, "COMPLETED");
  const debit = await WalletTxn.findOne({ walletId: s.w1._id, type: "DEBIT" });
  assert.equal(debit.deltaPaise, -4000);
  assert.equal(debit.balanceAfterPaise, 16000);
  assert.equal(String(debit.sessionId), s.v1._id);
  assert.equal(String(debit.paymentId), String(s.p1._id));

  // The same payment sent again (a retry) returns the first result and takes nothing more.
  const retry = await pay({ sessionId: s.v1._id, method: "WALLET", amount: FEE, walletId: s.w1._id });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.data.repeated, true);
  assert.equal(await balanceOf(s.w1._id), 16000);
  assert.equal(await WalletTxn.countDocuments({ walletId: s.w1._id, type: "DEBIT" }), 1);
  await sound(s.w1._id);
});

it("shift: a fee paid from a wallet is shown, but is not new money", async () => {
  const current = await api("GET", "/api/shifts/current", { token: s.exitToken });
  const t = current.body.data.totals;
  assert.equal(t.walletSpent.amount, FEE);
  assert.equal(t.walletSpent.count, 1);
  assert.equal(t.collected, 230.5, "only the top-ups were collected: 200 cash and 30.5 UPI, not the wallet-paid fee");
  assert.equal(t.cashCollected, 200);
  assert.equal(t.expectedCash, 200, "the drawer did not change when the wallet paid");
  assert.ok(t.byMethod.some((m) => m.method === "WALLET" && m.amount === FEE));
});

it("exit: not enough balance is refused, the vehicle stays inside and nothing is taken", async () => {
  // The wallet must be linked to the vehicle for an exit operator to charge it (a supervisor or admin may charge any).
  assert.equal((await api("PUT", `/api/wallets/${s.w2._id}`, { token: s.a.token, body: { vehicles: ["RJ14WL0003"] } })).status, 200);
  const entry = await enter("RJ14WL0003");
  s.v2 = entry.body.data.session;
  await backdate(s.v2._id, STAY);
  assert.equal((await quote("RJ14WL0003")).status, 200);
  const before = await balanceOf(s.w2._id); // 3050 paise, fee is 4000
  const res = await pay({ sessionId: s.v2._id, method: "WALLET", amount: FEE, walletId: s.w2._id });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.message, /Not enough balance/);
  assert.equal(await balanceOf(s.w2._id), before);
  assert.equal(await Payment.countDocuments({ sessionId: s.v2._id }), 0);
  assert.equal((await ParkingSession.findById(s.v2._id)).status, "PAYMENT_PENDING");

  // The customer tops up and pays the same ticket.
  assert.equal((await topup(s.w2._id, { amount: 10, method: "CARD", reference: "CARD-REF-1" })).status, 201);
  const ok = await pay({ sessionId: s.v2._id, method: "WALLET", amount: FEE, walletId: s.w2._id });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(await balanceOf(s.w2._id), 40.5 * 100 - 4000);
  await sound(s.w2._id);
});

it("exit: another company's wallet, a blocked wallet and a wrong amount are refused", async () => {
  const entry = await enter("RJ14WL0004");
  s.v3 = entry.body.data.session;
  await backdate(s.v3._id, STAY);
  assert.equal((await quote("RJ14WL0004")).status, 200);
  const other = await Wallet.findOne({ companyId: s.b.company._id });
  assert.equal((await pay({ sessionId: s.v3._id, method: "WALLET", amount: FEE, walletId: String(other._id) })).status, 404);
  // RJ14WL0004 is not linked to w1: an exit operator may not charge it; a supervisor or admin may.
  const unlinked = await pay({ sessionId: s.v3._id, method: "WALLET", amount: FEE, walletId: s.w1._id });
  assert.equal(unlinked.status, 403, JSON.stringify(unlinked.body));
  assert.match(unlinked.body.message, /not linked to this vehicle/);
  assert.equal((await pay({ sessionId: s.v3._id, method: "WALLET", amount: 1, walletId: s.w1._id }, s.a.token)).status, 409, "wrong amount");

  await api("PUT", `/api/wallets/${s.w1._id}`, { token: s.a.token, body: { status: "BLOCKED", statusReason: "Suspected misuse" } });
  const blocked = await pay({ sessionId: s.v3._id, method: "WALLET", amount: FEE, walletId: s.w1._id }, s.a.token);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.match(blocked.body.message, /blocked/);
  // RJ14WL0002 is linked to w1: while w1 is blocked the exit screen must not offer it.
  const linkedEntry = await enter("RJ14WL0002");
  assert.equal(linkedEntry.status, 201, JSON.stringify(linkedEntry.body));
  await backdate(linkedEntry.body.data.session._id, STAY);
  const offered = await quote("RJ14WL0002");
  assert.equal(offered.status, 200, JSON.stringify(offered.body));
  assert.equal(offered.body.data.wallet, undefined, "a blocked wallet is not offered");
  await api("PUT", `/api/wallets/${s.w1._id}`, { token: s.a.token, body: { status: "ACTIVE" } });
  const offeredAgain = await quote("RJ14WL0002");
  assert.equal(offeredAgain.body.data.wallet.number, s.w1.number, "offered again once unblocked");
  s.v4 = linkedEntry.body.data.session;

  // Paying with cash instead still works.
  const cash = await pay({ sessionId: s.v3._id, method: "CASH", amount: FEE });
  assert.equal(cash.status, 201, JSON.stringify(cash.body));
  assert.equal(await balanceOf(s.w1._id), 16000);
});

it("safety: two taps on Pay at the same moment take the fee once and never undo a payment that was recorded", async () => {
  const before = await balanceOf(s.w1._id);
  const fee = (await ParkingSession.findById(s.v4._id)).fee.total;
  const body = { sessionId: s.v4._id, method: "WALLET", amount: fee, walletId: s.w1._id };
  const [a, b] = await Promise.all([pay(body), pay(body)]);
  assert.ok([a.status, b.status].every((code) => code === 200 || code === 201), `${a.status} ${b.status} ${JSON.stringify(a.body)} ${JSON.stringify(b.body)}`);
  assert.ok([a.status, b.status].includes(201), "one of them did the payment");
  assert.equal(await Payment.countDocuments({ sessionId: s.v4._id, status: "SUCCESS" }), 1);
  assert.equal(await WalletTxn.countDocuments({ walletId: s.w1._id, sessionId: s.v4._id, type: "DEBIT" }), 1);
  assert.equal(await WalletTxn.countDocuments({ walletId: s.w1._id, sessionId: s.v4._id, type: "REVERSAL" }), 0, "no undo");
  assert.equal(await balanceOf(s.w1._id), before - Math.round(fee * 100));
  assert.equal((await ParkingSession.findById(s.v4._id)).status, "COMPLETED");
  await sound(s.w1._id);
  // Bring the balance back to what the next tests expect.
  await wallets.adjust({ wallet: await Wallet.findById(s.w1._id), amount: fee, reason: "Test reset", by: s.a.user._id });
});

it("refund: a wallet payment goes back into the wallet, once", async () => {
  const before = await balanceOf(s.w1._id);
  assert.equal((await api("POST", `/api/payments/${s.p1._id}/refund`, { token: s.exitToken, body: { reason: "Charged by mistake" } })).status, 403);
  const refund = await api("POST", `/api/payments/${s.p1._id}/refund`, { token: s.a.token, body: { reason: "Charged by mistake" } });
  assert.equal(refund.status, 200, JSON.stringify(refund.body));
  assert.equal(refund.body.data.status, "REFUNDED");
  assert.equal(refund.body.data.refund.amount, FEE);
  assert.equal(refund.body.data.refund.shiftId, undefined, "it did not come out of a cash drawer");
  assert.equal(await balanceOf(s.w1._id), before + 4000);

  const twice = await api("POST", `/api/payments/${s.p1._id}/refund`, { token: s.a.token, body: { reason: "Charged by mistake" } });
  assert.equal(twice.status, 409);
  assert.equal(await balanceOf(s.w1._id), before + 4000);
  assert.equal(await WalletTxn.countDocuments({ walletId: s.w1._id, type: "REFUND" }), 1);
  await sound(s.w1._id);
});

it("adjust: admins correct a balance with a reason; it cannot go below zero", async () => {
  const before = await balanceOf(s.w3._id);
  assert.equal((await api("POST", `/api/wallets/${s.w3._id}/adjust`, { token: s.exitToken, body: { amount: 10, reason: "Goodwill credit" } })).status, 403);
  const locAdmin = await api("POST", "/api/users", {
    token: s.a.token, body: { name: "Loc Admin", email: "wal-locadmin@example.com", password: "Password123", role: "LOCATION_ADMIN", locationIds: [s.loc._id] },
  });
  assert.equal(locAdmin.status, 201, JSON.stringify(locAdmin.body));
  const locToken = await login("wal-locadmin@example.com");
  const created = await api("POST", "/api/wallets", { token: locToken, body: { holderName: "By Location Admin" } });
  assert.equal(created.status, 201, "a location admin manages wallets");
  const refused = await api("POST", `/api/wallets/${s.w3._id}/adjust`, { token: locToken, body: { amount: 10, reason: "Goodwill credit" } });
  assert.equal(refused.status, 403, "but only the company admin corrects a balance");
  assert.match(refused.body.message, /company admin/);
  assert.equal((await api("POST", `/api/wallets/${s.w3._id}/adjust`, { token: s.a.token, body: { amount: 10 } })).status, 400, "reason needed");
  assert.equal((await api("POST", `/api/wallets/${s.w3._id}/adjust`, { token: s.a.token, body: { amount: 0, reason: "Nothing to do" } })).status, 400);
  const plus = await api("POST", `/api/wallets/${s.w3._id}/adjust`, { token: s.a.token, body: { amount: 25, reason: "Goodwill credit", requestId: "adjust-req-0001" } });
  assert.equal(plus.status, 200, JSON.stringify(plus.body));
  assert.equal(plus.body.data.wallet.balance, 25);
  const repeat = await api("POST", `/api/wallets/${s.w3._id}/adjust`, { token: s.a.token, body: { amount: 25, reason: "Goodwill credit", requestId: "adjust-req-0001" } });
  assert.equal(repeat.body.data.repeated, true);
  assert.equal(await balanceOf(s.w3._id), before + 2500);
  assert.equal((await api("POST", `/api/wallets/${s.w3._id}/adjust`, { token: s.a.token, body: { amount: -30, reason: "Taking too much" } })).status, 409);
  const minus = await api("POST", `/api/wallets/${s.w3._id}/adjust`, { token: s.a.token, body: { amount: -25, reason: "Credit given twice" } });
  assert.equal(minus.status, 200, JSON.stringify(minus.body));
  assert.equal(minus.body.data.wallet.balance, 0);
  await sound(s.w3._id);
  const verify = await api("GET", `/api/wallets/${s.w3._id}/verify`, { token: s.a.token });
  assert.equal(verify.body.data.ok, true);
  assert.equal((await api("GET", `/api/wallets/${s.w3._id}/verify`, { token: s.exitToken })).status, 403);
});

it("safety: ten payments at the same moment cannot spend more than the balance", async () => {
  const wallet = await make({ holderName: "Race Test" });
  await wallets.topUp({ wallet, amount: 100, method: "CASH", locationId: s.loc._id, by: s.a.user._id });
  const fakeSession = (n) => ({ _id: new (require("mongoose").Types.ObjectId)(), locationId: s.loc._id, ticketNumber: `RACE-${n}` });
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      wallets.debitForSession({ walletId: wallet._id, companyId: wallet.companyId, session: fakeSession(i), amount: 30, by: s.a.user._id })
    )
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3, "100 pays three times 30");
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason.code === "INSUFFICIENT_BALANCE"));
  assert.equal(await balanceOf(wallet._id), 1000);
  await sound(wallet._id);
});

it("safety: a debit that was undone lets the same session be paid again, and only once", async () => {
  const wallet = await make({ holderName: "Undo Test" });
  await wallets.topUp({ wallet, amount: 100, method: "CASH", locationId: s.loc._id, by: s.a.user._id });
  const session = { _id: new (require("mongoose").Types.ObjectId)(), locationId: s.loc._id, ticketNumber: "UNDO-1" };
  const args = { walletId: wallet._id, companyId: wallet.companyId, session, amount: 40, by: s.a.user._id };

  const first = await wallets.debitForSession(args);
  const retry = await wallets.debitForSession(args);
  assert.equal(retry.repeated, true);
  assert.equal(String(retry.txn._id), String(first.txn._id));
  assert.equal(await balanceOf(wallet._id), 6000);

  await wallets.reverseDebit({ txn: first.txn, reason: "Payment could not be recorded" });
  await wallets.reverseDebit({ txn: first.txn, reason: "Payment could not be recorded" }); // twice: no double credit
  assert.equal(await balanceOf(wallet._id), 10000);

  const second = await wallets.debitForSession(args);
  assert.equal(second.repeated, false);
  assert.notEqual(String(second.txn._id), String(first.txn._id));
  assert.equal(await balanceOf(wallet._id), 6000);
  await sound(wallet._id);
});

it("a second look-up with a changed fee replaces an unrecorded debit instead of getting stuck", async () => {
  const wallet = await make({ holderName: "Fee Change" });
  await wallets.topUp({ wallet, amount: 100, method: "CASH", locationId: s.loc._id, by: s.a.user._id });
  const session = { _id: new (require("mongoose").Types.ObjectId)(), locationId: s.loc._id, ticketNumber: "CHG-1" };
  const args = { walletId: wallet._id, companyId: wallet.companyId, session, by: s.a.user._id };
  const first = await wallets.debitForSession({ ...args, amount: 40 }); // the payment was never recorded
  assert.equal(await balanceOf(wallet._id), 6000);
  const second = await wallets.debitForSession({ ...args, amount: 60 }); // the fee grew
  assert.equal(second.repeated, false);
  assert.equal(await balanceOf(wallet._id), 4000, "the old 40 was given back and 60 taken");
  assert.notEqual(String(second.txn._id), String(first.txn._id));
  await sound(wallet._id);
});

it("a request id cannot be reused for a different amount", async () => {
  const wallet = await make({ holderName: "Request Id" });
  const requestId = "same-request-id-1";
  assert.equal((await topup(wallet._id, { amount: 50, requestId })).status, 201);
  const other = await topup(wallet._id, { amount: 70, requestId });
  assert.equal(other.status, 409, JSON.stringify(other.body));
  assert.equal(await balanceOf(wallet._id), 5000);
});

it("find: list, search, lookup and the ledger; wallets never cross companies", async () => {
  const list = await api("GET", "/api/wallets", { token: s.a.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.data.wallets.length >= 3);
  assert.ok(list.body.data.wallets.every((w) => String(w.companyId) === s.a.company._id));

  const byName = await api("GET", "/api/wallets?q=ravi", { token: s.a.token });
  assert.equal(byName.body.data.wallets.length, 1);
  const byPlate = await api("GET", "/api/wallets?q=rj14wl0002", { token: s.a.token });
  assert.equal(byPlate.body.data.wallets[0].number, s.w1.number);
  const byPhone = await api("GET", "/api/wallets?q=98765", { token: s.exitToken });
  assert.equal(byPhone.body.data.wallets.length, 1);
  assert.equal((await api("GET", "/api/wallets?status=BLOCKED", { token: s.a.token })).body.data.wallets.length, 0);

  const lookupPlate = await api("GET", "/api/wallets/lookup?plate=RJ14WL0001", { token: s.exitToken });
  assert.equal(lookupPlate.body.data.wallet.number, s.w1.number);
  const lookupNumber = await api("GET", `/api/wallets/lookup?number=${s.w1.number.toLowerCase()}`, { token: s.exitToken });
  assert.equal(lookupNumber.body.data.wallet._id, s.w1._id);
  assert.equal((await api("GET", "/api/wallets/lookup?number=W-NOSUCHCD", { token: s.exitToken })).body.data.wallet, null);
  assert.equal((await api("GET", "/api/wallets/lookup?plate=RJ14WL0001", { token: s.b.token })).body.data.wallet, null, "not across companies");

  const detail = await api("GET", `/api/wallets/${s.w1._id}`, { token: s.exitToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.transactions[0].type, "REFUND", "newest first");
  assert.ok(detail.body.data.transactions.some((t) => t.type === "TOPUP"));
  assert.equal((await api("GET", `/api/wallets/${s.w1._id}`, { token: s.b.token })).status, 404);
  assert.equal((await api("GET", `/api/wallets/${s.w1._id}/transactions`, { token: s.a.token })).body.data.total, 5, "top-up, two fees, a reset, a refund");
});

it("collection: the day shows the money put into wallets separately from income", async () => {
  const res = await api("GET", `/api/payments/collection?locationId=${s.loc._id}`, { token: s.a.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.ok(d.walletTopups.amount >= 240.5, "200 cash + 30.5 UPI + 10 card at least");
  assert.ok(d.walletTopups.byMethod.some((m) => m.key === "CASH" && m.amount >= 200));
  assert.ok(d.byMethod.some((m) => m.key === "WALLET"), "fees paid from wallets are income by method");
});

it("update: details and vehicles change; a vehicle cannot be taken from another wallet", async () => {
  const res = await api("PUT", `/api/wallets/${s.w3._id}`, { token: s.a.token, body: { holderName: "Renamed Holder", vehicles: ["RJ14WL0009"], lowBalanceAlert: 250 } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.holderName, "Renamed Holder");
  assert.deepEqual(res.body.data.vehicles, ["RJ14WL0009"]);
  assert.equal(res.body.data.low, true, "0 is below the 250 alert");
  const clash = await api("PUT", `/api/wallets/${s.w3._id}`, { token: s.a.token, body: { vehicles: ["RJ14WL0001"] } });
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
  assert.equal((await api("PUT", `/api/wallets/${s.w3._id}`, { token: s.exitToken, body: { holderName: "Nope Nope" } })).status, 403);
  assert.equal((await api("PUT", `/api/wallets/${s.w1._id}`, { token: s.b.token, body: { holderName: "Nope Nope" } })).status, 404);
});
