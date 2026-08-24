// src/charts/filterRows.js
// Lọc rows phía client theo filters đã cấu hình cho widget — chạy trên dữ
// liệu đã fetch từ /query-configs/:id/run (không gọi lại API, không đụng
// vào SQL đã duyệt). Filter rỗng/thiếu giá trị bị bỏ qua.

export const FILTER_OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'contains', label: 'chứa' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
];

// Toán tử hợp lệ theo từng kiểu cột (server/src/db/columnType.js) — vd
// "chứa" không có ý nghĩa với number/date, ">" không có ý nghĩa với string.
const OPERATORS_BY_TYPE = {
  string: ['eq', 'neq', 'contains'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  boolean: ['eq', 'neq'],
  json: ['eq', 'neq', 'contains'],
};

export function operatorsForType(type) {
  const allowed = OPERATORS_BY_TYPE[type] || OPERATORS_BY_TYPE.string;
  return FILTER_OPERATORS.filter((op) => allowed.includes(op.value));
}

export function defaultOperatorForType(type) {
  return operatorsForType(type)[0]?.value || 'eq';
}

function matches(cellValue, op, filterValue) {
  if (op === 'contains') {
    return String(cellValue ?? '').toLowerCase().includes(String(filterValue).toLowerCase());
  }
  const a = Number(cellValue);
  const b = Number(filterValue);
  const numeric = !Number.isNaN(a) && !Number.isNaN(b);
  switch (op) {
    case 'eq':
      return numeric ? a === b : String(cellValue) === String(filterValue);
    case 'neq':
      return numeric ? a !== b : String(cellValue) !== String(filterValue);
    case 'gt':
      return numeric && a > b;
    case 'gte':
      return numeric && a >= b;
    case 'lt':
      return numeric && a < b;
    case 'lte':
      return numeric && a <= b;
    default:
      return true;
  }
}

// runResult: { columns, rows }, filters: [{ column, op, value }]
export function applyFilters(runResult, filters) {
  if (!runResult || !filters || filters.length === 0) return runResult;
  const active = filters.filter((f) => f.column && f.op && f.value !== '');
  if (active.length === 0) return runResult;
  return {
    ...runResult,
    rows: runResult.rows.filter((row) => active.every((f) => matches(row[f.column], f.op, f.value))),
  };
}
