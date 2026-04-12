const express = require("express");
const router = express.Router();
const { handleFezWebhook } = require("../controllers/fezWebhookController");

router.post("/fez", handleFezWebhook);

module.exports = router;

export {};
