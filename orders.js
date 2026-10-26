const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Order = require("../models/Order");
const asyncHandler = require("../asyncHandler");

const router = express.Router();

router.param("id", (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  next();
});

// Puts back stock that was already taken. It removes each line from the
// list only after that line is restored, so calling it again is always safe.
async function reverseDecrements(done) {
  while (done.length > 0) {
    const last = done[done.length - 1];
    await Product.updateOne({ _id: last.productId }, { $inc: { stock: last.quantity } });
    done.pop();
  }
}

// GET /orders
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const orders = await Order.find();
    res.json(orders);
  })
);

// GET /orders/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(order);
  })
);

// POST /orders  { "items": [ { "productId": "...", "quantity": 2 } ] }
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const rawItems = req.body && req.body.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }

    // STEP 1: check the shape of the request. Same product twice -> add quantities.
    const wanted = new Map(); // productId (string) -> total quantity
    for (let i = 0; i < rawItems.length; i++) {
      const line = rawItems[i];
      const validId =
        line && typeof line.productId === "string" && mongoose.isValidObjectId(line.productId);
      if (!validId || !Number.isInteger(line.quantity) || line.quantity < 1) {
        return res.status(400).json({
          error: `item ${i} needs a valid productId and a whole-number quantity of at least 1`,
        });
      }
      wanted.set(line.productId, (wanted.get(line.productId) || 0) + line.quantity);
    }

    // STEP 2: check everything and collect EVERY problem. Nothing is changed yet.
    const products = await Product.find({ _id: { $in: [...wanted.keys()] } });
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const problems = [];
    for (const [id, qty] of wanted) {
      const product = byId.get(id);
      if (!product) {
        problems.push(`${id}: product not found`);
      } else if (!product.active) {
        problems.push(`${product.sku}: product is not active`);
      } else if (product.stock < qty) {
        problems.push(`${product.sku}: requested ${qty}, only ${product.stock} in stock`);
      }
    }
    if (problems.length > 0) {
      return res.status(409).json({
        error: "Order cannot be placed",
        message: problems.join("; "),
        problems,
      });
    }

    // STEP 3: take the stock, one line at a time, with an atomic check-and-decrement.
    // If any line fails, put back everything taken so far.
    const decremented = [];
    try {
      for (const [id, qty] of wanted) {
        const result = await Product.updateOne(
          { _id: id, active: true, stock: { $gte: qty } },
          { $inc: { stock: -qty } }
        );

        if (result.modifiedCount !== 1) {
          // Someone else took the stock after our check in step 2
          await reverseDecrements(decremented);
          const problem = `${byId.get(id).sku}: stock ran out while placing the order`;
          return res.status(409).json({
            error: "Order cannot be placed",
            message: problem,
            problems: [problem],
          });
        }
        decremented.push({ productId: id, quantity: qty });
      }

      // STEP 4: save the order with a price snapshot for each line.
      const items = [...wanted].map(([id, qty]) => ({
        productId: id,
        quantity: qty,
        unitPrice: byId.get(id).price,
      }));
      const total =
        Math.round(items.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;

      const order = await Order.create({ items, total });
      return res.status(201).json(order);
    } catch (err) {
      // Anything unexpected: undo the stock changes, then let app.js reply
      try {
        await reverseDecrements(decremented);
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
      throw err;
    }
  })
);

// POST /orders/:id/cancel
router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    // Only ONE request can flip placed -> cancelled, so stock is returned exactly once.
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, status: "placed" },
      { status: "cancelled" },
      { new: true }
    );

    if (!order) {
      const exists = await Order.exists({ _id: req.params.id });
      if (!exists) {
        return res.status(404).json({ error: "Order not found" });
      }
      return res.status(409).json({ error: "Order is already cancelled" });
    }

    for (const line of order.items) {
      await Product.updateOne({ _id: line.productId }, { $inc: { stock: line.quantity } });
    }
    res.json(order);
  })
);

module.exports = router;
