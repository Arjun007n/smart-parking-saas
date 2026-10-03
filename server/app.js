const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const env = require("./config/env");
const { notFound, errorHandler } = require("./middleware/errorHandler");

// Builds the Express app without starting it, so tests can use it too.
const app = express();

// Needed for correct client IPs (rate limiting, audit) behind a hosting proxy.
if (env.isProduction) app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(
  express.json({
    limit: "100kb",
    // Keep the exact bytes of the payment webhook so its signature can be checked.
    verify: (req, res, buffer) => {
      if (req.originalUrl.startsWith("/api/payments/webhook")) req.rawBody = buffer;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

if (env.nodeEnv !== "test") app.use(morgan(env.isProduction ? "combined" : "dev"));

app.get("/", (req, res) => {
  res.json({ success: true, message: "Smart Parking SaaS API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Smart Parking API healthy", environment: env.nodeEnv });
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/companies", require("./routes/companyRoutes"));
app.use("/api/locations", require("./routes/locationRoutes"));
app.use("/api/slots", require("./routes/slotRoutes"));
app.use("/api/vehicles", require("./routes/vehicleRoutes"));
app.use("/api/tariffs", require("./routes/tariffRoutes"));
app.use("/api/parking", require("./routes/parkingRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/shifts", require("./routes/shiftRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/audit-logs", require("./routes/auditRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/leads", require("./routes/leadRoutes"));
app.use("/api/faq", require("./routes/cmsRoutes").faq);
app.use("/api/blog", require("./routes/cmsRoutes").blog);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
