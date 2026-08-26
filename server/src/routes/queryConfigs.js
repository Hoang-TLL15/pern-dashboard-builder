// src/routes/queryConfigs.js
// Lớp route — chỉ khai báo endpoint và trỏ tới controller tương ứng.
// GET /api/query-configs/:id/run — chạy SQL của 1 query_config, trả columns/rows
// POST /api/query-configs/run-batch — chạy nhiều query_configs cùng lúc kèm filters { paramName: value }, trả { results: [...] }
// POST /api/query-configs — lưu 1 câu SQL ad-hoc thành query_config mới
// PUT /api/query-configs/:id — sửa name/description/query/suggestedChartType
// DELETE /api/query-configs/:id — xoá, chặn nếu còn report_widgets tham chiếu
const express = require('express');
const queryConfigController = require('../controllers/queryConfigController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/query-configs/:id/run', authMiddleware, queryConfigController.run);
router.post('/query-configs/run-batch', authMiddleware, queryConfigController.runMany);
router.post('/query-configs', authMiddleware, queryConfigController.create);
router.put('/query-configs/:id', authMiddleware, queryConfigController.update);
router.delete('/query-configs/:id', authMiddleware, queryConfigController.remove);

module.exports = router;
