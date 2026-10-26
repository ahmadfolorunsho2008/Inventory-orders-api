// Sends errors from async route handlers to the error middleware in app.js
module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
