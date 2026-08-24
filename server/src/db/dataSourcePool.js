// src/db/dataSourcePool.js
// Connection Manager cho Data Source DB — KHÔNG phải Meta DB (Meta DB dùng
// Prisma qua config/prisma.js). Data Source DB không biết trước lúc code,
// thông tin kết nối đọc runtime từ db_connections, nên pool phải tạo động
// và cache lại, tránh mở/đóng pool mỗi lần chạy query. Tạo pool cụ thể theo
// từng loại DB (postgres/mssql/...) nằm trong drivers/ — file này chỉ quản
// lý cache + TTL, không biết chi tiết driver.
const drivers = require('./drivers');
const AppError = require('../utils/AppError');

const IDLE_TTL_MS = 10 * 60 * 1000; // idle 10 phút -> evict
const SWEEP_INTERVAL_MS = 60 * 1000; // quét mỗi 1 phút

const dsPools = new Map(); // key: db_connection_id -> { pool, lastAccessedAt }

function sweepIdlePools() {
  const now = Date.now();
  for (const [id, entry] of dsPools.entries()) {
    if (now - entry.lastAccessedAt > IDLE_TTL_MS) {
      drivers[entry.dbType].closePool(entry.pool).catch(() => {});
      dsPools.delete(id);
    }
  }
}

const sweepTimer = setInterval(sweepIdlePools, SWEEP_INTERVAL_MS);
sweepTimer.unref();

// connection: { id, dbType, host, port, databaseName, dbUser, dbPassword } —
// tra từ dbConnectionRepository (hàm nào có kèm dbPassword), không tự đọc DB
// ở đây.
async function getPool(connection) {
  const existing = dsPools.get(connection.id);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    return existing.pool;
  }

  const driver = drivers[connection.dbType];
  if (!driver) {
    throw new AppError(`Chưa hỗ trợ loại DB "${connection.dbType}"`, 400);
  }

  const pool = await driver.createPool(connection);

  dsPools.set(connection.id, { pool, dbType: connection.dbType, lastAccessedAt: Date.now() });
  return pool;
}

// Gọi khi 1 db_connections bị sửa/xoá để tránh pool cũ dùng credential lỗi
// thời. TODO: wire vào dbConnectionService khi có route update/delete.
function invalidatePool(id) {
  const entry = dsPools.get(id);
  if (entry) {
    drivers[entry.dbType].closePool(entry.pool).catch(() => {});
    dsPools.delete(id);
  }
}

// Cache schema (bảng/cột/FK) sống chung vòng đời với pool — pool bị evict
// (idle 10 phút) hoặc invalidate (sửa/xoá connection) thì schema cache mất
// theo, không cần Map/sweep riêng như dbConnectionService.js trước đây.
// Vẫn giữ TTL riêng (SCHEMA_CACHE_TTL_MS) vì lastAccessedAt của pool được
// làm mới ở MỌI lần getPool() (kể cả khi chỉ đọc cache) — 1 connection dùng
// liên tục sẽ không bao giờ idle quá 10 phút, nếu không có TTL riêng thì
// schema cache sẽ không bao giờ tự làm mới dù DDL đã đổi.
// Chỉ đọc/ghi được sau khi đã getPool(connection) cho id đó.
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedSchema(id) {
  const entry = dsPools.get(id);
  if (!entry?.schema || entry.schema.expiresAt <= Date.now()) return undefined;
  return entry.schema.data;
}

function setCachedSchema(id, data) {
  const entry = dsPools.get(id);
  if (entry) entry.schema = { data, expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS };
}

module.exports = {
  getPool,
  invalidatePool,
  getCachedSchema,
  setCachedSchema,
};
