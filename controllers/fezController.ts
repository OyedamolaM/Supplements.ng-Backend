const {
  authenticateFez,
  logoutFez,
  changeFezPassword,
  createFezOrderFromPayload,
  updateFezOrder,
  deleteFezOrder,
  getFezOrder,
  trackFezOrder,
  searchFezOrders,
  searchFezOrderByWaybill,
  getFezOrderStatsWithDateRange,
  fetchFezDeliveryCost,
  getFezDeliveryTimeEstimate,
  getFezPickupHubs,
  getFezStates,
  getFezLockersByState,
  createFezImportOrder,
  createFezExportOrder,
  getFezImportDeliveryCost,
  getFezExportDeliveryCost,
  getFezImportLocations,
  getFezExportLocations,
  getFezImportItemCategories,
  registerFezOrderWebhook,
  checkFezLockerAvailability,
  deleteFezUser,
  createFezUser,
  getFezUsers,
} = require("../services/fezService");

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    res.json(result);
  } catch (error) {
    console.error("Fez controller error", error);
    const status = error?.status && Number.isFinite(error.status) ? error.status : 500;
    res.status(status).json({
      message: "Fez request failed",
      error: error?.message || error,
      details: error?.payload,
    });
  }
};

exports.authenticate = handle(() => authenticateFez());
exports.logout = handle((req) => logoutFez(req.body || {}));
exports.changePassword = handle((req) => changeFezPassword(req.body || {}));

exports.createOrder = handle((req) => createFezOrderFromPayload(req.body));
exports.updateOrder = handle((req) => updateFezOrder(req.body));
exports.deleteOrder = handle((req) => deleteFezOrder(req.body));
exports.getOrder = handle((req) => getFezOrder(req.params.orderId));
exports.trackOrder = handle((req) => trackFezOrder(req.params.orderNumber));
exports.searchOrders = handle((req) => searchFezOrders(req.body || {}));
exports.searchOrderByWaybill = handle((req) => searchFezOrderByWaybill(req.params.waybillNumber));
exports.statsWithDateRange = handle((req) => getFezOrderStatsWithDateRange(req.body || {}));
exports.fetchDeliveryCost = handle((req) => fetchFezDeliveryCost(req.body || {}));
exports.deliveryTimeEstimate = handle((req) => getFezDeliveryTimeEstimate(req.body || {}));
exports.pickupHubs = handle((req) => getFezPickupHubs(req.params.stateId));
exports.states = handle(() => getFezStates());
exports.lockersByState = handle((req) => getFezLockersByState(req.params.state));

exports.createImportOrder = handle((req) => createFezImportOrder(req.body));
exports.createExportOrder = handle((req) => createFezExportOrder(req.body));
exports.importDeliveryCost = handle((req) => getFezImportDeliveryCost(req.body || {}));
exports.exportDeliveryCost = handle((req) => getFezExportDeliveryCost(req.body || {}));
exports.importLocations = handle(() => getFezImportLocations());
exports.exportLocations = handle(() => getFezExportLocations());
exports.importItemCategories = handle(() => getFezImportItemCategories());

exports.registerOrderWebhook = handle((req) => registerFezOrderWebhook(req.body || {}));
exports.checkLockerAvailability = handle((req) => checkFezLockerAvailability(req.params.lockerId));
exports.deleteUser = handle((req) => deleteFezUser(req.params.userId));
exports.createUser = handle((req) => createFezUser(req.body || {}));
exports.getUsers = handle(() => getFezUsers());
