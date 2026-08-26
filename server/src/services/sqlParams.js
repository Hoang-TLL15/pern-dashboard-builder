// src/services/sqlParams.js
// Dịch cú pháp tham số ":paramName" (tác giả report viết trong query_configs.query)
// sang cú pháp tham số gốc của từng dialect — dùng TRƯỚC cả validate (sqlValidator.js,
// dùng node-sql-parser để astify, không hiểu ":paramName") lẫn execute (driver cần cú
// pháp gốc để bind giá trị thật, không nối chuỗi). Xem mục 3 design doc.
//
// ponytail: quét bằng regex, không phải SQL tokenizer thật — chuỗi literal chứa dấu
// ':' (vd giờ '12:30:00') có thể bị hiểu nhầm thành tham số. Nâng cấp nếu cần chính
// xác tuyệt đối: parse qua AST của node-sql-parser thay vì quét text.
const AppError = require('../utils/AppError');

// Khớp ":year" nhưng KHÔNG khớp "::date" (cast operator của Postgres) nhờ negative
// lookbehind chặn dấu ":" đứng ngay trước.
const PARAM_PATTERN = /(?<!:):([a-zA-Z_]\w*)\b/g;

function compileParams(sql, dbType) {
  const paramNames = []; // tên duy nhất, theo thứ tự xuất hiện lần đầu
  const occurrences = []; // MỌI lần xuất hiện, theo thứ tự (kể cả lặp lại) — cần cho MySQL "?"

  const compiledSql = sql.replace(PARAM_PATTERN, (_match, name) => {
    occurrences.push(name);
    let uniqueIndex = paramNames.indexOf(name);
    if (uniqueIndex === -1) {
      paramNames.push(name);
      uniqueIndex = paramNames.length - 1;
    }
    if (dbType === 'postgres') return `$${uniqueIndex + 1}`;
    if (dbType === 'mssql') return `@${name}`;
    if (dbType === 'mysql') return '?';
    throw new AppError(`Chưa hỗ trợ loại DB "${dbType}"`, 400);
  });

  // Dựng giá trị bind đúng shape mà driver của từng dialect cần — xem
  // db/drivers/{postgres,mssql,mysql}.js runQuery().
  function buildValues(valuesByName) {
    if (dbType === 'postgres') return paramNames.map((name) => valuesByName[name]);
    if (dbType === 'mysql') return occurrences.map((name) => valuesByName[name]);
    const named = {};
    for (const name of paramNames) named[name] = valuesByName[name];
    return named;
  }

  return { sql: compiledSql, paramNames, buildValues };
}

module.exports = { compileParams };

if (require.main === module) {
  const assert = require('assert');

  // postgres: đánh số theo thứ tự xuất hiện, tên lặp lại dùng lại cùng số
  let r = compileParams('SELECT * FROM t WHERE a = :year AND b = :year AND c = :region', 'postgres');
  assert.strictEqual(r.sql, 'SELECT * FROM t WHERE a = $1 AND b = $1 AND c = $2');
  assert.deepStrictEqual(r.paramNames, ['year', 'region']);
  assert.deepStrictEqual(r.buildValues({ year: 2024, region: 'VN' }), [2024, 'VN']);

  // mssql: đổi tên biến, request.input() bind theo tên nên không cần đánh số
  r = compileParams('SELECT * FROM t WHERE a = :year', 'mssql');
  assert.strictEqual(r.sql, 'SELECT * FROM t WHERE a = @year');
  assert.deepStrictEqual(r.buildValues({ year: 2024 }), { year: 2024 });

  // mysql: "?" theo vị trí — giá trị phải lặp lại đúng số lần xuất hiện trong SQL,
  // không dùng lại theo tên như postgres
  r = compileParams('SELECT * FROM t WHERE a = :year AND b = :year', 'mysql');
  assert.strictEqual(r.sql, 'SELECT * FROM t WHERE a = ? AND b = ?');
  assert.deepStrictEqual(r.buildValues({ year: 2024 }), [2024, 2024]);

  // không nhầm "::cast" của Postgres thành tham số
  r = compileParams('SELECT order_date::date, :year FROM t', 'postgres');
  assert.strictEqual(r.sql, 'SELECT order_date::date, $1 FROM t');
  assert.deepStrictEqual(r.paramNames, ['year']);

  // SQL không có tham số nào -> không đổi gì
  r = compileParams('SELECT * FROM t', 'postgres');
  assert.strictEqual(r.sql, 'SELECT * FROM t');
  assert.deepStrictEqual(r.paramNames, []);

  assert.throws(() => compileParams('SELECT :x FROM t', 'oracle'), AppError);

  console.log('sqlParams self-check: OK');
}
