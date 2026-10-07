const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const env = require("./config/env");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const rateLimit = require("./middleware/rateLimit");

// Builds the Express app without starting it, so tests can use it too.
const app = express();

// Needed for correct client IPs (rate limiting, audit) behind a hosting proxy.
if (env.isProduction) app.set("trust proxy", 1);

// Optional: refuse plain http in production (when the host does not already
// redirect to https). `req.secure` uses the proxy's x-forwarded-proto header.
if (env.isProduction && env.forceHttps) {
  app.use((req, res, next) => {
    if (req.secure) return next();
    if (req.method === "GET" || req.method === "HEAD") {
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    }
    return res.status(400).json({ success: false, message: "Use https" });
  });
}

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

// A ceiling on requests per IP address for the whole API, on top of the
// stricter limits on login, password and contact-form routes.
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: () => env.apiRateLimitMax });
// Gate devices poll every second or two, often several behind one address, so
// they have their own, much higher ceiling and do not use up the people's.
const deviceLimiter = rateLimit({ windowMs: 60 * 1000, max: () => env.apiRateLimitMax * 5 });
app.use("/api", (req, res, next) => (req.path.startsWith("/device") ? deviceLimiter : apiLimiter)(req, res, next));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/roles", require("./routes/roleRoutes"));
app.use("/api/companies", require("./routes/companyRoutes"));
app.use("/api/locations", require("./routes/locationRoutes"));
app.use("/api/slots", require("./routes/slotRoutes"));
app.use("/api/vehicles", require("./routes/vehicleRoutes"));
app.use("/api/tariffs", require("./routes/tariffRoutes"));
app.use("/api/parking", require("./routes/parkingRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/billing", require("./routes/billingRoutes"));
app.use("/api/shop", require("./routes/shopRoutes"));
app.use("/api/wallets", require("./routes/walletRoutes"));
app.use("/api/operator", require("./routes/operatorRoutes"));
app.use("/api/government", require("./routes/governmentRoutes"));
app.use("/api/bookings", require("./routes/bookingRoutes"));
app.use("/api/passes", require("./routes/passRoutes"));
app.use("/api/pass-companies", require("./routes/passCompanyRoutes"));
app.use("/api/shifts", require("./routes/shiftRoutes"));
app.use("/api/hardware", require("./routes/hardwareRoutes"));
app.use("/api/anpr", require("./routes/anprRoutes"));
app.use("/api/device", require("./routes/deviceRoutes"));
app.use("/api/live", require("./routes/liveRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/audit-logs", require("./routes/auditRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/public/booking", require("./routes/publicBookingRoutes"));
app.use("/api/leads", require("./routes/leadRoutes"));
app.use("/api/faq", require("./routes/cmsRoutes").faq);
app.use("/api/blog", require("./routes/cmsRoutes").blog);
app.use("/api/testimonials", require("./routes/cmsRoutes").testimonials);
app.use("/api/public/stats", require("./routes/cmsRoutes").stats);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
