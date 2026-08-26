// src/repositories/reportRepository.js
// Lớp truy cập dữ liệu (Data Access) cho reports/report_widgets — dùng Prisma
// ORM, không chứa business logic hay xử lý request/response. Mọi hàm đọc/ghi
// đều nhận userId và lọc ngay trong query — ownership check nằm ở đây, không
// để lộ report của user khác (IDOR).

const prisma = require('../config/prisma');

async function findByUserId(userId) {
  return prisma.report.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { widgets: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

async function findByIdForUser(id, userId) {
  return prisma.report.findFirst({
    where: { id, userId },
    include: {
      widgets: {
        orderBy: { position: 'asc' },
      },
    },
  });
}

async function createForUser(userId, { name, description, widgets }) {
  return prisma.report.create({
    data: {
      userId,
      name,
      description,
      widgets: {
        create: widgets.map((w, i) => ({
          widgetType: w.widgetType,
          queryConfigId: w.queryConfigId,
          chartType: w.chartType,
          chartConfig: w.chartConfig,
          position: i,
        })),
      },
    },
    include: { widgets: { orderBy: { position: 'asc' } } },
  });
}

// "Xoá rồi chèn lại" toàn bộ widgets trong 1 transaction thay vì diff từng
// widget — chấp nhận được vì 1 report thường chỉ có vài widget (mục 7 design doc).
async function updateForUser(id, userId, { name, description, widgets }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.report.findFirst({ where: { id, userId } });
    if (!existing) return null;

    await tx.reportWidget.deleteMany({ where: { reportId: id } });

    return tx.report.update({
      where: { id },
      data: {
        name,
        description,
        updatedAt: new Date(),
        widgets: {
          create: widgets.map((w, i) => ({
            widgetType: w.widgetType,
            queryConfigId: w.queryConfigId,
            chartType: w.chartType,
            chartConfig: w.chartConfig,
            position: i,
          })),
        },
      },
      include: { widgets: { orderBy: { position: 'asc' } } },
    });
  });
}

// deleteMany thay vì delete() để ownership check (id + userId) nằm ngay
// trong điều kiện xoá; report_widgets tự xoá theo cascade ở DB.
async function deleteForUser(id, userId) {
  const result = await prisma.report.deleteMany({ where: { id, userId } });
  return result.count > 0;
}

// updateMany (không phải update) cùng lý do trên: ownership check nằm ngay
// trong where, không phải query riêng rồi mới update. Không đụng updatedAt/
// widgets — đây là lưu giá trị filter đang chọn (không phải thao tác "Lưu report").
async function updateFilterValues(id, userId, filterValues) {
  const result = await prisma.report.updateMany({ where: { id, userId }, data: { filterValues } });
  return result.count > 0;
}

// Dùng bởi queryConfigService.remove() để chặn xoá 1 query_config đang được
// report_widgets tham chiếu (FK query_config_id không có ON DELETE CASCADE).
async function countByQueryConfigId(queryConfigId) {
  return prisma.reportWidget.count({ where: { queryConfigId } });
}

module.exports = {
  findByUserId,
  findByIdForUser,
  createForUser,
  updateForUser,
  updateFilterValues,
  deleteForUser,
  countByQueryConfigId,
};
