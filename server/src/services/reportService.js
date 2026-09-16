// src/services/reportService.js
// Lớp business logic cho reports — không biết gì về req/res của HTTP.
// BE không hiểu nội dung chart_config, chỉ validate phần khung (mục 7 design doc).
const reportRepository = require('../repositories/reportRepository');
const sqlParams = require('./sqlParams');
const queryCacheService = require('./queryCacheService');
const publisher = require('../queue/publisher');
const AppError = require('../utils/AppError');

// Khớp với CHART_TYPE_OPTIONS ở client/src/charts/chartAdapter.js
const ALLOWED_CHART_TYPES = [
  'bar',
  'stacked_bar',
  'line',
  'area',
  'pie',
  'doughnut',
  'radar',
  'scatter',
  'bubble',
  'combo',
  'metric',
  'metric_delta',
  'table',
];

function toNumericId(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    throw new AppError('id không hợp lệ', 400);
  }
  return numericId;
}

function validateWidgets(widgets) {
  if (!Array.isArray(widgets)) {
    throw new AppError('widgets phải là 1 mảng', 400);
  }

  return widgets.map((w) => {
    if (typeof w.chartConfig !== 'object' || w.chartConfig === null || Array.isArray(w.chartConfig)) {
      throw new AppError('widget.chartConfig phải là 1 object', 400);
    }

    const widgetType = w.widgetType === 'text' ? 'text' : 'chart';

    if (widgetType === 'text') {
      if (typeof w.chartConfig.text !== 'string') {
        throw new AppError('widget.chartConfig.text không hợp lệ', 400);
      }
      return { widgetType: 'text', queryConfigId: null, chartType: null, chartConfig: w.chartConfig };
    }

    const queryConfigId = Number(w.queryConfigId);
    if (!Number.isInteger(queryConfigId)) {
      throw new AppError('widget.queryConfigId không hợp lệ', 400);
    }
    if (!ALLOWED_CHART_TYPES.includes(w.chartType)) {
      throw new AppError(`widget.chartType không hợp lệ: ${w.chartType}`, 400);
    }
    return { widgetType: 'chart', queryConfigId, chartType: w.chartType, chartConfig: w.chartConfig };
  });
}

// filter_options: ánh xạ phẳng { paramName: ["opt1","opt2",...] } — list giá trị
// chọn sẵn cho dropdown global filter, do report author tự thêm/xoá. Cấu hình
// authoring (đổi khi "Lưu report"), khác filter_values (đổi mỗi lần "Áp dụng").
// Mọi option ép về chuỗi cho khớp ràng buộc "giá trị filter luôn là text".
const MAX_FILTER_OPTIONS = 200;

function validateFilterOptions(filterOptions) {
  if (filterOptions === undefined) return {};
  if (typeof filterOptions !== 'object' || filterOptions === null || Array.isArray(filterOptions)) {
    throw new AppError('filterOptions phải là 1 object', 400);
  }
  const clean = {};
  for (const [paramName, list] of Object.entries(filterOptions)) {
    if (paramName.trim().length === 0) continue;
    if (!Array.isArray(list)) {
      throw new AppError('filterOptions[paramName] phải là 1 mảng', 400);
    }
    const seen = new Set();
    const options = [];
    for (const raw of list) {
      const value = String(raw).trim();
      if (value.length === 0 || seen.has(value)) continue;
      seen.add(value);
      options.push(value);
    }
    if (options.length > MAX_FILTER_OPTIONS) {
      throw new AppError(`filterOptions[${paramName}] vượt quá ${MAX_FILTER_OPTIONS} giá trị`, 400);
    }
    if (options.length > 0) clean[paramName] = options;
  }
  return clean;
}

// autoWarm: cấu hình authoring như filterOptions (đổi khi "Lưu report"). Ép kiểu
// thẳng thay vì ném lỗi — checkbox thiếu/sai kiểu thì hiểu là tắt, không đáng
// chặn cả thao tác lưu report vì 1 cờ phụ trợ.
function validatePayload({ name, description, widgets, filterOptions, autoWarm }) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('name không được để trống', 400);
  }
  return {
    name: name.trim(),
    description: typeof description === 'string' ? description : null,
    filterOptions: validateFilterOptions(filterOptions),
    autoWarm: autoWarm === true,
    widgets: validateWidgets(widgets),
  };
}

// Nổ 1 report thành các message làm nóng cache — mỗi biến thể 1 message, đúng
// hợp đồng RabbitMQ đang có (worker không biết report/widget là gì, chỉ nhận
// { query_config_id, params_key, params }, xem worker/actors.py).
//
// params PHẢI dựng y hệt executeQueryConfig (queryConfigService.js): chỉ những
// :param thực sự xuất hiện trong SQL của CHÍNH query đó. Lệch một ly thì
// params_key khác đi, worker ghi Redis vào key không ai đọc -> warm vô ích mà
// không hề báo lỗi.
function buildWarmMessages(report) {
  const filterValues = report.filterValues || {};
  const byQueryConfigId = new Map(); // 2 widget dùng chung 1 query_config -> 1 message

  for (const w of report.widgets) {
    const qc = w.queryConfig;
    if (!qc || byQueryConfigId.has(qc.id)) continue;

    const { paramNames } = sqlParams.compileParams(qc.query, qc.dbConnection.dbType);
    const params = {};
    for (const name of paramNames) {
      if (filterValues[name] !== undefined) params[name] = filterValues[name];
    }

    byQueryConfigId.set(qc.id, {
      query_config_id: qc.id,
      params_key: queryCacheService.paramsKey(params),
      params,
    });
  }

  return [...byQueryConfigId.values()];
}

// Làm nóng cache 1 report theo yêu cầu (nút bấm trong ReportEditor). Dùng
// filter_values đã lưu trong DB — handleApplyFilters ở client PATCH mỗi lần áp
// filter nên gần như luôn khớp màn hình.
async function warm(id, userId) {
  const numericId = toNumericId(id);
  const report = await reportRepository.findForWarmForUser(numericId, userId);
  if (!report) {
    throw new AppError('Không tìm thấy report', 404);
  }

  const messages = buildWarmMessages(report);
  try {
    for (const message of messages) await publisher.publishRefresh(message);
  } catch (err) {
    // Hỏng giữa chừng thì phần đã đẩy vẫn chạy — warm lặp lại được, không có
    // trạng thái nào để rollback. Trả 503 thay vì để lọt thành 500: RabbitMQ
    // chết là hạ tầng phụ trợ chết, không phải report hỏng.
    throw new AppError('Hàng đợi làm mới cache không sẵn sàng', 503);
  }
  return { enqueued: messages.length };
}

// cacheScheduler gọi lúc 3h sáng — làm nóng mọi report bật cờ auto_warm.
async function warmAutoReports() {
  const reports = await reportRepository.findAllAutoWarm();
  let enqueued = 0;
  for (const report of reports) {
    for (const message of buildWarmMessages(report)) {
      await publisher.publishRefresh(message);
      enqueued += 1;
    }
  }
  return { reports: reports.length, enqueued };
}

async function list(userId) {
  return reportRepository.findByUserId(userId);
}

async function getById(id, userId) {
  const numericId = toNumericId(id);
  const report = await reportRepository.findByIdForUser(numericId, userId);
  if (!report) {
    throw new AppError('Không tìm thấy report', 404);
  }
  return report;
}

async function create(userId, payload) {
  const data = validatePayload(payload);
  return reportRepository.createForUser(userId, data);
}

async function update(id, userId, payload) {
  const numericId = toNumericId(id);
  const data = validatePayload(payload);
  const report = await reportRepository.updateForUser(numericId, userId, data);
  if (!report) {
    throw new AppError('Không tìm thấy report', 404);
  }
  return report;
}

async function remove(id, userId) {
  const numericId = toNumericId(id);
  const deleted = await reportRepository.deleteForUser(numericId, userId);
  if (!deleted) {
    throw new AppError('Không tìm thấy report', 404);
  }
}

// Giá trị filter đang chọn (paramName tự dò từ SQL phía client, không phải
// định nghĩa) — lưu để mở lại report không phải nhập lại. Không validate
// paramName/type vì không còn khai báo nào để đối chiếu; chỉ chặn payload
// không phải object phẳng (ObjectValue) để tránh lưu rác/mảng vào JSONB.
function validateFilterValues(filterValues) {
  if (typeof filterValues !== 'object' || filterValues === null || Array.isArray(filterValues)) {
    throw new AppError('filterValues phải là 1 object', 400);
  }
  return filterValues;
}

async function updateFilterValues(id, userId, filterValues) {
  const numericId = toNumericId(id);
  const data = validateFilterValues(filterValues);
  const updated = await reportRepository.updateFilterValues(numericId, userId, data);
  if (!updated) {
    throw new AppError('Không tìm thấy report', 404);
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
  updateFilterValues,
  remove,
  warm,
  warmAutoReports,
};

// Tự-kiểm nhanh (node src/services/reportService.js) — theo convention "không có
// test framework" của repo. Chỉ soi validateFilterOptions vì đó là phần logic mới.
if (require.main === module) {
  const assert = require('node:assert/strict');
  assert.deepEqual(validateFilterOptions(undefined), {});
  assert.deepEqual(validateFilterOptions({}), {});
  // trim + bỏ trùng + bỏ rỗng + bỏ param có list rỗng + ép chuỗi
  assert.deepEqual(
    validateFilterOptions({ region: [' Bắc ', 'Bắc', '', 'Nam'], year: [2024, 2025], empty: ['  '] }),
    { region: ['Bắc', 'Nam'], year: ['2024', '2025'] }
  );
  assert.throws(() => validateFilterOptions([]), /object/);
  assert.throws(() => validateFilterOptions({ region: 'Bắc' }), /mảng/);
  assert.throws(
    () => validateFilterOptions({ region: Array.from({ length: 201 }, (_, i) => `v${i}`) }),
    /vượt quá/
  );
  console.log('reportService.js: all assertions passed');
}
