require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

const run = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is required");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const before = await User.find({}, { email: 1, role: 1 }).sort({ email: 1 });
    console.log("Current users (email -> role):");
    before.forEach((u) => {
      console.log(`- ${u.email || "(no email)"} -> ${u.role || "unknown"}`);
    });

    const result = await User.updateMany(
      { role: "user" },
      { $set: { role: "customer" } }
    );

    console.log(`Updated ${result.modifiedCount || 0} user(s) to customer role.`);

    const after = await User.find({}, { email: 1, role: 1 }).sort({ email: 1 });
    const counts = after.reduce((acc, u) => {
      const key = u.role || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    console.log("Role counts:", counts);
  } catch (err) {
    console.error("Migration failed:", err.message);
  } finally {
    await mongoose.disconnect();
  }
};

run();
