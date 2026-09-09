// src/repositories/queryCacheEntryRepository.js
// Lớp truy cập dữ liệu cho query_cache_entries — chỉ Prisma, không business
// logic, không req/res. Xem docs/query-file-cache-queue-design.md.
const prisma = require('../config/prisma');

// Gọi fire-and-forget sau mỗi lần đọc 1 biến thể: +1 hit_count, làm mới
// last_read_at, ghi đè params (giá trị filter mới nhất đã bind).
async function upsertHit(queryConfigId, paramsKey, params) {
  await prisma.queryCacheEntry.upsert({
    where: { queryConfigId_paramsKey: { queryConfigId, paramsKey } },
    create: { queryConfigId, paramsKey, params, hitCount: 1 },
    update: { hitCount: { increment: 1 }, lastReadAt: new Date(), params },
  });
}

// Scheduler: N biến thể hit_count cao nhất còn được đọc trong cửa sổ gần đây.
async function findTopN(limit, readSince) {
  return prisma.queryCacheEntry.findMany({
    where: { lastReadAt: { gte: readSince } },
    orderBy: { hitCount: 'desc' },
    take: limit,
  });
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
