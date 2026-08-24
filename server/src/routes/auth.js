// src/routes/auth.js
// Lớp route — chỉ khai báo endpoint và trỏ tới controller tương ứng.
// POST /api/register — tạo user mới
// POST /api/login     — kiểm tra username/password, trả JWT
const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);

module.exports = router;
