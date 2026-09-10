// src/repositories/queryCacheEntryRepository.js
// Lớp truy cập dữ liệu cho query_cache_entries — chỉ Prisma, không business
// logic, không req/res. Xem docs/query-file-cache-queue-design.md.
const prisma = require('../config/prisma');

// queryCacheService.flushHits() gọi: cộng `hitCount` hit đã gộp trong chu kỳ,
// làm mới last_read_at, ghi đè params (giá trị filter mới nhất đã bind). Cập
// nhật duration_ms chỉ khi chu kỳ có ít nhất 1 lượt chạy SQL live (cache hit
// truyền durationMs === undefined -> giữ nguyên giá trị cũ).
async function upsertHit(queryConfigId, paramsKey, params, hitCount = 1, durationMs) {
  await prisma.queryCacheEntry.upsert({
    where: { queryConfigId_paramsKey: { queryConfigId, paramsKey } },
    create: { queryConfigId, paramsKey, params, hitCount, durationMs: durationMs ?? null },
    update: {
      hitCount: { increment: hitCount },
      lastReadAt: new Date(),
      params,
      ...(durationMs === undefined ? {} : { durationMs }),
    },
  });
}

// Scheduler: N biến thể "đáng chạy sẵn nhất" còn được đọc trong cửa sổ gần đây
// — xếp hạng theo hot × đắt (hit_count * duration_ms) thay vì chỉ hot, để ưu
// tiên biến thể vừa nhiều lượt xem vừa tốn thời gian chạy. duration_ms chưa đo
// được (chưa từng chạy live) coi như 1 -> vẫn xếp theo hit_count, dưới mọi biến
// thể đã đo. $queryRaw vì Prisma không orderBy được biểu thức số học.
async function findTopN(limit, readSince) {
  return prisma.$queryRaw`
    SELECT query_config_id AS "queryConfigId", params_key AS "paramsKey", params
    FROM query_cache_entries
    WHERE last_read_at >= ${readSince}
    ORDER BY hit_count * COALESCE(duration_ms, 1) DESC
    LIMIT ${limit}
  `;
}

// Decay hàng tuần: chia đôi mọi hit_count (chia số nguyên) để biến thể từng
// hot nhưng nay nguội tự rớt khỏi top-N.
async function halveAllHitCounts() {
  await prisma.$executeRaw`UPDATE query_cache_entries SET hit_count = hit_count / 2`;
}

// Cleanup hàng ngày: xoá dòng idle quá lâu, trả danh sách đã xoá để caller
// xoá file tương ứng.
async function deleteIdle(idleBefore) {
  const stale = await prisma.queryCacheEntry.findMany({
    where: { lastReadAt: { lt: idleBefore } },
    select: { queryConfigId: true, paramsKey: true },
  });
  await prisma.queryCacheEntry.deleteMany({ where: { lastReadAt: { lt: idleBefore } } });
  return stale;
}

// Khi query_config bị SỬA (query text đổi) — xoá mọi entry của id đó. Khi bị
// XOÁ thì ON DELETE CASCADE tự lo, không cần gọi hàm này.
async function deleteByQueryConfigId(queryConfigId) {
  await prisma.queryCacheEntry.deleteMany({ where: { queryConfigId } });
}

module.exports = {
  upsertHit,
  findTopN,
  halveAllHitCounts,
  deleteIdle,
  deleteByQueryConfigId,
};
