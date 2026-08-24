// src/controllers/authController.js
// Lớp controller — chỉ chịu trách nhiệm nhận req, gọi service tương ứng,
// và trả về res. Không chứa business logic hay query DB.
const authService = require('../services/authService');

async function register(req, res, next) {
  try {
    const { username, password } = req.body;
    const user = await authService.register(username, password);
    return res.status(201).json({ user });
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const result = await authService.login(username, password);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register,
  login,
};
