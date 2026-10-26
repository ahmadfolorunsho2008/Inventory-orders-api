const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^[A-Z0-9-]+$/, "sku may only use capital letters, digits and hyphens"],
    },
    price: {
      type: Number,
      required: true,
      validate: { validator: (v) => v > 0, message: "price must be positive" },
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: "stock must be a whole number" },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
