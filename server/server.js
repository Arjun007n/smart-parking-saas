const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const env = require("./config/env");
const connectDB = require("./config/database");

env.validateEnv();

const app = require("./app");
const { checkSubscriptions } = require("./services/notificationService");

// Looks for trials about to end and overdue subscriptions, now and twice a day.
const watchSubscriptions = () => {
  const run = () => checkSubscriptions().catch((error) => console.error("Subscription check failed:", error.message));
  run();
  setInterval(run, 12 * 60 * 60 * 1000).unref();
};

const start = async () => {
  await connectDB();
  app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
  watchSubscriptions();
};

start();
