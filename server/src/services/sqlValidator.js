// src/services/sqlValidator.js
// Chặn SQL không phải SELECT thuần trước khi cho chạy trên Data Source DB —
// dùng cho ad-hoc query (data-sources/:id) và khi lưu thành query_config mới.
// Parse AST bằng node-sql-parser thay vì blocklist từ khoá: blocklist không
// bắt được `SELECT ... INTO ...` (Postgres/MSSQL tạo bảng mới; MySQL ghi file
// qua INTO OUTFILE / gán biến qua INTO @var) vì câu đó không chứa từ khoá
// INSERT/UPDATE/DELETE/CREATE nào. CTE ghi dữ liệu kiểu
// `WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x` không parse được ở
// cả 3 dialect bên dưới (lỗi cú pháp) nên tự động bị chặn ở nhánh parse error,
// không cần logic duyệt CTE riêng — đã verify thủ công với node-sql-parser 5.4.0.
const { Parser } = require('node-sql-parser');
const AppError = require('../utils/AppError');

const parser = new Parser();

const DIALECT_BY_DB_TYPE = {
  postgres: 'postgresql',
  mssql: 'transactsql',
  mysql: 'mysql',
};

function assertSelectOnly(sql, dbType) {
  const database = DIALECT_BY_DB_TYPE[dbType];
  if (!database) {
    throw new AppError(`Chưa hỗ trợ loại DB "${dbType}"`, 400);
  }

  let ast;
  try {
    ast = parser.astify(sql, { database });
  } catch (err) {
    throw new AppError('Cú pháp SQL không hợp lệ', 400);
  }

  // astify trả 1 object khi đúng 1 statement không có ";" cuối, và trả mảng
  // khi có ";" (kể cả 1 statement + ";" cuối) hoặc nhiều statement nối tiếp.
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    throw new AppError('Chỉ được chạy 1 câu lệnh SELECT', 400);
  }

  const [statement] = statements;
  const hasInto = statement.into && statement.into.position != null;
  if (statement.type !== 'select' || hasInto) {
    throw new AppError('Chỉ được chạy câu lệnh SELECT (không được ghi dữ liệu)', 400);
  }
}

// Trần số dòng tối đa cho 1 lần chạy SELECT (preview lẫn query_config đã lưu)
// — chặn 1 SELECT hợp lệ nhưng trả về hàng triệu dòng làm sập server/trình
// duyệt. Sửa AST rồi sqlify lại thay vì bọc subquery `SELECT * FROM (...) LIMIT`
// vì SQL Server bắt buộc mọi cột trong derived table phải có tên — 1 SELECT
// có cột tính toán không alias (vd `SELECT COUNT(*) FROM orders`, rất phổ
// biến trong dashboard) sẽ lỗi "No column name was specified" nếu bọc kiểu
// đó. Sửa thẳng limit/top ở statement gốc né được vấn đề này với mọi dialect.
const MAX_QUERY_ROWS = 1000;

function capRowLimit(sql, dbType) {
  const database = DIALECT_BY_DB_TYPE[dbType];
  const ast = parser.astify(sql, { database });
  const statement = Array.isArray(ast) ? ast[0] : ast;

  if (database === 'transactsql') {
    const existing = statement.top?.value;
    statement.top = { value: existing != null ? Math.min(existing, MAX_QUERY_ROWS) : MAX_QUERY_ROWS, percent: null };
  } else {
    const existing = statement.limit?.value?.[0]?.value;
    statement.limit = {
      seperator: '',
      value: [{ type: 'number', value: existing != null ? Math.min(existing, MAX_QUERY_ROWS) : MAX_QUERY_ROWS }],
    };
  }

  return parser.sqlify(ast, { database });
}

module.exports = { assertSelectOnly, capRowLimit, MAX_QUERY_ROWS };

if (require.main === module) {
  const assert = require('assert');

  assert.doesNotThrow(() => assertSelectOnly('SELECT * FROM customers', 'postgres'));
  assert.doesNotThrow(() => assertSelectOnly('SELECT 1;', 'postgres'));
  assert.doesNotThrow(() =>
    assertSelectOnly('WITH x AS (SELECT * FROM t) SELECT * FROM x', 'postgres')
  );
  assert.throws(() => assertSelectOnly('SELECT 1; SELECT 2', 'postgres'), AppError);
  assert.throws(() => assertSelectOnly('DELETE FROM t', 'postgres'), AppError);
  assert.throws(() => assertSelectOnly('DROP TABLE t', 'postgres'), AppError);
  assert.throws(() => assertSelectOnly('SELECT * INTO new_table FROM t', 'postgres'), AppError);
  assert.throws(
    () => assertSelectOnly('WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', 'postgres'),
    AppError
  );
  assert.throws(() => assertSelectOnly('this is not sql', 'postgres'), AppError);
  assert.doesNotThrow(() => assertSelectOnly('SELECT 1', 'mssql'));
  assert.throws(() => assertSelectOnly('EXEC sp_who', 'mssql'), AppError);
  assert.doesNotThrow(() => assertSelectOnly('SELECT 1', 'mysql'));
  assert.throws(
    () => assertSelectOnly("SELECT * INTO OUTFILE '/tmp/x.csv' FROM t", 'mysql'),
    AppError
  );

  assert.match(capRowLimit('SELECT COUNT(*) FROM orders', 'postgres'), /LIMIT 1000/);
  assert.match(capRowLimit('SELECT TOP 10 * FROM t', 'mssql'), /TOP 10/);
  assert.match(capRowLimit('SELECT TOP 5000 * FROM t', 'mssql'), /TOP 1000/);
  assert.match(capRowLimit('SELECT a FROM t LIMIT 5', 'postgres'), /LIMIT 5\b/);
  assert.match(capRowLimit('SELECT a FROM t LIMIT 5000', 'mysql'), /LIMIT 1000/);

  console.log('sqlValidator self-check: OK');
}
