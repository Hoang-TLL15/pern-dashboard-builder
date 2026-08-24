// src/routes/dbConnections.js
// Lớp route — chỉ khai báo endpoint và trỏ tới controller tương ứng.
// GET /api/db-connections                    — liệt kê db_connections (yêu cầu đăng nhập)
// GET /api/db-connections/:id                — chi tiết 1 db_connection (yêu cầu đăng nhập)
// GET /api/db-connections/:id/query-configs  — liệt kê query_configs thuộc db_connection đó
// GET /api/db-connections/:id/schema         — liệt kê bảng/cột của Data Source DB đó
// POST /api/db-connections/:id/query-preview — chạy thử 1 câu SELECT ad-hoc (không lưu)
const express = require('express');
const dbConnectionController = require('../controllers/dbConnectionController');
const queryConfigController = require('../controllers/queryConfigController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/db-connections', authMiddleware, dbConnectionController.list);
router.get('/db-connections/:id', authMiddleware, dbConnectionController.getById);
router.get(
  '/db-connections/:id/query-configs',
  authMiddleware,
  queryConfigController.listByDbConnectionId
);
router.get('/db-connections/:id/schema', authMiddleware, dbConnectionController.getSchema);
router.post(
  '/db-connections/:id/query-preview',
  authMiddleware,
  queryConfigController.preview
);

module.exports = router;
