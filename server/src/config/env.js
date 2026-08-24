// src/config/env.js
// Tập trung đọc & export toàn bộ biến môi trường của app.
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: '7d',
};
