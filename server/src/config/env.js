// src/config/env.js
// Tập trung đọc & export toàn bộ biến môi trường của app.
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: '7d',

  // Cache biến thể query hot qua Redis (docs/superpowers/specs/2026-09-11-redis-query-cache-design.md).
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  internalApiSecret: process.env.INTERNAL_API_SECRET, // bắt buộc để endpoint /internal/* hoạt động
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  cacheTtlFreshMs: 30_000, // Node ghi khi user request chạy live (miss cache)
  cacheSchedulerEnabled: process.env.CACHE_SCHEDULER_ENABLED === '1', // cần RabbitMQ + worker + Redis chạy kèm
};
