const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    entityType: { type: String, default: "" },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null },
    message: { type: String, default: "" },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ActivityLog", activityLogSchema);
