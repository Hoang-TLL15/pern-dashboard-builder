// src/config/env.js
// Tập trung đọc & export toàn bộ biến môi trường của app.
const path = require('path');
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: '7d',

  // Cache biến thể query hot ra file (docs/query-file-cache-queue-design.md).
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  internalApiSecret: process.env.INTERNAL_API_SECRET, // bắt buộc để endpoint /internal/* hoạt động
  cacheDir: process.env.CACHE_DIR || path.join(__dirname, '../../.query-cache'),
  cacheFileTtlMs: 24 * 60 * 60 * 1000, // file quá 1 ngày -> coi như hết hạn, chạy live
  cacheSchedulerEnabled: process.env.CACHE_SCHEDULER_ENABLED === '1', // cần RabbitMQ + worker chạy kèm
};
