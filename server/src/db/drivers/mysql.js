// src/db/drivers/mysql.js
// Driver MySQL — implement chung interface với drivers/postgres.js,
// drivers/mssql.js (createPool, runQuery, isTimeoutError, resolveColumnType).
// Dùng package `mysql2`. Xem server/src/db/drivers/index.js cho registry
// theo db_type.
const mysql = require('mysql2/promise');
const { Types } = require('mysql2');
const { ColumnType } = require('../columnType');

const QUERY_TIMEOUT_MS = 10_000;

// field.type mà mysql2 gán cho mỗi cột trong kết quả execute — xem
// mysql2's Types export (mã kiểu cột chuẩn của MySQL wire protocol).
const MYSQL_TYPE_MAP = {
  [Types.TINY]: ColumnType.NUMBER,
  [Types.SHORT]: ColumnType.NUMBER,
  [Types.LONG]: ColumnType.NUMBER,
  [Types.LONGLONG]: ColumnType.NUMBER,
  [Types.INT24]: ColumnType.NUMBER,
  [Types.FLOAT]: ColumnType.NUMBER,
  [Types.DOUBLE]: ColumnType.NUMBER,
  [Types.DECIMAL]: ColumnType.NUMBER,
  [Types.NEWDECIMAL]: ColumnType.NUMBER,
  [Types.YEAR]: ColumnType.NUMBER,
  [Types.DATE]: ColumnType.DATE,
  [Types.NEWDATE]: ColumnType.DATE,
  [Types.DATETIME]: ColumnType.DATE,
  [Types.TIMESTAMP]: ColumnType.DATE,
  [Types.JSON]: ColumnType.JSON,
};

function createPool(connection) {
  return mysql.createPool({
    host: connection.host,
    port: connection.port,
    database: connection.databaseName,
    user: connection.dbUser,
    password: connection.dbPassword,
    connectTimeout: QUERY_TIMEOUT_MS,
    dateStrings: true, // giữ nguyên chuỗi DATE/DATETIME, không parse thành JS Date (tránh lệch timezone)
  });
}

async function runQuery(pool, sql) {
  // connectTimeout ở createPool chỉ tính lúc bắt tay kết nối — phải truyền
  // `timeout` riêng ở đây thì mysql2 mới huỷ câu query đang chạy quá lâu.
  const [rows, fields] = await pool.query({ sql, timeout: QUERY_TIMEOUT_MS });
  return {
    columns: fields.map((field) => ({
      name: field.name,
      typeInfo: field.type,
    })),
    rows,
  };
}

function isTimeoutError(err) {
  return (
    err.code === 'ETIMEDOUT' ||
    err.code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
    err.code === 'ESOCKETTIMEDOUT'
  );
}

function resolveColumnType(typeInfo) {
  return MYSQL_TYPE_MAP[typeInfo] || ColumnType.STRING;
}

function closePool(pool) {
  return pool.end();
}

// DATABASE() trả tên DB đang connect — information_schema chứa metadata
// của mọi DB trên server nên phải lọc theo DB hiện tại.
async function listSchema(pool) {
  // MySQL trả tên cột kết quả theo case gốc trong catalog của nó
  // (TABLE_NAME/COLUMN_NAME/DATA_TYPE, viết hoa) bất kể case dùng trong
  // query — phải alias tường minh để có key thống nhất với driver khác.
  const [rows] = await pool.query(
    `SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
     ORDER BY table_name, ordinal_position`
  );
  return rows;
}

// KEY_COLUMN_USAGE của MySQL đã có sẵn REFERENCED_TABLE_NAME/COLUMN_NAME
// (khác chuẩn SQL) nên không cần join thêm bảng constraint nào khác.
async function listForeignKeys(pool) {
  const [rows] = await pool.query(
    `SELECT table_name AS table_name, column_name AS column_name,
       referenced_table_name AS referenced_table_name,
       referenced_column_name AS referenced_column_name
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`
  );
  return rows;
}

module.exports = {
  createPool,
  runQuery,
  isTimeoutError,
  resolveColumnType,
  closePool,
  listSchema,
  listForeignKeys,
};
