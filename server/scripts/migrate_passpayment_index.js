// One-time database change: a pass payment reference (PassPayment.transactionId) used to be unique
// across ALL companies; it is now unique per company ({ companyId, transactionId }).
//
//   node scripts/migrate_passpayment_index.js
//
// Run it once after deploying this version (it is never run automatically). It builds the new index
// first, then drops the old global one, so references stay protected the whole time. It is safe to run
// again. The app works before and after: until the old index is dropped, a reference already used by
// another company is still refused (with the same "already used" message).
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const mongoose = require("mongoose");

const PARTIAL = { transactionId: { $type: "string" } };
const NEW_KEY = { companyId: 1, transactionId: 1 };

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI in server/.env first");
  await mongoose.connect(process.env.MONGO_URI);
  const collection = mongoose.connection.db.collection("passpayments");

  const existing = await collection.indexes().catch((error) => {
    if (error.codeName === "NamespaceNotFound" || error.code === 26) return [];
    throw error;
  });
  const sameKey = (index, key) => JSON.stringify(index.key) === JSON.stringify(key);

  if (existing.some((index) => sameKey(index, NEW_KEY))) {
    console.log("New index { companyId, transactionId } already exists.");
  } else {
    await collection.createIndex(NEW_KEY, { unique: true, partialFilterExpression: PARTIAL, name: "companyId_1_transactionId_1" });
    console.log("Created the unique index { companyId, transactionId }.");
  }

  const old = existing.find((index) => sameKey(index, { transactionId: 1 }));
  if (old) {
    await collection.dropIndex(old.name);
    console.log(`Dropped the old global index ${old.name}.`);
  } else {
    console.log("The old global index { transactionId } is not there. Nothing to drop.");
  }
};

run()
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
