const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const newsletterController = require("../controllers/adminNewsletterController");

const unresolvedHandler = (name) => (_req, res) =>
  res.status(500).json({ message: `${name} is not configured correctly.` });

const protect =
  typeof authMiddleware?.protect === "function"
    ? authMiddleware.protect
    : typeof authMiddleware?.default?.protect === "function"
      ? authMiddleware.default.protect
      : unresolvedHandler("protect");

const adminOnly =
  typeof authMiddleware?.adminOnly === "function"
    ? authMiddleware.adminOnly
    : typeof authMiddleware?.default?.adminOnly === "function"
      ? authMiddleware.default.adminOnly
      : unresolvedHandler("adminOnly");

const listSubscribers =
  typeof newsletterController?.listSubscribers === "function"
    ? newsletterController.listSubscribers
    : typeof newsletterController?.default?.listSubscribers === "function"
      ? newsletterController.default.listSubscribers
      : unresolvedHandler("listSubscribers");

const sendNewsletter =
  typeof newsletterController?.sendNewsletter === "function"
    ? newsletterController.sendNewsletter
    : typeof newsletterController?.default?.sendNewsletter === "function"
      ? newsletterController.default.sendNewsletter
      : unresolvedHandler("sendNewsletter");

const router = express.Router();

router.get(
  "/subscribers",
  protect,
  adminOnly,
  listSubscribers
);

router.post(
  "/send",
  protect,
  adminOnly,
  sendNewsletter
);

module.exports = router;

export {};
