// src/config/prisma.js
// Prisma Client singleton cho Meta DB — dùng cho các repository đã chuyển
// sang ORM (vd dbConnectionRepository). userRepository hiện vẫn dùng
// metaPool (pg thuần) trong database.js, chưa migrate sang Prisma.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
