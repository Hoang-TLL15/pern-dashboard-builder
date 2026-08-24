// src/db/drivers/mssql.js
// Driver SQL Server — implement chung interface với drivers/postgres.js
// (createPool, runQuery, isTimeoutError, resolveColumnType). Dùng package
// `mssql` (tedious). Xem server/src/db/drivers/index.js cho registry theo
// db_type.
const sql = require('mssql');
const { ColumnType } = require('../columnType');

const QUERY_TIMEOUT_MS = 10_000;

// col.type.name mà package `mssql` gán cho mỗi cột trong
// result.recordset.columns — xem https://www.npmjs.com/package/mssql#data-types
const SQL_TYPE_NAME_MAP = {
  Bit: ColumnType.BOOLEAN,
  Int: ColumnType.NUMBER,
  BigInt: ColumnType.NUMBER,
  SmallInt: ColumnType.NUMBER,
  TinyInt: ColumnType.NUMBER,
  Float: ColumnType.NUMBER,
  Real: ColumnType.NUMBER,
  Decimal: ColumnType.NUMBER,
  Numeric: ColumnType.NUMBER,
  Money: ColumnType.NUMBER,
  SmallMoney: ColumnType.NUMBER,
  DateTime: ColumnType.DATE,
  DateTime2: ColumnType.DATE,
  SmallDateTime: ColumnType.DATE,
  Date: ColumnType.DATE,
  DateTimeOffset: ColumnType.DATE,
};

// connection: { host, port, databaseName, dbUser, dbPassword } — server thật
// trên internet (somee.com) nên bật encrypt; trustServerCertificate vì
// somee.com dùng chứng chỉ không do CA gốc ký.
function createPool(connection) {
  return new sql.ConnectionPool({
    server: connection.host,
    port: connection.port,
    database: connection.databaseName,
    user: connection.dbUser,
    password: connection.dbPassword,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
    requestTimeout: QUERY_TIMEOUT_MS,
  }).connect();
}

async function runQuery(pool, sqlText) {
  const result = await pool.request().query(sqlText);
  const columns = Object.values(result.recordset.columns).map((col) => ({
    name: col.name,
    typeInfo: col.type && col.type.name,
  }));
  return { columns, rows: result.recordset };
}

function isTimeoutError(err) {
  return err.code === 'ETIMEOUT';
}

function resolveColumnType(typeInfo) {
  return SQL_TYPE_NAME_MAP[typeInfo] || ColumnType.STRING;
}

function closePool(pool) {
  return pool.close();
}

// Schema 'dbo' là schema mặc định của SQL Server, tương đương 'public' bên
// Postgres — nơi user tạo bảng nếu không chỉ định schema khác.
async function listSchema(pool) {
  const result = await pool.request().query(
    `SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name, DATA_TYPE as data_type
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'dbo'
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  return result.recordset;
}

// SQL Server không có cột referenced_table/column sẵn trong
// KEY_COLUMN_USAGE (khác MySQL) — phải nối REFERENTIAL_CONSTRAINTS với
// TABLE_CONSTRAINTS/KEY_COLUMN_USAGE cả 2 phía (FK và PK) để suy ra.
async function listForeignKeys(pool) {
  const result = await pool.request().query(
    `SELECT
       FK.TABLE_NAME AS table_name,
       CU.COLUMN_NAME AS column_name,
       PK.TABLE_NAME AS referenced_table_name,
       PT.COLUMN_NAME AS referenced_column_name
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS RC
     JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS FK ON RC.CONSTRAINT_NAME = FK.CONSTRAINT_NAME
     JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS PK ON RC.UNIQUE_CONSTRAINT_NAME = PK.CONSTRAINT_NAME
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE CU ON RC.CONSTRAINT_NAME = CU.CONSTRAINT_NAME
     JOIN (
       SELECT i1.TABLE_NAME, i2.COLUMN_NAME, i2.CONSTRAINT_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS i1
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE i2 ON i1.CONSTRAINT_NAME = i2.CONSTRAINT_NAME
       WHERE i1.CONSTRAINT_TYPE = 'PRIMARY KEY'
     ) PT ON PT.CONSTRAINT_NAME = PK.CONSTRAINT_NAME`
  );
  return result.recordset;
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
