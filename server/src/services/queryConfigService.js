// src/services/queryConfigService.js
// Lớp business logic cho query_configs — không biết gì về req/res của HTTP.
const queryConfigRepository = require('../repositories/queryConfigRepository');
const dbConnectionRepository = require('../repositories/dbConnectionRepository');
const reportRepository = require('../repositories/reportRepository');
const dataSourcePool = require('../db/dataSourcePool');
const drivers = require('../db/drivers');
const AppError = require('../utils/AppError');
const sqlValidator = require('./sqlValidator');

// Cache kết quả chạy query theo query_configs.id, TTL ngắn để giảm tải DB
// nguồn khi nhiều request cùng chạy 1 query trong thời gian ngắn (vd. nhiều
// widget dùng chung 1 query config trên cùng report). update()/remove() xoá
// entry tương ứng khỏi cache vì query text có thể đã đổi.
const RUN_CACHE_TTL_MS = 30_000;
const RUN_CACHE_SWEEP_INTERVAL_MS = 60 * 1000; // quét mỗi 1 phút, giống dataSourcePool.js
const runCache = new Map(); // key: query_configs.id -> { data, expiresAt }

function sweepExpiredRunCache() {
  const now = Date.now();
  for (const [id, entry] of runCache.entries()) {
    if (entry.expiresAt <= now) {
      runCache.delete(id);
    }
  }
}

const runCacheSweepTimer = setInterval(sweepExpiredRunCache, RUN_CACHE_SWEEP_INTERVAL_MS);
runCacheSweepTimer.unref();

// Chặn 1 request chạy song song quá nhiều query lên Data Source DB (fan-out
// không giới hạn có thể cạn pool connection của DB nguồn — pg/mssql pool mặc
// định max=10). 1 report thực tế hiếm khi có hơn vài chục widget.
const MAX_RUN_MANY_IDS = 50;

async function listByDbConnectionId(dbConnectionId) {
  const numericId = Number(dbConnectionId);
  if (!Number.isInteger(numericId)) {
    throw new AppError('id không hợp lệ', 400);
  }

  const connection = await dbConnectionRepository.findById(numericId);
  if (!connection) {
    throw new AppError('Không tìm thấy kết nối', 404);
  }

  return queryConfigRepository.findByDbConnectionId(numericId);
}

// Chạy 1 câu SQL trên connection đã biết, map cột theo driver — dùng chung
// bởi executeQueryConfig() (SQL đã duyệt, có cache) và previewQuery() (SQL
// ad-hoc do user gõ, không cache vì không có query_configs.id làm key).
async function runSqlOnConnection(connection, sql) {
  const driver = drivers[connection.dbType];
  if (!driver) {
    throw new AppError(`Chưa hỗ trợ loại DB "${connection.dbType}"`, 400);
  }

  const cappedSql = sqlValidator.capRowLimit(sql, connection.dbType);
  const pool = await dataSourcePool.getPool(connection);

  let result;
  try {
    result = await driver.runQuery(pool, cappedSql);
  } catch (err) {
    if (driver.isTimeoutError(err)) {
      throw new AppError('Truy vấn chạy quá lâu và đã bị huỷ (timeout)', 504);
    }
    // Lỗi từ chính Data Source DB (sai tên bảng/cột, sai cú pháp phương ngữ...)
    // là lỗi do câu SQL của user, không phải lỗi server — trả message gốc
    // của driver thay vì để errorHandler nuốt thành "Lỗi server" chung chung.
    throw new AppError(err.message, 400);
  }

  const columns = result.columns.map((column) => ({
    key: column.name,
    label: column.name,
    type: driver.resolveColumnType(column.typeInfo),
  }));

  return { columns, rows: result.rows };
}

// Chạy 1 queryConfig đã biết trước connection (không đụng DB nào khác) —
// dùng chung bởi run() và runMany() để tránh lặp logic.
async function executeQueryConfig(queryConfig, connection) {
  const { columns, rows } = await runSqlOnConnection(connection, queryConfig.query);

  const data = {
    id: queryConfig.id,
    name: queryConfig.name,
    suggestedChartType: queryConfig.suggestedChartType,
    query: queryConfig.query,
    columns,
    rows,
  };
  runCache.set(queryConfig.id, { data, expiresAt: Date.now() + RUN_CACHE_TTL_MS });
  return data;
}

// Chạy SQL ad-hoc do user gõ trên trang chi tiết data source — validate
// SELECT-only trước khi chạy (sqlValidator.js), không lưu vào query_configs.
async function previewQuery(dbConnectionId, sql) {
  const numericId = toValidId(dbConnectionId);

  const connection = await dbConnectionRepository.findByIdWithCredentials(numericId);
  if (!connection) {
    throw new AppError('Không tìm thấy kết nối', 404);
  }

  sqlValidator.assertSelectOnly(sql, connection.dbType);

  return runSqlOnConnection(connection, sql);
}

function toValidId(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    throw new AppError('id không hợp lệ', 400);
  }
  return numericId;
}

async function run(id) {
  const numericId = toValidId(id);

  const cached = runCache.get(numericId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const queryConfig = await queryConfigRepository.findById(numericId);
  if (!queryConfig) {
    throw new AppError('Không tìm thấy query config', 404);
  }

  const connection = await dbConnectionRepository.findByIdWithCredentials(
    queryConfig.dbConnectionId
  );
  if (!connection) {
    throw new AppError('Không tìm thấy kết nối nguồn dữ liệu', 404);
  }

  return executeQueryConfig(queryConfig, connection);
}

// Chạy nhiều query_configs cùng lúc (vd. tải hết widget của 1 report) —
// gộp N request HTTP từ client thành 1 VÀ gộp lookup metadata trên Meta DB
// (query_configs, db_connections) từ 2N round-trip riêng lẻ (findById theo
// từng id) xuống còn 2 round-trip (findMany ... in ids). Việc chạy SQL thật
// trên Data Source DB thì không gộp được — mỗi query_config có thể là SQL
// khác nhau trên connection khác nhau — nên vẫn là N lệnh, chạy song song
// qua Promise.all thay vì tuần tự.
async function runMany(ids) {
  if (!Array.isArray(ids)) {
    throw new AppError('ids phải là mảng', 400);
  }
  const numericIds = ids.map(toValidId);
  const uniqueIds = [...new Set(numericIds)];
  if (uniqueIds.length > MAX_RUN_MANY_IDS) {
    throw new AppError(`Chỉ được chạy tối đa ${MAX_RUN_MANY_IDS} query cùng lúc`, 400);
  }

  const now = Date.now();
  const resultsById = new Map();
  const uncachedIds = uniqueIds.filter((uid) => {
    const cached = runCache.get(uid);
    if (cached && cached.expiresAt > now) {
      resultsById.set(uid, cached.data);
      return false;
    }
    return true;
  });

  if (uncachedIds.length > 0) {
    const queryConfigs = await queryConfigRepository.findByIds(uncachedIds);
    const missingId = uncachedIds.find((uid) => !queryConfigs.some((qc) => qc.id === uid));
    if (missingId !== undefined) {
      throw new AppError('Không tìm thấy query config', 404);
    }

    const dbConnectionIds = [...new Set(queryConfigs.map((qc) => qc.dbConnectionId))];
    const connections = await dbConnectionRepository.findByIdsWithCredentials(dbConnectionIds);
    const connectionsById = new Map(connections.map((c) => [c.id, c]));

    await Promise.all(
      queryConfigs.map(async (queryConfig) => {
        const connection = connectionsById.get(queryConfig.dbConnectionId);
        if (!connection) {
          throw new AppError('Không tìm thấy kết nối nguồn dữ liệu', 404);
        }
        resultsById.set(queryConfig.id, await executeQueryConfig(queryConfig, connection));
      })
    );
  }

  return numericIds.map((uid) => resultsById.get(uid));
}

// Lưu SQL ad-hoc (đã chạy thử qua previewQuery hoặc không) thành 1
// query_config mới — validate SELECT-only độc lập, không bắt buộc phải
// preview trước.
async function create({ dbConnectionId, name, description, query, suggestedChartType }) {
  const numericId = toValidId(dbConnectionId);

  const connection = await dbConnectionRepository.findById(numericId);
  if (!connection) {
    throw new AppError('Không tìm thấy kết nối', 404);
  }
  if (!name || !name.trim()) {
    throw new AppError('Tên query không được để trống', 400);
  }

  sqlValidator.assertSelectOnly(query, connection.dbType);

  return queryConfigRepository.create({
    dbConnectionId: numericId,
    name,
    description: description || null,
    query,
    suggestedChartType,
  });
}

// Sửa 1 query_config đã lưu — validate SELECT-only lại từ đầu (dbType có thể
// khác lúc tạo nếu connection đổi loại DB) vì query text đổi hoàn toàn có
// thể đổi luôn tính hợp lệ. Không cho đổi dbConnectionId trong lần sửa này.
async function update(id, { name, description, query, suggestedChartType }) {
  const numericId = toValidId(id);

  const existing = await queryConfigRepository.findById(numericId);
  if (!existing) {
    throw new AppError('Không tìm thấy query config', 404);
  }
  if (!name || !name.trim()) {
    throw new AppError('Tên query không được để trống', 400);
  }

  const connection = await dbConnectionRepository.findById(existing.dbConnectionId);
  if (!connection) {
    throw new AppError('Không tìm thấy kết nối', 404);
  }

  sqlValidator.assertSelectOnly(query, connection.dbType);

  const updated = await queryConfigRepository.update(numericId, {
    name,
    description: description || null,
    query,
    suggestedChartType,
  });
  runCache.delete(numericId);
  return updated;
}

// Xoá 1 query_config — chặn trước ở tầng service nếu còn report_widgets nào
// tham chiếu tới id này, vì FK trong db/init_meta.sql không có ON DELETE
// CASCADE (khác report_widgets.report_id): xoá thẳng sẽ để Postgres tự
// chặn bằng lỗi vi phạm khoá ngoại (23503), mập mờ hơn 1 AppError rõ nghĩa.
async function remove(id) {
  const numericId = toValidId(id);

  const existing = await queryConfigRepository.findById(numericId);
  if (!existing) {
    throw new AppError('Không tìm thấy query config', 404);
  }

  const widgetCount = await reportRepository.countByQueryConfigId(numericId);
  if (widgetCount > 0) {
    throw new AppError(
      `Không thể xoá — đang được dùng bởi ${widgetCount} widget trong report`,
      409
    );
  }

  await queryConfigRepository.remove(numericId);
  runCache.delete(numericId);
}

module.exports = {
  listByDbConnectionId,
  run,
  runMany,
  previewQuery,
  create,
  update,
  remove,
};
