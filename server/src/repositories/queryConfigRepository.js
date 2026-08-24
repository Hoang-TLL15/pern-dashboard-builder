// src/repositories/queryConfigRepository.js
// Lớp truy cập dữ liệu (Data Access) cho query_configs — dùng Prisma ORM,
// không chứa business logic hay xử lý request/response.
const prisma = require('../config/prisma');

// `query` (câu SQL đã duyệt) bị loại khỏi select ở đây — danh sách theo
// db_connection chỉ cần tên/mô tả; SQL thô được trả riêng qua findById() +
// endpoint /query-configs/:id/run, nơi user chủ động xem query đang chạy.
async function findByDbConnectionId(dbConnectionId) {
  return prisma.queryConfig.findMany({
    where: { dbConnectionId },
    select: {
      id: true,
      name: true,
      description: true,
      suggestedChartType: true,
      createdAt: true,
    },
    orderBy: { id: 'asc' },
  });
}

// Dùng để chạy SQL và cũng để hiển thị câu query đó cho user xem qua
// /query-configs/:id/run — response endpoint đó cố ý trả kèm `query`.
async function findById(id) {
  return prisma.queryConfig.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      dbConnectionId: true,
      query: true,
      suggestedChartType: true,
    },
  });
}

// Dùng bởi runMany() để tránh N lần findById riêng lẻ khi chạy nhiều
// query_configs cùng lúc (vd. tải hết widget của 1 report).
async function findByIds(ids) {
  return prisma.queryConfig.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      dbConnectionId: true,
      query: true,
      suggestedChartType: true,
    },
  });
}

// Tạo query_config mới từ SQL do user tự viết (ad-hoc, đã qua sqlValidator ở
// service layer trước khi gọi hàm này) — dùng bởi POST /query-configs.
async function create({ dbConnectionId, name, description, query, suggestedChartType }) {
  return prisma.queryConfig.create({
    data: { dbConnectionId, name, description, query, suggestedChartType },
    select: {
      id: true,
      name: true,
      description: true,
      dbConnectionId: true,
      suggestedChartType: true,
      createdAt: true,
    },
  });
}

// Sửa 1 query_config đã lưu (AST-validate ở service trước khi gọi hàm này)
// — dùng bởi PUT /query-configs/:id. dbConnectionId không đổi được vì SQL
// đã validate theo dialect của connection hiện tại.
async function update(id, { name, description, query, suggestedChartType }) {
  return prisma.queryConfig.update({
    where: { id },
    data: { name, description, query, suggestedChartType },
    select: {
      id: true,
      name: true,
      description: true,
      dbConnectionId: true,
      suggestedChartType: true,
      createdAt: true,
    },
  });
}

// Dùng bởi DELETE /query-configs/:id — service phải check trước không còn
// report_widgets nào tham chiếu tới id này (FK không có ON DELETE CASCADE
// trong db/init_meta.sql), nếu không Postgres sẽ trả lỗi vi phạm khoá ngoại.
async function remove(id) {
  await prisma.queryConfig.delete({ where: { id } });
}

module.exports = {
  findByDbConnectionId,
  findById,
  findByIds,
  create,
  update,
  remove,
};
