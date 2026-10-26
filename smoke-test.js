// smoke-test.js — run with: npm test
// Uses its OWN database (name must contain "test") and wipes it first.
const mongoose = require("mongoose");
const app = require("./app");
const Product = require("./Product");
const Order = require("./Order");

const TEST_URI = process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/inventory_smoke_test";

let passed = 0;
let failed = 0;
let base = "";

function check(name, condition) {
  if (condition) {
    passed++;
    console.log("  PASS", name);
  } else {
    failed++;
    console.log("  FAIL", name);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function stockOf(id) {
  const r = await api("GET", `/products/${id}`);
  return r.body.stock;
}

async function createProduct(sku, price, stock) {
  const r = await api("POST", "/products", { sku, price, stock });
  return r.body;
}

async function main() {
  if (!TEST_URI.includes("test")) {
    throw new Error('Refusing to wipe a database whose name does not contain "test"');
  }
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  await Product.init();
  await Order.init();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  let r;

  // ---------------------------------------------------------------- products
  section("Products: create and validate");
  r = await api("POST", "/products", { sku: "WIDGET-1", price: 10, stock: 5 });
  check("create product returns 201", r.status === 201);
  check("created product keeps its sku", r.body.sku === "WIDGET-1");
  check("active defaults to true", r.body.active === true);
  const widget = r.body;

  const gadget = await createProduct("GADGET-2", 25.5, 3);
  const lastUnit = await createProduct("LAST-UNIT", 100, 1);
  const solo = await createProduct("SOLO-3", 5, 2);

  r = await api("POST", "/products", { sku: "WIDGET-1", price: 1, stock: 1 });
  check("duplicate sku on create returns 409", r.status === 409);

  const badBodies = [
    ["a lowercase sku", { sku: "widget", price: 1, stock: 1 }],
    ["a sku with spaces", { sku: "AB CD", price: 1, stock: 1 }],
    ["a missing sku", { price: 1, stock: 1 }],
    ["a zero price", { sku: "BAD-1", price: 0, stock: 1 }],
    ["a negative price", { sku: "BAD-1", price: -5, stock: 1 }],
    ["a price sent as a string", { sku: "BAD-1", price: "10", stock: 1 }],
    ["a fractional stock", { sku: "BAD-1", price: 1, stock: 2.5 }],
    ["a negative stock", { sku: "BAD-1", price: 1, stock: -1 }],
  ];
  for (const [label, body] of badBodies) {
    r = await api("POST", "/products", body);
    check(`rejects ${label} with 400`, r.status === 400);
  }

  section("Products: read, update, delete rules");
  r = await api("GET", "/products");
  check("GET /products lists all 4 products", r.status === 200 && r.body.length === 4);

  r = await api("GET", `/products/${widget._id}`);
  check("GET one product returns 200", r.status === 200 && r.body.sku === "WIDGET-1");

  r = await api("GET", `/products/${new mongoose.Types.ObjectId()}`);
  check("GET unknown product id returns 404", r.status === 404);

  r = await api("GET", "/products/not-an-id");
  check("GET malformed id returns 400", r.status === 400);

  r = await api("PATCH", `/products/${solo._id}`, { price: 6 });
  check("PATCH price returns 200 with new price", r.status === 200 && r.body.price === 6);

  r = await api("PATCH", `/products/${solo._id}`, {});
  check("PATCH with no fields returns 400", r.status === 400);

  r = await api("PUT", `/products/${solo._id}`, { sku: "WIDGET-1", price: 5, stock: 2, active: true });
  check("PUT with a duplicate sku returns 409", r.status === 409);

  r = await api("PATCH", `/products/${solo._id}`, { sku: "GADGET-2" });
  check("PATCH with a duplicate sku returns 409", r.status === 409);

  r = await api("PUT", `/products/${solo._id}`, { sku: "SOLO-3" });
  check("PUT with missing fields returns 400", r.status === 400);

  r = await api("PATCH", `/products/${new mongoose.Types.ObjectId()}`, { price: 3 });
  check("PATCH unknown product returns 404", r.status === 404);

  // ------------------------------------------------------------ order success
  section("Orders: a successful order reduces stock");
  r = await api("POST", "/orders", {
    items: [
      { productId: widget._id, quantity: 2 },
      { productId: gadget._id, quantity: 1 },
    ],
  });
  const order1 = r.body;
  check("order returns 201", r.status === 201);
  check("order status is placed", order1.status === "placed");
  check("total is 45.5 (2 x 10 + 1 x 25.5)", order1.total === 45.5);
  check(
    "unitPrice is saved on each line",
    JSON.stringify(order1.items.map((i) => i.unitPrice)) === JSON.stringify([10, 25.5])
  );
  check("widget stock went 5 -> 3", (await stockOf(widget._id)) === 3);
  check("gadget stock went 3 -> 2", (await stockOf(gadget._id)) === 2);

  // ------------------------------------------------------------ order failure
  section("Orders: all-or-nothing");
  const ordersBefore = (await api("GET", "/orders")).body.length;

  r = await api("POST", "/orders", {
    items: [
      { productId: widget._id, quantity: 1 },
      { productId: gadget._id, quantity: 99 },
      { productId: lastUnit._id, quantity: 1 },
    ],
  });
  check("one bad item among several returns 409", r.status === 409);
  check("message names the problem item", String(r.body.message).includes("GADGET-2"));
  check("widget stock did not change", (await stockOf(widget._id)) === 3);
  check("gadget stock did not change", (await stockOf(gadget._id)) === 2);
  check("last-unit stock did not change", (await stockOf(lastUnit._id)) === 1);
  check("no order was created", (await api("GET", "/orders")).body.length === ordersBefore);

  r = await api("POST", "/orders", {
    items: [
      { productId: widget._id, quantity: 50 },
      { productId: gadget._id, quantity: 99 },
    ],
  });
  check(
    "message lists EVERY problem item",
    r.status === 409 &&
      String(r.body.message).includes("WIDGET-1") &&
      String(r.body.message).includes("GADGET-2") &&
      r.body.problems.length === 2
  );

  r = await api("POST", "/orders", { items: [] });
  check("empty items returns 400", r.status === 400);

  r = await api("POST", "/orders", { items: [{ productId: widget._id, quantity: 0 }] });
  check("quantity 0 returns 400", r.status === 400);

  r = await api("POST", "/orders", { items: [{ productId: widget._id, quantity: 1.5 }] });
  check("fractional quantity returns 400", r.status === 400);

  r = await api("POST", "/orders");
  check("missing body returns 400", r.status === 400);

  r = await api("POST", "/orders", {
    items: [{ productId: String(new mongoose.Types.ObjectId()), quantity: 1 }],
  });
  check("unknown product in an order returns 409", r.status === 409);

  r = await api("PATCH", `/products/${solo._id}`, { active: false });
  check("PATCH can deactivate a product", r.status === 200 && r.body.active === false);

  r = await api("POST", "/orders", { items: [{ productId: solo._id, quantity: 1 }] });
  check("ordering an inactive product returns 409", r.status === 409);
  check("inactive product stock did not change", (await stockOf(solo._id)) === 2);

  // ------------------------------------------------------------------- cancel
  section("Orders: cancel returns stock exactly once");
  r = await api("POST", `/orders/${order1._id}/cancel`);
  check("cancel returns 200 and status cancelled", r.status === 200 && r.body.status === "cancelled");
  check("widget stock restored to 5", (await stockOf(widget._id)) === 5);
  check("gadget stock restored to 3", (await stockOf(gadget._id)) === 3);

  r = await api("POST", `/orders/${order1._id}/cancel`);
  check("second cancel returns 409", r.status === 409);
  check("second cancel did not inflate widget stock", (await stockOf(widget._id)) === 5);
  check("second cancel did not inflate gadget stock", (await stockOf(gadget._id)) === 3);

  r = await api("POST", `/orders/${new mongoose.Types.ObjectId()}/cancel`);
  check("cancel unknown order returns 404", r.status === 404);

  r = await api("POST", "/orders/not-an-id/cancel");
  check("cancel malformed id returns 400", r.status === 400);

  // ----------------------------------------------------------- price snapshot
  section("Orders: price snapshot");
  r = await api("POST", "/orders", { items: [{ productId: widget._id, quantity: 1 }] });
  const order2 = r.body;
  check("order at price 10 has total 10", r.status === 201 && order2.total === 10);

  r = await api("PATCH", `/products/${widget._id}`, { price: 99 });
  check("product price changed to 99", r.status === 200 && r.body.price === 99);

  r = await api("GET", `/orders/${order2._id}`);
  check("old order unitPrice is still 10", r.body.items[0].unitPrice === 10);
  check("old order total is still 10", r.body.total === 10);

  r = await api("POST", "/orders", { items: [{ productId: widget._id, quantity: 1 }] });
  check("a new order uses the new price 99", r.body.items[0].unitPrice === 99 && r.body.total === 99);

  // ------------------------------------------------------------------- delete
  section("Products: delete rules");
  r = await api("DELETE", `/products/${widget._id}`);
  check("deleting a product that is in an order returns 409", r.status === 409);

  r = await api("DELETE", `/products/${solo._id}`);
  check("deleting an unused product returns 204", r.status === 204);

  r = await api("GET", `/products/${solo._id}`);
  check("deleted product is gone (404)", r.status === 404);

  // -------------------------------------------------------------- concurrency
  section("Concurrency: two orders for the last unit");
  const results = await Promise.all([
    api("POST", "/orders", { items: [{ productId: lastUnit._id, quantity: 1 }] }),
    api("POST", "/orders", { items: [{ productId: lastUnit._id, quantity: 1 }] }),
  ]);
  const statuses = results.map((x) => x.status).sort();
  check("exactly one order succeeded (201)", statuses.filter((s) => s === 201).length === 1);
  check("exactly one order was refused (409)", statuses.filter((s) => s === 409).length === 1);
  check("last-unit stock is exactly 0, never negative", (await stockOf(lastUnit._id)) === 0);
  const lastUnitOrders = (await api("GET", "/orders")).body.filter((o) =>
    o.items.some((i) => i.productId === lastUnit._id)
  );
  check("only one order contains the last unit", lastUnitOrders.length === 1);

  section("Concurrency: 10 orders for 3 units");
  const busy = await createProduct("BUSY-4", 2, 3);
  const many = await Promise.all(
    Array.from({ length: 10 }, () =>
      api("POST", "/orders", { items: [{ productId: busy._id, quantity: 1 }] })
    )
  );
  check("exactly 3 of 10 orders succeeded", many.filter((x) => x.status === 201).length === 3);
  check("the other 7 were refused with 409", many.filter((x) => x.status === 409).length === 7);
  check("busy product stock is exactly 0", (await stockOf(busy._id)) === 0);

  section("Concurrency: rollback keeps stock consistent");
  const p1 = await createProduct("PAIR-A", 1, 1);
  const p2 = await createProduct("PAIR-B", 1, 1);
  const pair = await Promise.all([
    api("POST", "/orders", {
      items: [
        { productId: p1._id, quantity: 1 },
        { productId: p2._id, quantity: 1 },
      ],
    }),
    api("POST", "/orders", {
      items: [
        { productId: p2._id, quantity: 1 },
        { productId: p1._id, quantity: 1 },
      ],
    }),
  ]);
  const wins = pair.filter((x) => x.status === 201).length;
  check("at most one of the two crossing orders succeeded", wins <= 1);
  check("PAIR-A stock matches the successful orders", (await stockOf(p1._id)) === 1 - wins);
  check("PAIR-B stock matches the successful orders", (await stockOf(p2._id)) === 1 - wins);

  // ------------------------------------------------------------------ summary
  console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);

  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
