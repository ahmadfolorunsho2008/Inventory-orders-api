const mongoose = require("mongoose");

const orderLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: "quantity must be a whole number" },
    },
    // Snapshot of the price at the moment the order was placed
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    items: {
      type: [orderLineSchema],
      validate: { validator: (v) => v.length > 0, message: "an order needs at least one item" },
    },
    total: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["placed", "cancelled"], default: "placed" },
  },
  { timestamps: true }
);

// Makes "is this product in any order?" fast
orderSchema.index({ "items.productId": 1 });

module.exports = mongoose.model("Order", orderSchema);
