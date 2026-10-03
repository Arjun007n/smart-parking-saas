// Creates the platform Super Admin. Run once:  npm run seed:admin
// Reads SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD from .env.
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const { ROLES } = require("../config/permissions");

const run = async () => {
  const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME, MONGO_URI } = process.env;
  if (!MONGO_URI || !SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
    throw new Error("Set MONGO_URI, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in server/.env first");
  }
  if (SUPER_ADMIN_PASSWORD.length < 12) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters");
  }

  await mongoose.connect(MONGO_URI);

  const email = SUPER_ADMIN_EMAIL.toLowerCase().trim();
  if (await User.exists({ email })) {
    console.log(`A user with email ${email} already exists. Nothing changed.`);
  } else {
    await User.create({
      name: SUPER_ADMIN_NAME || "Super Admin",
      email,
      password: SUPER_ADMIN_PASSWORD,
      role: ROLES.SUPER_ADMIN,
    });
    console.log(`Super Admin created: ${email}`);
  }
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
