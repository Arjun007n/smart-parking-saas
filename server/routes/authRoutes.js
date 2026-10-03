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

const password = { type: "string", required: true, min: 8, max: 72 };
const email = { type: "email", required: true };

router.post(
  "/register",
  authLimiter,
  validateBody({
    companyName: { type: "string", required: true, min: 2, max: 150 },
    name: { type: "string", required: true, min: 2, max: 100 },
    email,
    phone: { type: "string", max: 20 },
    password,
  }),
  controller.register
);
router.post(
  "/login",
  authLimiter,
  validateBody({ email, password: { type: "string", required: true, max: 72 } }),
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
router.get("/me", protect, controller.me);

module.exports = router;
