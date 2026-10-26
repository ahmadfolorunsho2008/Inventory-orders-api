const mongoose = require("mongoose");
const app = require("./app");
const Product = require("./Product");
const Order = require("./Order");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/inventory";
const PORT = process.env.PORT || 3000;

async function start() {
  await mongoose.connect(MONGO_URI);
  // Make sure the unique sku index exists before accepting requests
  await Product.init();
  await Order.init();

  app.listen(PORT, () => {
    console.log(`Inventory & Orders API running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Could not start the server:", err.message);
  process.exit(1);
});
