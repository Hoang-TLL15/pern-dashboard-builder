// src/db/columnType.js
// Enum kiểu cột chuẩn hoá, dùng chung cho mọi driver (server/src/db/drivers/).
const ColumnType = {
  NUMBER: 'number',
  DATE: 'date',
  STRING: 'string',
  BOOLEAN: 'boolean',
  JSON: 'json',
};

module.exports = { ColumnType };
