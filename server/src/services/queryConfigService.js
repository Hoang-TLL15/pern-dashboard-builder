// src/services/queryConfigService.js
// Lớp business logic cho query_configs — không biết gì về req/res của HTTP.
const queryConfigRepository = require('../repositories/queryConfigRepository');
const dbConnectionRepository = require('../repositories/dbConnectionRepository');
const reportRepository = require('../repositories/reportRepository');
const dataSourcePool = require('../db/dataSourcePool');
const drivers = require('../db/drivers');
const AppError = require('../utils/AppError');
const sqlValidator = require('./sqlValidator');
const sqlParams = require('./sqlParams');

// Cache kết quả chạy query theo query_configs.id + giá trị filter liên quan, TTL
// ngắn để giảm tải DB nguồn khi nhiều request cùng chạy 1 query trong thời gian
// ngắn (vd. nhiều widget dùng chung 1 query config trên cùng report). update()/
// remove() xoá mọi entry của id đó khỏi cache vì query text có thể đã đổi.
const RUN_CACHE_TTL_MS = 30_000;
const RUN_CACHE_SWEEP_INTERVAL_MS = 60 * 1000; // quét mỗi 1 phút, giống dataSourcePool.js
const runCache = new Map(); // key: `${queryConfigId}::${sortedFilterValuesJson}` -> { data, expiresAt }

function runCacheKey(queryConfigId, relevantValues) {
  const sortedEntries = Object.entries(relevantValues).sort(([a], [b]) => a.localeCompare(b));
  return `${queryConfigId}::${JSON.stringify(sortedEntries)}`;
}

// update()/remove() gọi hàm này để xoá MỌI biến thể cache của 1 query_config (mọi
// giá trị filter đã từng chạy) — không chỉ 1 khoá đơn như trước, vì giờ 1 id có thể
// có nhiều entry cache khác nhau theo filter.
function clearRunCacheForId(queryConfigId) {
  const prefix = `${queryConfigId}::`;
  for (const key of runCache.keys()) {
    if (key.startsWith(prefix)) runCache.delete(key);
  }
}

function sweepExpiredRunCache() {
  const now = Date.now();
  for (const [key, entry] of runCache.entries()) {
    if (entry.expiresAt <= now) {
      runCache.delete(key);
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

// Chạy 1 câu SQL đã dịch xong tham số (compileParams) trên 1 connection đã biết —
// dùng chung bởi executeQueryConfig() (SQL đã duyệt, có cache) và previewQuery() (SQL
// ad-hoc do user gõ, không tham số, không cache).
async function runSqlOnConnection(connection, sql, values) {
  const driver = drivers[connection.dbType];
  if (!driver) {
    throw new AppError(`Chưa hỗ trợ loại DB "${connection.dbType}"`, 400);
  }

  const cappedSql = sqlValidator.capRowLimit(sql, connection.dbType);
  const pool = await dataSourcePool.getPool(connection);

  let result;
  try {
    result = await driver.runQuery(pool, cappedSql, values);
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

// Chạy 1 queryConfig đã biết trước connection — dịch :paramName (nếu SQL có dùng)
// sang cú pháp gốc của dbType rồi mới capRowLimit/execute (node-sql-parser không hiểu
// ":paramName", xem sqlParams.js). filterValues là TOÀN BỘ giá trị filter hiện tại của
// report; chỉ phần liên quan tới paramNames thực sự xuất hiện trong SQL của chính
// query_config này mới được lấy ra để bind — query không dùng :param nào thì không bị
// ảnh hưởng bởi filter của report.
async function executeQueryConfig(queryConfig, connection, filterValues = {}) {
  const { sql: compiledSql, paramNames, buildValues } = sqlParams.compileParams(
    queryConfig.query,
    connection.dbType
  );

  const relevantValues = {};
  for (const name of paramNames) relevantValues[name] = filterValues[name];

  const cacheKey = runCacheKey(queryConfig.id, relevantValues);
  const cached = runCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const { columns, rows } = await runSqlOnConnection(
    connection,
    compiledSql,
    buildValues(relevantValues)
  );

  const data = {
    id: queryConfig.id,
    name: queryConfig.name,
    suggestedChartType: queryConfig.suggestedChartType,
    query: queryConfig.query,
    columns,
    rows,
  };
  runCache.set(cacheKey, { data, expiresAt: Date.now() + RUN_CACHE_TTL_MS });
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

async function run(id, filterValues = {}) {
  const numericId = toValidId(id);

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

  return executeQueryConfig(queryConfig, connection, filterValues);
}

// Chạy nhiều query_configs cùng lúc (vd. tải hết widget của 1 report) —
// gộp N request HTTP từ client thành 1 VÀ gộp lookup metadata trên Meta DB
// (query_configs, db_connections) từ 2N round-trip riêng lẻ (findById theo
// từng id) xuống còn 2 round-trip (findMany ... in ids). Việc chạy SQL thật
// trên Data Source DB thì không gộp được — mỗi query_config có thể là SQL
// khác nhau trên connection khác nhau — nên vẫn là N lệnh, chạy song song
// qua Promise.all thay vì tuần tự. Không còn lọc uncachedIds trước khi load
// metadata (cache giờ phụ thuộc giá trị filter, không biết trước khi đã load
// queryConfig.query để compileParams) — Meta DB là Postgres local, rẻ hơn
// nhiều so với Data Source DB mà cache thật sự bảo vệ.
async function runMany(ids, filterValues = {}) {
  if (!Array.isArray(ids)) {
    throw new AppError('ids phải là mảng', 400);
  }
  const numericIds = ids.map(toValidId);
  const uniqueIds = [...new Set(numericIds)];
  if (uniqueIds.length > MAX_RUN_MANY_IDS) {
    throw new AppError(`Chỉ được chạy tối đa ${MAX_RUN_MANY_IDS} query cùng lúc`, 400);
  }

  const queryConfigs = await queryConfigRepository.findByIds(uniqueIds);
  const missingId = uniqueIds.find((uid) => !queryConfigs.some((qc) => qc.id === uid));
  if (missingId !== undefined) {
    throw new AppError('Không tìm thấy query config', 404);
  }

  const dbConnectionIds = [...new Set(queryConfigs.map((qc) => qc.dbConnectionId))];
  const connections = await dbConnectionRepository.findByIdsWithCredentials(dbConnectionIds);
  const connectionsById = new Map(connections.map((c) => [c.id, c]));

  const resultsById = new Map();
  await Promise.all(
    queryConfigs.map(async (queryConfig) => {
      const connection = connectionsById.get(queryConfig.dbConnectionId);
      if (!connection) {
        throw new AppError('Không tìm thấy kết nối nguồn dữ liệu', 404);
      }
      resultsById.set(queryConfig.id, await executeQueryConfig(queryConfig, connection, filterValues));
    })
  );

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

  const { sql: compiledSql } = sqlParams.compileParams(query, connection.dbType);
  sqlValidator.assertSelectOnly(compiledSql, connection.dbType);

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

  const { sql: compiledSql } = sqlParams.compileParams(query, connection.dbType);
  sqlValidator.assertSelectOnly(compiledSql, connection.dbType);

  const updated = await queryConfigRepository.update(numericId, {
    name,
    description: description || null,
    query,
    suggestedChartType,
  });
  clearRunCacheForId(numericId);
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
  clearRunCacheForId(numericId);
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
