const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/authMiddleware");
const fez = require("../controllers/fezController");

router.use(protect, adminOnly);

router.post("/auth/authenticate", fez.authenticate);
router.post("/auth/logout", fez.logout);
router.post("/auth/change-password", fez.changePassword);

router.post("/orders", fez.createOrder);
router.put("/orders", fez.updateOrder);
router.delete("/orders", fez.deleteOrder);
router.get("/orders/track/:orderNumber", fez.trackOrder);
router.get("/orders/search/waybill/:waybillNumber", fez.searchOrderByWaybill);
router.post("/orders/search", fez.searchOrders);
router.post("/orders/stats-with-date-range", fez.statsWithDateRange);
router.post("/orders/delivery-time-estimate", fez.deliveryTimeEstimate);
router.post("/orders/cost", fez.fetchDeliveryCost);
router.get("/orders/pickup-hubs/:stateId", fez.pickupHubs);
router.get("/orders/states", fez.states);
router.get("/orders/:orderId", fez.getOrder);

router.get("/lockers/:state", fez.lockersByState);
router.get("/lockers/availability/:lockerId", fez.checkLockerAvailability);

router.post("/international/import/orders", fez.createImportOrder);
router.post("/international/export/orders", fez.createExportOrder);
router.post("/international/import/delivery-cost", fez.importDeliveryCost);
router.post("/international/export/delivery-cost", fez.exportDeliveryCost);
router.get("/international/import/locations", fez.importLocations);
router.get("/international/export/locations", fez.exportLocations);
router.get("/international/import/item-categories", fez.importItemCategories);

router.post("/webhooks/register", fez.registerOrderWebhook);

router.post("/users/:userId/delete", fez.deleteUser);
router.post("/users", fez.createUser);
router.get("/users", fez.getUsers);

module.exports = router;

export {};
