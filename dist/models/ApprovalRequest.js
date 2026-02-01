"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
const approvalRequestSchema = new mongoose.Schema({
    type: { type: String, enum: ["inventory_adjustment", "refund"], required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: "" },
    payload: { type: Object, default: {} },
}, { timestamps: true });
module.exports = mongoose.model("ApprovalRequest", approvalRequestSchema);
