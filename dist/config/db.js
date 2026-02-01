"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGO_URI is not defined in environment variables');
        }
        const conn = await mongoose_1.default.connect(mongoUri);
        console.log(`MongoDB connected: ${conn.connection.host}`);
    }
    catch (err) {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    }
};
exports.default = connectDB;
