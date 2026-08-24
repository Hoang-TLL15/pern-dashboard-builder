// src/services/authService.js
// Lớp business logic — xử lý quy tắc nghiệp vụ (validate, hash, so khớp
// password, tạo token...), không biết gì về req/res của HTTP.
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const userRepository = require('../repositories/userRepository');
const AppError = require('../utils/AppError');

const SALT_ROUNDS = 10;

function validateCredentials(username, password) {
  if (!username || !password) {
    throw new AppError('Thiếu username hoặc password', 400);
  }
}

async function register(username, password) {
  validateCredentials(username, password);

  if (password.length < 6) {
    throw new AppError('Password phải từ 6 ký tự trở lên', 400);
  }

  const existing = await userRepository.findByUsername(username);
  if (existing) {
    throw new AppError('Username đã tồn tại', 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await userRepository.create({ username, passwordHash });

  return user;
}

async function login(username, password) {
  validateCredentials(username, password);

  const user = await userRepository.findByUsername(username);
  if (!user) {
    throw new AppError('Sai username hoặc password', 401);
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    throw new AppError('Sai username hoặc password', 401);
  }

  const token = jwt.sign(
    { id: user.id, username: user.username },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );

  return {
    token,
    user: { id: user.id, username: user.username },
  };
}

module.exports = {
  register,
  login,
};
