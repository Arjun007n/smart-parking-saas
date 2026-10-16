// Over-wide reads (no database): phone numbers are masked for counter staff in vehicle and wallet answers, and
// operators get a reduced company record. The database calls are replaced.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Vehicle = require("../models/Vehicle");
const Wallet = require("../models/Wallet");
const Company = require("../models/Company");
const vehicleController = require("../controllers/vehicleController");
const walletController = require("../controllers/walletController");
const companyController = require("../controllers/companyController");
const { ROLE_PERMISSIONS } = require("../config/permissions");

const COMPANY = new mongoose.Types.ObjectId();
const fakeRes = () => {
  const res = { body: null, code: 200 };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const as = (role, extra = {}) => ({
  user: { _id: "u1", role, companyId: COMPANY, locationIds: [] },
  permissions: ROLE_PERMISSIONS[role], tenantFilter: { companyId: COMPANY }, companyId: COMPANY,
  params: {}, query: {}, body: {}, ...extra,
});

test("maskPhone keeps the last digits and the length", () => {
  const { maskPhone } = vehicleController;
  assert.equal(maskPhone("9876543210"), "******3210");
  assert.equal(maskPhone("+91 98765 43210"), "***********3210");
  assert.equal(maskPhone("12345"), "***45");
  assert.equal(maskPhone("12"), "**");
  assert.equal(maskPhone(""), "");
  assert.equal(maskPhone(undefined), undefined);
});

const stubVehicles = (fn) => async () => {
  const find = Vehicle.find;
  const count = Vehicle.countDocuments;
  const findOne = Vehicle.findOne;
  const doc = new Vehicle({ companyId: COMPANY, plateNumber: "MH12AB1234", type: "CAR", ownerName: "Asha", phone: "9876543210" });
  Vehicle.find = () => ({ sort: () => ({ skip: () => ({ limit: async () => [doc] }) }) });
  Vehicle.countDocuments = async () => 1;
  Vehicle.findOne = async () => doc;
  try {
    await fn(doc);
  } finally {
    Vehicle.find = find;
    Vehicle.countDocuments = count;
    Vehicle.findOne = findOne;
  }
};

test("SP-15: gate staff see a masked phone in the vehicle list and detail; managers and report viewers see it all", stubVehicles(async () => {
  for (const role of ["ENTRY_OPERATOR", "EXIT_OPERATOR", "GATE_OPERATOR"]) {
    const list = fakeRes();
    await vehicleController.listVehicles(as(role), list);
    const v = list.body.data.vehicles[0];
    assert.equal(v.phone, "******3210", role);
    assert.equal(v.plateNumber, "MH12AB1234", "the plate (what operators look up) is unchanged");
    assert.equal(v.ownerName, "Asha");
    assert.ok(v._id);
    assert.equal(list.body.data.total, 1);

    const one = fakeRes();
    await vehicleController.getVehicle(as(role, { params: { id: "x" } }), one);
    assert.equal(one.body.data.phone, "******3210");
  }
  for (const role of ["COMPANY_ADMIN", "LOCATION_ADMIN", "SUPERVISOR", "VIEWER", "COLLECTION_OPERATOR"]) {
    const list = fakeRes();
    await vehicleController.listVehicles(as(role), list);
    assert.equal(list.body.data.vehicles[0].phone, "9876543210", role);
  }
}));

test("SP-15: the stored vehicle is not changed by masking, and a vehicle with no phone is left alone", stubVehicles(async (doc) => {
  await vehicleController.listVehicles(as("GATE_OPERATOR"), fakeRes());
  assert.equal(doc.phone, "9876543210");
  doc.phone = undefined;
  const res = fakeRes();
  await vehicleController.getVehicle(as("GATE_OPERATOR", { params: { id: "x" } }), res);
  assert.equal(res.body.data.phone, undefined);
}));

test("SP-15: wallets: counter staff see the holder's phone masked, wallet managers and report viewers see it", async () => {
  const find = Wallet.find;
  const count = Wallet.countDocuments;
  const findOne = Wallet.findOne;
  const wallet = new Wallet({ companyId: COMPANY, number: "W-ABCD2345", holderName: "Ravi", phone: "9123456789", vehicles: ["RJ14WL0001"] });
  Wallet.find = () => ({ sort: () => ({ skip: () => ({ limit: async () => [wallet] }) }) });
  Wallet.countDocuments = async () => 1;
  Wallet.findOne = async () => wallet;
  const WalletTxn = require("../models/WalletTxn");
  const txnFind = WalletTxn.find;
  WalletTxn.find = () => ({ sort: () => ({ limit: () => ({ populate: async () => [] }) }) });
  try {
    for (const role of ["EXIT_OPERATOR", "GATE_OPERATOR"]) {
      const list = fakeRes();
      await walletController.listWallets(as(role), list);
      const w = list.body.data.wallets[0];
      assert.equal(w.phone, "******6789", role);
      assert.equal(w.number, "W-ABCD2345");
      assert.equal(w.holderName, "Ravi");
      assert.deepEqual(w.vehicles, ["RJ14WL0001"]);
      assert.equal(typeof w.low, "boolean");

      const one = fakeRes();
      await walletController.getWallet(as(role, { params: { id: "x" } }), one);
      assert.equal(one.body.data.wallet.phone, "******6789");
    }
    for (const role of ["COMPANY_ADMIN", "LOCATION_ADMIN", "SUPERVISOR"]) {
      const list = fakeRes();
      await walletController.listWallets(as(role), list);
      assert.equal(list.body.data.wallets[0].phone, "9123456789", role);
    }
    assert.equal(wallet.phone, "9123456789", "the stored wallet is not changed");
  } finally {
    Wallet.find = find;
    Wallet.countDocuments = count;
    Wallet.findOne = findOne;
    WalletTxn.find = txnFind;
  }
});

test("SP-15: companies: operators get a reduced record, company managers and the platform get everything", async () => {
  const findById = Company.findById;
  const find = Company.find;
  const company = new Company({
    _id: COMPANY, name: "Acme Parking", legalName: "Acme Pvt Ltd", gstNumber: "29ABCDE1234F1Z5", taxId: "TAX-1",
    billingContact: { name: "Bill", email: "bill@acme.test", phone: "9999999999" },
    address: { line1: "1 Road", city: "Pune" }, reportEmail: { enabled: true, recipients: ["boss@acme.test"] },
    plan: { name: "Pro", maxLocations: 5, maxUsers: 20 }, subscriptionStatus: "ACTIVE",
  });
  Company.findById = async () => company;
  Company.find = () => ({ sort: () => ({ limit: async () => [company] }) });
  const secrets = ["billingContact", "gstNumber", "taxId", "reportEmail", "address", "legalName"];
  try {
    for (const role of ["GATE_OPERATOR", "ENTRY_OPERATOR", "EXIT_OPERATOR", "COLLECTION_OPERATOR", "VIEWER", "SUPERVISOR"]) {
      const one = fakeRes();
      await companyController.getCompany(as(role, { params: { id: String(COMPANY) } }), one);
      const c = one.body.data;
      assert.equal(c.name, "Acme Parking", role);
      assert.ok(c.code === undefined || typeof c.code === "string");
      assert.equal(c.plan.maxUsers, 20);
      assert.equal(c.subscriptionStatus, "ACTIVE");
      assert.equal(String(c._id), String(COMPANY));
      for (const key of secrets) assert.equal(c[key], undefined, `${role} must not see ${key}`);

      const list = fakeRes();
      await companyController.listCompanies(as(role), list);
      for (const key of secrets) assert.equal(list.body.data[0][key], undefined, `${role} list must not show ${key}`);
      assert.equal(list.body.data[0].name, "Acme Parking");
    }
    for (const role of ["COMPANY_ADMIN", "SUPER_ADMIN"]) {
      const one = fakeRes();
      await companyController.getCompany(as(role, { params: { id: String(COMPANY) } }), one);
      assert.equal(one.body.data.gstNumber, "29ABCDE1234F1Z5", role);
      assert.equal(one.body.data.billingContact.email, "bill@acme.test");
      assert.deepEqual([...one.body.data.reportEmail.recipients], ["boss@acme.test"]);
    }
    // Another company's record is still not reachable.
    const other = as("GATE_OPERATOR", { params: { id: String(new mongoose.Types.ObjectId()) } });
    await assert.rejects(() => companyController.getCompany(other, fakeRes()), (e) => e.statusCode === 404);
  } finally {
    Company.findById = findById;
    Company.find = find;
  }
});
