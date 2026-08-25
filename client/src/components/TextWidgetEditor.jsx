// src/components/TextWidgetEditor.jsx
// contentEditable thuần — toolbar định dạng nằm ở ReportEditor (dùng chung
// cho mọi widget chữ trên report qua .text-widget-global-toolbar), không
// còn toolbar riêng trong từng widget. Mỗi lần vùng chọn đổi, báo lên cha
// qua onActivate(node, range) để toolbar biết đang tác động vào widget nào.
// Luôn sanitize trước khi lưu (onBlur) và trước khi hiển thị (kể cả lúc
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

  // Theo dõi vùng chọn qua selectionchange ở document — KHÔNG dùng
  // onMouseUp/onKeyUp trên chính div. Nếu người dùng kéo chọn chữ rồi thả
  // chuột ra NGOÀI ranh giới div (rất dễ xảy ra khi kéo tới sát mép),
  // onMouseUp không bao giờ fire vì target của mouseup không phải div này
  // — khiến toolbar dùng chung tác động vào vùng chọn CŨ/rỗng thay vì vùng
  // vừa chọn. selectionchange fire ở document bất kể chuột thả ở đâu, luôn
  // đúng với vùng chọn thật.
  useEffect(() => {
    if (!editable) return;
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || !editorRef.current || !editorRef.current.contains(sel.anchorNode)) return;
      onActivate(editorRef.current, sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null);
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [editable, onActivate]);

  if (!editable) {
    return (
      <div
        className="text-widget-content"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
    );
  }

  return (
    <div
      ref={editorRef}
      className="text-widget-content"
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onChange(sanitizeHtml(e.currentTarget.innerHTML))}
    />
  );
}
