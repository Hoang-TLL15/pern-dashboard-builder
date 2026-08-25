// src/components/TextWidgetEditor.jsx
// contentEditable thuần — toolbar định dạng nằm ở ReportEditor (dùng chung
// cho mọi widget chữ trên report qua .text-widget-global-toolbar), không
// còn toolbar riêng trong từng widget. Mỗi lần focus/đổi vùng chọn, báo lên
// cha qua onActivate(node, range) để toolbar biết đang tác động vào widget
// nào. Luôn sanitize trước khi lưu (onBlur) và trước khi hiển thị (kể cả lúc
// đang sửa), vì đây là bề mặt XSS thật (dangerouslySetInnerHTML).
//
// Nội dung div contentEditable set 1 LẦN DUY NHẤT lúc mount qua useEffect
// (KHÔNG dùng dangerouslySetInnerHTML trên chính div này) — sau đó DOM tự
// quản lý hoàn toàn, React không còn sở hữu/diff children của nó nữa. Bắt
// buộc phải làm vậy: mọi re-render của cha (vd toolbar dùng chung set
// hasActiveTextEditor lúc focus) khiến React re-diff div này; kể cả khi
// dangerouslySetInnerHTML trỏ đúng 1 string không đổi, React vẫn ghi đè lại
// nội dung DOM do execCommand/insertText vừa chèn (native, ngoài tầm biết
// của React) — làm mất trắng những gì vừa gõ và làm hỏng mọi Range đã lưu
// (onActivate) trỏ vào node cũ bị thay.
import { useEffect, useRef } from 'react';
import { sanitizeHtml } from '../utils/sanitizeHtml';

export default function TextWidgetEditor({ html, editable, onChange, onActivate }) {
  const editorRef = useRef(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = sanitizeHtml(html);
    // chỉ set lúc mount, xem comment đầu file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!editable) {
    return (
      <div
        className="text-widget-content"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
    );
  }

  function reportActivation() {
    const sel = window.getSelection();
    onActivate(editorRef.current, sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null);
  }

  return (
    <div
      ref={editorRef}
      className="text-widget-content"
      contentEditable
      suppressContentEditableWarning
      onFocus={reportActivation}
      onMouseUp={reportActivation}
      onKeyUp={reportActivation}
      onBlur={(e) => onChange(sanitizeHtml(e.currentTarget.innerHTML))}
    />
  );
}
