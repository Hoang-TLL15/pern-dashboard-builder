// src/repositories/dbConnectionRepository.js
// Lớp truy cập dữ liệu (Data Access) cho db_connections — dùng Prisma ORM
// thay vì raw SQL, không chứa business logic hay xử lý request/response.
const prisma = require('../config/prisma');

// db_password cố tình bị loại khỏi select — không trả credential ra ngoài.
async function findAll() {
  return prisma.dbConnection.findMany({
    select: {
      id: true,
      name: true,
      dbType: true,
      host: true,
      port: true,
      databaseName: true,
      dbUser: true,
      createdAt: true,
    },
    orderBy: { id: 'asc' },
  });
}

async function findById(id) {
  return prisma.dbConnection.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      dbType: true,
      host: true,
      port: true,
      databaseName: true,
      dbUser: true,
      createdAt: true,
    },
  });
}

// Dùng nội bộ bởi Connection Manager (db/dataSourcePool.js) để mở pg.Pool —
// KHÔNG bao giờ trả kết quả hàm này ra response/controller. Khác findById()
// ở trên (không có dbPassword, dùng cho FE), hàm này cố ý thêm dbPassword.
async function findByIdWithCredentials(id) {
  return prisma.dbConnection.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      dbType: true,
      host: true,
      port: true,
      databaseName: true,
      dbUser: true,
      dbPassword: true,
    },
  });
}

// Dùng bởi runMany() để tránh N lần findByIdWithCredentials riêng lẻ. Cùng
// lưu ý như findByIdWithCredentials: KHÔNG bao giờ trả kết quả hàm này ra
// response/controller.
async function findByIdsWithCredentials(ids) {
  return prisma.dbConnection.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      dbType: true,
      host: true,
      port: true,
      databaseName: true,
      dbUser: true,
      dbPassword: true,
    },
  });
}

module.exports = {
  findAll,
  findById,
  findByIdWithCredentials,
  findByIdsWithCredentials,
};
