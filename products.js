const express = require("express");
const mongoose = require("mongoose");
const Product = require("./Product");
const Order = require("./Order");
const asyncHandler = require("./asyncHandler");

const router = express.Router();
const SKU_PATTERN = /^[A-Z0-9-]+$/;

// Reject malformed ids (400) before any route that uses :id runs
router.param("id", (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  next();
});

// mode is "create", "put" (replace all fields) or "patch" (some fields)
function readFields(body, mode) {
  const input = body || {};
  const data = {};
  const errors = [];
  const needAll = mode !== "patch";

  if (needAll || input.sku !== undefined) {
    if (typeof input.sku === "string" && SKU_PATTERN.test(input.sku)) {
      data.sku = input.sku;
    } else {
      errors.push("sku is required and may only use capital letters, digits and hyphens");
    }
  }

  if (needAll || input.price !== undefined) {
    if (typeof input.price === "number" && Number.isFinite(input.price) && input.price > 0) {
      data.price = input.price;
    } else {
      errors.push("price must be a positive number");
    }
  }

  if (needAll || input.stock !== undefined) {
    if (Number.isInteger(input.stock) && input.stock >= 0) {
      data.stock = input.stock;
    } else {
      errors.push("stock must be a whole number, 0 or more");
    }
  }

  if (mode === "put" || input.active !== undefined) {
    if (typeof input.active === "boolean") {
      data.active = input.active;
    } else {
      errors.push("active must be true or false");
    }
  }

  return { data, errors };
}

// GET /products  (optional ?active=true or ?active=false)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.active !== undefined) {
      if (req.query.active !== "true" && req.query.active !== "false") {
        return res.status(400).json({ error: 'active must be "true" or "false"' });
      }
      filter.active = req.query.active === "true";
    }
    const products = await Product.find(filter);
    res.json(products);
  })
);

// POST /products
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { data, errors } = readFields(req.body, "create");
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join("; ") });
    }
    const product = await Product.create(data); // duplicate sku -> 409 in app.js
    res.status(201).json(product);
  })
);

// GET /products/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(product);
  })
);

async function updateProduct(req, res, mode) {
  const { data, errors } = readFields(req.body, mode);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join("; ") });
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: data },
    { new: true, runValidators: true }
  ); // duplicate sku -> 409 in app.js
  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }
  res.json(product);
}

// PUT /products/:id  (all fields required)
router.put(
  "/:id",
  asyncHandler((req, res) => updateProduct(req, res, "put"))
);

// PATCH /products/:id  (only the fields sent, e.g. { "active": false })
router.patch(
  "/:id",
  asyncHandler((req, res) => updateProduct(req, res, "patch"))
);

// DELETE /products/:id  (409 if the product appears in any order)
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const usedInOrder = await Order.exists({ "items.productId": product._id });
    if (usedInOrder) {
      return res.status(409).json({
        error: "This product appears in an order and cannot be deleted. Deactivate it with PATCH instead.",
      });
    }

    await product.deleteOne();
    res.status(204).send();
  })
);

module.exports = router;
