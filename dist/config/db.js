"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("./prisma"));
const connectDB = async () => {
    try {
        await prisma_1.default.$connect();
        await prisma_1.default.$queryRaw `SELECT 1`;
        console.log("PostgreSQL connected via Prisma");
    }
    catch (err) {
        console.error("PostgreSQL connection error:", err.message);
        process.exit(1);
    }
};
exports.default = connectDB;
