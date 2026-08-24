// src/repositories/userRepository.js
// Lớp truy cập dữ liệu (Data Access) — dùng Prisma ORM, không chứa
// business logic hay xử lý request/response.
const prisma = require('../config/prisma');

async function findByUsername(username) {
  return prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, passwordHash: true, createdAt: true },
  });
}

async function create({ username, passwordHash }) {
  return prisma.user.create({
    data: { username, passwordHash },
    select: { id: true, username: true, createdAt: true },
  });
}

module.exports = {
  findByUsername,
  create,
};
