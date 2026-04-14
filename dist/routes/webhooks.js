"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const router = express.Router();
const { handleFezWebhook } = require("../controllers/fezWebhookController");
router.post("/fez", handleFezWebhook);
module.exports = router;
