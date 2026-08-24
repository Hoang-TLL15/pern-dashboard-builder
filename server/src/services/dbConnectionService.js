// src/services/dbConnectionService.js
// Lớp business logic cho db_connections — hiện chỉ liệt kê/tra cứu, không
// có quy tắc nghiệp vụ phức tạp. Không biết gì về req/res của HTTP.
const dbConnectionRepository = require('../repositories/dbConnectionRepository');
const dataSourcePool = require('../db/dataSourcePool');
const drivers = require('../db/drivers');
const AppError = require('../utils/AppError');

function toValidId(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    throw new AppError('id không hợp lệ', 400);
  }
  return numericId;
}

async function list() {
  return dbConnectionRepository.findAll();
}

async function getById(id) {
  const connection = await dbConnectionRepository.findById(toValidId(id));
  if (!connection) {
    throw new AppError('Không tìm thấy kết nối', 404);
  }
  return connection;
}

// Liệt kê bảng + cột của Data Source DB để người dùng biết viết SELECT
// nhắm vào đâu — không chạy SQL tuỳ ý, chỉ đọc information_schema.
async function getSchema(id) {
  const numericId = toValidId(id);

  const connection = await dbConnectionRepository.findByIdWithCredentials(numericId);
  if (!connection) {
    throw new AppError('Không tìm thấy kết nối', 404);
  }

  const driver = drivers[connection.dbType];
  if (!driver) {
    throw new AppError(`Chưa hỗ trợ loại DB "${connection.dbType}"`, 400);
  }

  const pool = await dataSourcePool.getPool(connection);

  const cached = dataSourcePool.getCachedSchema(numericId);
  if (cached) {
    return cached;
  }

  const [columnRows, fkRows] = await Promise.all([
    driver.listSchema(pool),
    driver.listForeignKeys(pool),
  ]);

  const tablesByName = new Map();
  for (const row of columnRows) {
    if (!tablesByName.has(row.table_name)) {
      tablesByName.set(row.table_name, { table: row.table_name, columns: [] });
    }
    tablesByName.get(row.table_name).columns.push({
      name: row.column_name,
      type: row.data_type,
    });
  }

  const foreignKeys = fkRows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
    referencedTable: row.referenced_table_name,
    referencedColumn: row.referenced_column_name,
  }));

  const data = { tables: [...tablesByName.values()], foreignKeys };
  dataSourcePool.setCachedSchema(numericId, data);
  return data;
}

module.exports = {
  list,
  getById,
  getSchema,
};
