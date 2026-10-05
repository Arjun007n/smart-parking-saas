// Unit tests for prepaid wallets: money in paise, plates, numbers, the models and the permission.
// No database needed.
process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const wallets = require("../services/walletService");
const Wallet = require("../models/Wallet");
const WalletTxn = require("../models/WalletTxn");
const Payment = require("../models/Payment");
const { PAYMENT_METHODS } = require("../models/constants");
const { PERMISSIONS, ROLES, hasPermission, GRANTABLE_PERMISSIONS, PERMISSION_INFO } = require("../config/permissions");
const gateway = require("../integrations/payment");

const id = () => "64b000000000000000000001";

test("paise: rupees become whole paise without drifting", () => {
  assert.equal(wallets.toPaise(0.1 + 0.2), 30);
  assert.equal(wallets.toPaise(1234.56), 123456);
  assert.equal(wallets.toPaise(19.99), 1999);
  assert.equal(wallets.toRupees(123456), 1234.56);
  assert.throws(() => wallets.toPaise("abc"), /valid amount/);
  assert.throws(() => wallets.toPaise(NaN), /valid amount/);
});

test("hasWholePaise: at most 2 decimals", () => {
  assert.ok(wallets.hasWholePaise(10));
  assert.ok(wallets.hasWholePaise(10.5));
  assert.ok(wallets.hasWholePaise(10.55));
  assert.ok(wallets.hasWholePaise(0.1 + 0.2));
  assert.ok(!wallets.hasWholePaise(10.555));
});

test("wallet numbers: shape and variety", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const number = wallets.generateWalletNumber();
    assert.match(number, wallets.NUMBER_PATTERN);
    seen.add(number);
  }
  assert.ok(seen.size > 190, "random enough");
  assert.ok(!wallets.NUMBER_PATTERN.test("W-ABC"));
  assert.ok(!wallets.NUMBER_PATTERN.test("W-0O1IABCD"), "no look-alike characters");
});

test("cleanVehicles: normalised, no repeats, at most 5, bad plates refused", () => {
  assert.deepEqual(wallets.cleanVehicles(["rj14 ab-1234", "RJ14AB1234", "mh12xy9999"]), ["RJ14AB1234", "MH12XY9999"]);
  assert.deepEqual(wallets.cleanVehicles([]), []);
  assert.deepEqual(wallets.cleanVehicles(), []);
  assert.throws(() => wallets.cleanVehicles(["ab"]), /4 to 12/);
  assert.throws(() => wallets.cleanVehicles(["AAAA1", "AAAA2", "AAAA3", "AAAA4", "AAAA5", "AAAA6"]), /at most 5/);
});

test("brief: what the exit screen sees, and whether the balance is enough", () => {
  const w = { _id: id(), number: "W-ABCDEFGH", holderName: "Ravi", status: "ACTIVE", balancePaise: 5000 };
  assert.deepEqual(wallets.brief(w, 50), { _id: id(), number: "W-ABCDEFGH", holderName: "Ravi", status: "ACTIVE", balance: 50, enough: true });
  assert.equal(wallets.brief(w, 50.01).enough, false);
  assert.equal(wallets.brief({ ...w, status: "BLOCKED" }, 10).enough, false);
  assert.equal("enough" in wallets.brief(w), false);
});

test("isLow: below the alert amount; 0 never alerts", () => {
  assert.ok(wallets.isLow({ balancePaise: 9999, lowBalanceAlert: 100 }));
  assert.ok(!wallets.isLow({ balancePaise: 10000, lowBalanceAlert: 100 }));
  assert.ok(!wallets.isLow({ balancePaise: 0, lowBalanceAlert: 0 }));
});

test("maxBalance: default and the environment setting", () => {
  delete process.env.WALLET_MAX_BALANCE;
  assert.equal(wallets.maxBalance(), 50000);
  process.env.WALLET_MAX_BALANCE = "2000";
  assert.equal(wallets.maxBalance(), 2000);
  process.env.WALLET_MAX_BALANCE = "junk";
  assert.equal(wallets.maxBalance(), 50000);
  delete process.env.WALLET_MAX_BALANCE;
});

test("topUp: refuses amounts that are out of range or have too many decimals before touching anything", () => {
  const wallet = { _id: id(), companyId: id() };
  assert.throws(() => wallets.topUp({ wallet, amount: 10.555, method: "CASH" }), /2 decimals/);
  assert.throws(() => wallets.topUp({ wallet, amount: 0.5, method: "CASH" }), /between/);
  assert.throws(() => wallets.topUp({ wallet, amount: 100001, method: "CASH" }), /between/);
});

test("applyChange: a zero change is refused", async () => {
  await assert.rejects(() => wallets.applyChange({ walletId: id(), companyId: id(), deltaPaise: 0, type: "ADJUST" }), /cannot be zero/);
  await assert.rejects(() => wallets.applyChange({ walletId: id(), companyId: id(), deltaPaise: 1.5, type: "ADJUST" }), /cannot be zero/);
});

test("models: a wallet balance cannot be negative or fractional; plates are limited", () => {
  const base = { companyId: id(), number: "W-ABCDEFGH", holderName: "Ravi" };
  assert.equal(new Wallet(base).validateSync(), undefined);
  assert.ok(new Wallet({ ...base, balancePaise: -1 }).validateSync().errors.balancePaise);
  assert.ok(new Wallet({ ...base, balancePaise: 10.5 }).validateSync().errors.balancePaise);
  assert.ok(new Wallet({ ...base, status: "CLOSED" }).validateSync().errors.status);
  assert.equal(new Wallet({ ...base, balancePaise: 12345 }).balance, 123.45);

  const txn = { companyId: id(), walletId: id(), type: "TOPUP", deltaPaise: 100, balanceAfterPaise: 100 };
  assert.equal(new WalletTxn(txn).validateSync(), undefined);
  assert.ok(new WalletTxn({ ...txn, type: "GIFT" }).validateSync().errors.type);
  assert.ok(new WalletTxn({ ...txn, deltaPaise: 1.5 }).validateSync().errors.deltaPaise);
  assert.ok(new WalletTxn({ ...txn, method: "GATEWAY" }).validateSync().errors.method);
});

test("WALLET is a recorded (manual) payment method, never an online one", () => {
  assert.ok(PAYMENT_METHODS.includes("WALLET"));
  assert.ok(gateway.isManual("WALLET"));
  const payment = { companyId: id(), locationId: id(), sessionId: id(), amount: 40, method: "WALLET", walletId: id() };
  assert.equal(new Payment(payment).validateSync(), undefined);
});

test("permission: admins manage wallets, operators only collect; a custom role may be given it", () => {
  const P = PERMISSIONS.WALLET_MANAGE;
  assert.ok(hasPermission(ROLES.COMPANY_ADMIN, P));
  assert.ok(hasPermission(ROLES.LOCATION_ADMIN, P));
  assert.ok(hasPermission(ROLES.SUPER_ADMIN, P));
  for (const role of [ROLES.ENTRY_OPERATOR, ROLES.EXIT_OPERATOR, ROLES.COLLECTION_OPERATOR]) {
    assert.ok(!hasPermission(role, P), role);
  }
  assert.ok(hasPermission(ROLES.EXIT_OPERATOR, PERMISSIONS.PAYMENT_COLLECT));
  assert.ok(GRANTABLE_PERMISSIONS.includes(P));
  assert.ok(PERMISSION_INFO[P].label);
});
