const express = require("express");
const router = express.Router();
const { handleFezWebhook } = require("../controllers/fezWebhookController");
const {
  verifyWhatsAppWebhook,
  handleWhatsAppWebhook,
} = require("../controllers/whatsappWebhookController");

router.get("/whatsapp", verifyWhatsAppWebhook);
router.post("/whatsapp", handleWhatsAppWebhook);
router.post("/fez", handleFezWebhook);

module.exports = router;

export {};
