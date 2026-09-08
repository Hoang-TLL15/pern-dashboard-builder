// src/controllers/internalController.js
// Controller cho các endpoint NỘI BỘ (chỉ service khác trong hệ thống gọi, vd
// worker Python) — không dùng JWT của user mà chặn bằng shared secret header.
const env = require('../config/env');
const queryConfigService = require('../services/queryConfigService');
const AppError = require('../utils/AppError');

async function refreshCache(req, res, next) {
  try {
    if (!env.internalApiSecret || req.get('x-internal-secret') !== env.internalApiSecret) {
      throw new AppError('Không có quyền', 401);
    }
    const { queryConfigId, params } = req.body || {};
    const result = await queryConfigService.runLive(queryConfigId, params || {});
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { refreshCache };
