// src/utils/sqlParams.js
// Dò tên tham số :paramName trong 1 chuỗi SQL đã chạy xong (result.query trả về từ
// /query-configs/:id/run) — thuần data transform, dùng chung ở mọi nơi cần biết
// query đang xem có tham số gì (ReportEditor picker, DbConnectionDetail preview).
// Phải khớp PARAM_PATTERN của server/src/services/sqlParams.js để tên phát hiện
// được ở UI đúng với tham số backend thực sự bind khi chạy query.
const PARAM_PATTERN = /(?<!:):([a-zA-Z_]\w*)\b/g;

export function detectParamNames(sql) {
  if (!sql) return [];
  const names = [];
  for (const match of sql.matchAll(PARAM_PATTERN)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}
