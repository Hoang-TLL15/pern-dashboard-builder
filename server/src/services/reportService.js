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

function validatePayload({ name, description, widgets }) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('name không được để trống', 400);
  }
  return {
    name: name.trim(),
    description: typeof description === 'string' ? description : null,
    widgets: validateWidgets(widgets),
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
};
