// src/utils/AppError.js
// Error tuỳ chỉnh mang theo HTTP status code, giúp controller
// biết cách trả response mà không cần biết chi tiết business logic.
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

module.exports = AppError;
