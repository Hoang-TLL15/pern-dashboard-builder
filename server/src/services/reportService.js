// src/services/reportService.js
// Lớp business logic cho reports — không biết gì về req/res của HTTP.
// BE không hiểu nội dung chart_config, chỉ validate phần khung (mục 7 design doc).
const reportRepository = require('../repositories/reportRepository');
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
  'metric',
  'table',
];

const ALLOWED_FILTER_TYPES = ['number', 'text', 'date'];
const PARAM_NAME_PATTERN = /^[a-zA-Z_]\w*$/;

// Validate danh sách ĐỊNH NGHĨA global filter của report (không phải giá trị đang
// chọn — giá trị chỉ tồn tại phía client, xem ReportFilterBar.jsx). paramName phải
// khớp regex vì nó được ghép thẳng thành "@paramName" khi chạy trên MSSQL
// (sqlParams.js) — chặn injection qua chính tên tham số nếu ai gọi thẳng API.
function validateFilters(filters) {
  if (filters === undefined) return [];
  if (!Array.isArray(filters)) {
    throw new AppError('filters phải là 1 mảng', 400);
  }
  return filters.map((f) => {
    if (typeof f.paramName !== 'string' || !PARAM_NAME_PATTERN.test(f.paramName)) {
      throw new AppError(`filter.paramName không hợp lệ: ${f.paramName}`, 400);
    }
    if (typeof f.label !== 'string' || !f.label.trim()) {
      throw new AppError('filter.label không được để trống', 400);
    }
    if (!ALLOWED_FILTER_TYPES.includes(f.type)) {
      throw new AppError(`filter.type không hợp lệ: ${f.type}`, 400);
    }
    return {
      paramName: f.paramName,
      label: f.label.trim(),
      type: f.type,
      defaultValue: typeof f.defaultValue === 'string' ? f.defaultValue : '',
    };
  });
}

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

function validatePayload({ name, description, widgets, filters }) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('name không được để trống', 400);
  }
  return {
    name: name.trim(),
    description: typeof description === 'string' ? description : null,
    widgets: validateWidgets(widgets),
    filters: validateFilters(filters),
  };
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

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
};
