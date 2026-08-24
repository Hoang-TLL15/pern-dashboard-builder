// src/db/drivers/postgres.js
// Driver Postgres — implement chung interface với các driver khác
// (createPool, runQuery, isTimeoutError, resolveColumnType). Xem
// server/src/db/drivers/index.js cho registry theo db_type.
const { Pool, types } = require('pg');
const { ColumnType } = require('../columnType');

// OID 1082 = kiểu `date` của Postgres (không có time). Mặc định pg parse
// thành JS Date rồi JSON serialize kèm giờ + lệch timezone (vd
// "2024-01-09" -> "2024-01-08T17:00:00.000Z" ở GMT+7). Giữ nguyên chuỗi
// "YYYY-MM-DD" Postgres trả về, không parse thành Date.
types.setTypeParser(1082, (value) => value);

const QUERY_TIMEOUT_MS = 10_000; // Postgres huỷ query chạy quá 10s (mã lỗi 57014)

const OID_TYPE_MAP = {
  16: ColumnType.BOOLEAN,
  20: ColumnType.NUMBER,
  21: ColumnType.NUMBER,
  23: ColumnType.NUMBER,
  700: ColumnType.NUMBER,
  701: ColumnType.NUMBER,
  1700: ColumnType.NUMBER,
  1082: ColumnType.DATE,
  1114: ColumnType.DATE,
  1184: ColumnType.DATE,
  114: ColumnType.JSON,
  3802: ColumnType.JSON,
};

function createPool(connection) {
  return new Pool({
    host: connection.host,
    port: connection.port,
    database: connection.databaseName,
    user: connection.dbUser,
    password: connection.dbPassword,
    statement_timeout: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
}

async function runQuery(pool, sql) {
  const result = await pool.query(sql);
  return {
    columns: result.fields.map((field) => ({
      name: field.name,
      typeInfo: field.dataTypeID,
    })),
    rows: result.rows,
  };
}

function isTimeoutError(err) {
  return err.code === '57014';
}

function resolveColumnType(typeInfo) {
  return OID_TYPE_MAP[typeInfo] || ColumnType.STRING;
}

function closePool(pool) {
  return pool.end();
}

// Liệt kê bảng + cột của schema 'public' (schema mặc định người dùng tạo
// bảng) — loại 'information_schema'/'pg_catalog' vì đó là schema hệ thống.
async function listSchema(pool) {
  const result = await pool.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  return result.rows;
}

// Liệt kê quan hệ FK (cột con -> bảng/cột cha) trong schema 'public' —
// dùng để vẽ đường nối giữa các bảng trên ERD.
async function listForeignKeys(pool) {
  const result = await pool.query(
    `SELECT
       kcu.table_name,
       kcu.column_name,
       ccu.table_name AS referenced_table_name,
       ccu.column_name AS referenced_column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
  );
  return result.rows;
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
