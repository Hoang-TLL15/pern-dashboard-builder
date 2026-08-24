// src/middleware/auth.js
// Middleware xác thực JWT — gắn req.user nếu token hợp lệ, trả 401 nếu không.
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization; // dạng: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Thiếu token xác thực' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

module.exports = authMiddleware;
