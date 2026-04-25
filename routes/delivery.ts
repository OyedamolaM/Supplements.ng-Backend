const express = require("express");
const router = express.Router();
const { calculateDelivery } = require("../controllers/orderController");

router.post("/calculate", calculateDelivery);

module.exports = router;

export {};
