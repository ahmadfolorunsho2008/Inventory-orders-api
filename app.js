const express = require("express");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");

const app = express();
app.use(express.json());

app.use("/products", productRoutes);
app.use("/orders", orderRoutes);

// Unknown route
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler (must have 4 parameters)
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON" });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: "A product with this sku already exists" });
  }
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: err.message });
  }
  if (err.name === "CastError") {
    return res.status(400).json({ error: "Invalid value" });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

module.exports = app;
