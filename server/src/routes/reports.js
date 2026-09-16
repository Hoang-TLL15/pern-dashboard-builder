// src/routes/reports.js
// Lớp route — chỉ khai báo endpoint và trỏ tới controller tương ứng.
// CRUD reports + report_widgets, toàn bộ yêu cầu đăng nhập (ownership theo req.user.id).
// POST /api/reports/:id/warm — đẩy mọi widget của report vào queue làm nóng cache Redis
const express = require('express');
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use('/reports', authMiddleware);

router.get('/reports', reportController.list);
router.post('/reports', reportController.create);
router.get('/reports/:id', reportController.getById);
router.put('/reports/:id', reportController.update);
router.patch('/reports/:id/filter-values', reportController.updateFilterValues);
router.post('/reports/:id/warm', reportController.warm);
router.delete('/reports/:id', reportController.remove);

module.exports = router;
