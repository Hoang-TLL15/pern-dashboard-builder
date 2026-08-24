// src/db/drivers/index.js
// Registry driver theo db_connections.db_type — dataSourcePool.js và
// queryConfigService.js chỉ biết interface chung (createPool, runQuery,
// isTimeoutError, resolveColumnType), không biết chi tiết từng driver.
const postgres = require('./postgres');
const mssql = require('./mssql');
const mysql = require('./mysql');

module.exports = {
  postgres,
  mssql,
  mysql,
};
