// src/middleware/errorHandler.js
// Middleware xử lý lỗi tập trung — mọi lỗi từ controller (qua next(err))
// đều đi qua đây, tránh lặp code try/catch trả lỗi ở từng route.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;
  const message = err.statusCode ? err.message : 'Lỗi server';

  if (!err.statusCode) {
    console.error('Lỗi không xác định:', err);
  }

  return res.status(statusCode).json({ error: message });
}

module.exports = errorHandler;
