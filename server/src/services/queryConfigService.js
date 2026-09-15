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
const queryCacheService = require('./queryCacheService');
const queryCacheEntryRepository = require('../repositories/queryCacheEntryRepository');

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
async function executeQueryConfig(queryConfig, connection, filterValues = {}, options = {}) {
  const { skipCache = false } = options;
  const { sql: compiledSql, paramNames, buildValues } = sqlParams.compileParams(
    queryConfig.query,
    connection.dbType
  );

  const relevantValues = {};
  for (const name of paramNames) relevantValues[name] = filterValues[name];

  const shape = (columns, rows) => ({
    id: queryConfig.id,
    name: queryConfig.name,
    suggestedChartType: queryConfig.suggestedChartType,
    query: queryConfig.query,
    columns,
    rows,
  });

  if (!skipCache) {
    // Redis — gộp tier-1 (RAM) + tier-2 (file) cũ thành 1 tầng duy nhất.
    const cached = await queryCacheService.get(queryConfig.id, relevantValues);
    if (cached) {
      queryCacheService.recordHit(queryConfig.id, relevantValues);
      return shape(cached.columns, cached.rows);
    }
  }

  // SQL thật trên Data Source DB. Đo thời gian chạy để scheduler xếp hạng
  // biến thể theo "hot × đắt" (xem queryCacheEntryRepository.findTopN).
  const startedAt = Date.now();
  const { columns, rows } = await runSqlOnConnection(
    connection,
    compiledSql,
    buildValues(relevantValues)
  );
  const durationMs = Date.now() - startedAt;
  const data = shape(columns, rows);

  if (skipCache) {
    // Worker làm mới cache: cập nhật duration_ms để findTopN lọc theo số liệu
    // tươi, nhưng KHÔNG cộng hit_count (không phải lượt người dùng xem). Worker
    // (worker/actors.py) tự ghi Redis TTL dài từ response HTTP này — Node
    // không ghi cache ở nhánh này.
    queryCacheService.recordDuration(queryConfig.id, relevantValues, durationMs);
  } else {
    await queryCacheService.set(queryConfig.id, relevantValues, { columns, rows });
    queryCacheService.recordHit(queryConfig.id, relevantValues, durationMs);
  }
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

// Chạy 1 query_config BỎ QUA mọi tầng cache (luôn SQL live) — dùng riêng cho
// endpoint nội bộ /internal/refresh-cache mà worker gọi để lấy số liệu tươi
// đem ghi ra file. Không đụng query_cache_entries.
async function runLive(id, filterValues = {}) {
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

  return executeQueryConfig(queryConfig, connection, filterValues, { skipCache: true });
}

// Chạy worker(item) cho từng item, không để 1 item lỗi làm hỏng kết quả của
// các item còn lại — khác Promise.all (1 reject là cả mảng reject). Item lỗi
// trả { error: message } thay vì ném ra ngoài, để runMany() không kéo sập cả
// report chỉ vì 1 widget lỗi SQL/timeout.
async function settleEach(items, worker) {
  const settled = await Promise.allSettled(items.map(worker));
  return settled.map((s) =>
    s.status === 'fulfilled' ? s.value : { error: s.reason?.message || 'Lỗi không xác định' }
  );
}

// Chạy nhiều query_configs cùng lúc (vd. tải hết widget của 1 report) —
// gộp N request HTTP từ client thành 1 VÀ gộp lookup metadata trên Meta DB
// (query_configs, db_connections) từ 2N round-trip riêng lẻ (findById theo
// từng id) xuống còn 2 round-trip (findMany ... in ids). Việc chạy SQL thật
// trên Data Source DB thì không gộp được — mỗi query_config có thể là SQL
// khác nhau trên connection khác nhau — nên vẫn là N lệnh, chạy song song
// qua settleEach (Promise.allSettled) thay vì tuần tự — 1 query lỗi không
// kéo sập kết quả của các query còn lại trong cùng batch. Không còn lọc
// uncachedIds trước khi load metadata (cache giờ phụ thuộc giá trị filter,
// không biết trước khi đã load
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

  const results = await settleEach(queryConfigs, async (queryConfig) => {
    const connection = connectionsById.get(queryConfig.dbConnectionId);
    if (!connection) {
      throw new AppError('Không tìm thấy kết nối nguồn dữ liệu', 404);
    }
    return executeQueryConfig(queryConfig, connection, filterValues);
  });

  const resultsById = new Map(queryConfigs.map((qc, i) => [qc.id, results[i]]));
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
  // Query text đổi -> mọi biến thể cache cũ có thể sai: xoá hết trên Redis + dòng entry.
  await queryCacheService.deleteForQueryConfigId(numericId);
  queryCacheEntryRepository.deleteByQueryConfigId(numericId).catch((err) =>
    console.error('[queryConfigService] xoá cache entries lỗi:', err.message)
  );
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
  // Dòng entry tự xoá theo ON DELETE CASCADE; Redis thì phải tự dọn.
  await queryCacheService.deleteForQueryConfigId(numericId);
}

module.exports = {
  listByDbConnectionId,
  run,
  runLive,
  runMany,
  previewQuery,
  create,
  update,
  remove,
};

if (require.main === module) {
  const assert = require('assert');

  (async () => {
    // 1 item lỗi không được làm hỏng kết quả của các item còn lại (khác Promise.all)
    const results = await settleEach([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('boom');
      return n * 10;
    });
    assert.deepStrictEqual(results, [10, { error: 'boom' }, 30]);

    // AppError cũng chỉ hỏng đúng item của nó, không lộ statusCode ra ngoài shape
    const withAppError = await settleEach([1], async () => {
      throw new AppError('không tìm thấy', 404);
    });
    assert.deepStrictEqual(withAppError, [{ error: 'không tìm thấy' }]);

    console.log('queryConfigService self-check: OK');
  })();
}
