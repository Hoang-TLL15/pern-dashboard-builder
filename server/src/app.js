// src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const authRoutes = require('./routes/auth');
const dbConnectionRoutes = require('./routes/dbConnections');
const queryConfigRoutes = require('./routes/queryConfigs');
const reportRoutes = require('./routes/reports');
const internalRoutes = require('./routes/internal');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', authRoutes);
app.use('/api', dbConnectionRoutes);
app.use('/api', queryConfigRoutes);
app.use('/api', reportRoutes);
app.use('/api', internalRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handler phải đặt sau cùng, sau mọi route
app.use(errorHandler);

// Bộ hẹn giờ làm mới cache biến thể query hot — chỉ bật khi có cờ (cần
// RabbitMQ + worker chạy kèm). Xem docs/query-file-cache-queue-design.md.
if (env.cacheSchedulerEnabled) {
  require('./queue/cacheScheduler').start();
  console.log('cacheScheduler: bật');
}

app.listen(env.port, () => {
  console.log(`Server dang chay tai http://localhost:${env.port}`);
});

module.exports = app;
