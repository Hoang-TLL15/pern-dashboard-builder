// src/utils/sanitizeHtml.js
// Lọc HTML từ contentEditable trước khi lưu và trước khi render lại — chỉ
// giữ tag định dạng cơ bản, bỏ toàn bộ attribute (không có ngoại lệ) để
// dangerouslySetInnerHTML không bao giờ chạy được mã độc (script, onerror,
// href="javascript:...", v.v). Dùng DOMParser gốc của trình duyệt, không
// cần thêm thư viện.
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN']);

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
      child.removeAttribute(attr.name);
    }
  }
}
