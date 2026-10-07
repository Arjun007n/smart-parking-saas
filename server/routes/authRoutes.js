const router = require("express").Router();
const env = require("../config/env");
const controller = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const rateLimit = require("../middleware/rateLimit");

// Slows down password guessing and reset-email abuse.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => env.authRateLimitMax,
  message: "Too many attempts. Please try again in a few minutes.",
});

// Logins get a higher limit: many operators of one site share an IP address
// and log in at shift change. Guessing one account is stopped by the
// per-account lock in services/loginGuard.js.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => env.authRateLimitMax * 5,
  message: "Too many login attempts from this network. Please try again in a few minutes.",
});

// The signup form asks as the admin types a code, so this allows more than the sign-in calls.
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => env.authRateLimitMax * 5,
  message: "Too many checks. Please try again in a few minutes.",
});

const password = { type: "string", required: true, min: 8, max: 72 };
const email = { type: "email", required: true };

const mobile = { type: "string", required: true, max: 20, pattern: /^[0-9+\-\s()]{6,20}$/, message: "must be a phone number" };
// Text messages cost money: a tighter limit than the other sign-in calls.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many code requests. Please try again in a few minutes.",
});

router.get("/signup-options", controller.signupOptions);
router.get("/company-code", codeLimiter, controller.checkCompanyCode);
router.post("/otp/send", otpLimiter, validateBody({ phone: mobile }), controller.sendOtp);
router.post(
  "/otp/verify",
  otpLimiter,
  validateBody({ phone: mobile, code: { type: "string", required: true, min: 4, max: 8, pattern: /^[0-9]+$/, message: "must be the digits of the code" } }),
  controller.verifyOtp
);
router.post(
  "/register",
  authLimiter,
  validateBody({
    companyName: { type: "string", required: true, min: 2, max: 150 },
    // The code everyone in the company signs in with, chosen by the admin (made automatically when left out).
    companyCode: { type: "string", max: 20 },
    name: { type: "string", required: true, min: 2, max: 100 },
    email,
    phone: { type: "string", max: 20 },
    phoneToken: { type: "string", max: 1000 },
    // Optional billing details, asked at signup so the first invoice is ready (can be changed on the Company page).
    gstNumber: { type: "string", max: 15, upper: true, pattern: /^[0-9]{2}[A-Z0-9]{13}$/, message: "must be a 15 character GSTIN" },
    city: { type: "string", max: 100 },
    state: { type: "string", max: 100 },
    password,
  }),
  controller.register
);
router.post(
  "/login",
  loginLimiter,
  // A company code, and a Login ID or an email (the controller checks which; the platform administrator needs no code).
  validateBody({
    email: { type: "email" },
    companyCode: { type: "string", max: 20 },
    loginId: { type: "string", max: 40 },
    password: { type: "string", required: true, max: 72 },
    // The Government login page sends this; only government officers may sign in there (and only there).
    portal: { type: "string", enum: ["government"] },
  }),
  controller.login
);
router.post("/forgot-password", authLimiter, validateBody({ email }), controller.forgotPassword);
router.post(
  "/reset-password",
  authLimiter,
  validateBody({ token: { type: "string", required: true, max: 200 }, password }),
  controller.resetPassword
);
router.post("/logout", protect, controller.logout);
router.post(
  "/change-password",
  authLimiter,
  protect,
  validateBody({ currentPassword: { type: "string", required: true, max: 72 }, newPassword: password }),
  controller.changePassword
);
router.get("/me", protect, controller.me);
router.put(
  "/preferences",
  protect,
  validateBody({
    emailAlerts: { type: "string", enum: ["OFF", "CRITICAL", "IMPORTANT", "ALL"] },
    phoneAlerts: { type: "string", enum: ["OFF", "CRITICAL", "IMPORTANT", "ALL"] },
  }),
  controller.updatePreferences
);
router.put(
  "/profile",
  protect,
  validateBody({
    name: { type: "string", required: true, min: 2, max: 100 },
    phone: { type: "string", max: 20, pattern: /^[0-9+\-\s()]{6,20}$/, message: "must be a phone number" },
  }),
  controller.updateProfile
);

module.exports = router;
