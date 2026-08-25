// src/utils/sanitizeHtml.js
// Lọc HTML từ contentEditable trước khi lưu và trước khi render lại — chỉ
// giữ tag định dạng cơ bản, bỏ toàn bộ attribute (không có ngoại lệ) để
// dangerouslySetInnerHTML không bao giờ chạy được mã độc (script, onerror,
// href="javascript:...", v.v). Dùng DOMParser gốc của trình duyệt, không
// cần thêm thư viện.
//
// Ngoại lệ duy nhất: attribute `style` được giữ lại NẾU giá trị khớp đúng 1
// trong các pattern an toàn bên dưới (đúng 1 khai báo CSS, không có gì
// khác) — phục vụ cỡ chữ/màu chữ/căn lề do toolbar chèn qua Range
// API/execCommand (xem ReportEditor). Màu/cỡ chữ được chấp nhận trên MỌI
// tag định dạng (không chỉ SPAN) vì execCommand có thể gắn style thẳng lên
// tag sẵn có (vd <b style="color:...">) khi vùng chọn khớp đúng nội dung
// tag đó, không phải lúc nào cũng bọc thêm SPAN mới. Căn lề (text-align)
// chỉ chấp nhận trên DIV/P vì luôn là thuộc tính cấp khối. Không có ngoại
// lệ cho attribute nào khác trên bất kỳ tag nào.
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN']);
// Trình duyệt tự chuẩn hoá style khi đọc lại từ DOM — foreColor ra
// "rgb(r, g, b)" chứ không phải hex dù truyền hex vào, và luôn có thể có
// dấu ";" cuối — regex phải khớp đúng định dạng thật này, không phải định
// dạng lý tưởng.
const INLINE_STYLE_RE =
  /^(color:\s*(#[0-9a-fA-F]{6}|rgb\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3}\s*\))|font-size:\s*\d{1,3}px)\s*;?$/;
const BLOCK_ALIGN_RE = /^text-align:\s*(left|center|right|justify)\s*;?$/;

function isSafeStyle(tagName, value) {
  if (INLINE_STYLE_RE.test(value)) return true;
  return (tagName === 'DIV' || tagName === 'P') && BLOCK_ALIGN_RE.test(value);
}

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}

function clean(node) {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') {
      child.remove();
      continue;
    }
    clean(child);
    if (!ALLOWED_TAGS.has(child.tagName)) {
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      if (attr.name === 'style' && isSafeStyle(child.tagName, attr.value.trim())) continue;
      child.removeAttribute(attr.name);
    }
  }
}
