const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const env = require("./config/env");
const connectDB = require("./config/database");

env.validateEnv();

const app = require("./app");
const { checkSubscriptions } = require("./services/notificationService");
const { sweep: sweepHardware } = require("./services/hardwareService");
const { checkPassExpiry, backfillVehicles } = require("./services/passService");
const { sweepPending: sweepPayments } = require("./services/paymentService");
const { sweep: sweepBookingPayments } = require("./services/onlineBookingService");
const { sweep: sweepPlanOrders } = require("./services/billingService");
const { sweep: sweepShopOrders } = require("./services/shopService");
const { sweep: sweepFastag } = require("./services/fastagService");
const { purgeExpired: purgePhotos } = require("./services/photoService");
const { runDue: sendDueReports } = require("./services/dailyReportService");
const { migrateIndexes: migratePaymentIndexes } = require("./services/advanceService");

// Looks for trials about to end and overdue subscriptions, now and twice a day.
const watchSubscriptions = () => {
  const run = () => checkSubscriptions().catch((error) => console.error("Subscription check failed:", error.message));
  run();
  setInterval(run, 12 * 60 * 60 * 1000).unref();
};

// Warns about passes that end within a week, now and twice a day.
const watchPasses = () => {
  const run = () => checkPassExpiry().catch((error) => console.error("Pass expiry check failed:", error.message));
  run();
  setInterval(run, 12 * 60 * 60 * 1000).unref();
};

// Every 30 seconds: mark silent devices offline, expire commands that missed
// their deadline, drop stale plate suggestions.
const watchHardware = () => {
  const run = () => sweepHardware().catch((error) => console.error("Hardware sweep failed:", error.message));
  setInterval(run, 30 * 1000).unref();
};

// Every minute: ask the gateway about online payments whose result never
// arrived, and close the ones that ran out of time.
const watchPayments = () => {
  const run = () => sweepPayments().catch((error) => console.error("Payment sweep failed:", error.message));
  setInterval(run, 60 * 1000).unref();
  const runBookings = () => sweepBookingPayments().catch((error) => console.error("Booking payment sweep failed:", error.message));
  setInterval(runBookings, 60 * 1000).unref();
  const runPlans = () => sweepPlanOrders().catch((error) => console.error("Plan payment sweep failed:", error.message));
  setInterval(runPlans, 60 * 1000).unref();
  const runShop = () => sweepShopOrders().catch((error) => console.error("Shop payment sweep failed:", error.message));
  setInterval(runShop, 60 * 1000).unref();
  const runFastag = () => sweepFastag().catch((error) => console.error("FASTag sweep failed:", error.message));
  setInterval(runFastag, 60 * 1000).unref();
};

// Once a day: delete vehicle photos older than PHOTO_RETENTION_DAYS (default 90).
const watchPhotos = () => {
  const run = () => purgePhotos().catch((error) => console.error("Photo clean-up failed:", error.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
};

// Every 5 minutes: send the end-of-day report emails that are due.
const watchReports = () => {
  const run = () => sendDueReports().catch((error) => console.error("Daily report run failed:", error.message));
  setInterval(run, 5 * 60 * 1000).unref();
};

const mongoose = require("mongoose");
const { reportError } = require("./utils/monitor");

let server;

const start = async () => {
  await connectDB();
  // Passes made before multi-vehicle support get their vehicle list (safe to repeat).
  await backfillVehicles()
    .then((n) => n && console.log(`Updated ${n} old pass(es) with a vehicle list`))
    .catch((error) => console.error("Pass vehicle backfill failed:", error.message));
  // Lets a session have an advance and a fee payment (replaces an older unique index; safe to repeat).
  await migratePaymentIndexes()
    .then((changed) => changed && console.log("Updated the payment index for advance payments"))
    .catch((error) => console.error("Payment index update failed:", error.message));
  server = app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
  watchSubscriptions();
  watchHardware();
  watchPasses();
  watchPayments();
  watchPhotos();
  watchReports();
};

// Stop cleanly when the host asks (deploys, restarts): finish requests in
// progress, close the database connection, then exit.
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  require("./services/liveHub").closeAll(); // open streams would keep the server from stopping
  const exit = () => mongoose.disconnect().finally(() => process.exit(0));
  if (server) server.close(exit);
  else exit();
  setTimeout(() => process.exit(1), 10000).unref(); // do not hang for ever
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Errors nobody handled: report them. After an uncaught exception the process
// may be in a bad state, so it exits and the host restarts it.
process.on("unhandledRejection", (reason) => reportError(reason instanceof Error ? reason : new Error(String(reason)), { kind: "unhandledRejection" }));
process.on("uncaughtException", (error) => {
  reportError(error, { kind: "uncaughtException" });
  process.exit(1);
});

start();
