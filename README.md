# Inventory & Orders API

An Express and Mongoose API for products and orders. The main challenge is keeping stock consistent, so an order either fully succeeds or changes nothing, without using replica-set transactions.

## Setup

You need Node.js and a running MongoDB (local, or a free MongoDB Atlas cluster).

```
npm install
npm run dev
```

Settings (all optional):

| Variable | Default |
|----------|---------|
| `MONGO_URI` | `mongodb://127.0.0.1:27017/inventory` |
| `PORT` | `3000` |
| `MONGO_URI_TEST` | `mongodb://127.0.0.1:27017/inventory_smoke_test` |

## Run the tests

```
npm test
```

`smoke-test.js` starts the app on a random port against a separate test database (its name must contain "test", because it is wiped on every run) and runs 70+ checks. It exits with code 1 if any check fails.

## Endpoints

| Method | Path | What it does |
|--------|------|--------------|
| GET | /products | List products. Optional `?active=true` or `?active=false` |
| POST | /products | Create a product. 409 if the sku already exists |
| GET | /products/:id | Get one product |
| PUT | /products/:id | Replace all fields. 409 on duplicate sku |
| PATCH | /products/:id | Change some fields, e.g. `{ "active": false }` |
| DELETE | /products/:id | Delete a product. 409 if it appears in any order |
| GET | /orders | List orders |
| GET | /orders/:id | Get one order |
| POST | /orders | Place an order (all-or-nothing) |
| POST | /orders/:id/cancel | Cancel a placed order and return its stock once |

## Data rules

- **Product:** `sku` (unique, capital letters, digits and hyphens), `price` (positive), `stock` (whole number, 0 or more), `active` (true or false).
- **Order:** `items` (`productId`, `quantity`, `unitPrice`), `total`, `status` (`placed` or `cancelled`).

## How consistency is kept

1. **Validate first.** `POST /orders` checks every line (product exists, is active, has enough stock) before changing anything. If any line has a problem, the response is a 409 listing every problem item, and no stock changes.
2. **Atomic decrement.** Each line is taken with `updateOne({ _id, active: true, stock: { $gte: qty } }, { $inc: { stock: -qty } })`. The check and the change happen in one step, so two requests can never both take the last unit.
3. **Manual rollback.** If a line fails at this stage (someone else took the stock a moment earlier), the lines already taken are added back before replying 409. The same rollback runs if saving the order fails.
4. **Price snapshot.** Each order line stores the `unitPrice` at the time of the order, so changing a product's price later does not change old orders.
5. **Cancel exactly once.** Cancel first flips the status from `placed` to `cancelled` in one atomic update. Only one request can win that flip, and only the winner returns stock. A second cancel gets 409.
6. **No deleting used products.** A product that appears in any order cannot be deleted (409). Deactivate it with PATCH instead.

## Known limitations

- If the server crashes in the middle of an order or a cancel, stock could be left half-changed, because there are no real transactions.
- Same product listed twice in one order: the quantities are added together.
