// src/routes/internal.js
// Endpoint nội bộ — KHÔNG qua authMiddleware; chặn bằng header x-internal-secret
// (env.internalApiSecret) trong controller. Chỉ worker (worker/actors.py) gọi.
// POST /api/internal/refresh-cache { queryConfigId, params } -> chạy SQL live, trả { columns, rows, ... }
const express = require('express');
const internalController = require('../controllers/internalController');

const router = express.Router();

router.post('/internal/refresh-cache', internalController.refreshCache);

module.exports = router;
