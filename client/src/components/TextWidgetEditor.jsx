// src/components/TextWidgetEditor.jsx
// contentEditable + toolbar dùng document.execCommand — lưu/hiển thị nội
// dung dưới dạng HTML, luôn đi qua sanitizeHtml trước khi lưu (onBlur) và
// trước khi hiển thị view-only (editable=false), vì đây là bề mặt XSS thật
// (dangerouslySetInnerHTML) — xem docs/superpowers/specs/2026-08-25-text-widget-design.md mục 3.
import { useRef } from 'react';
import { sanitizeHtml } from '../utils/sanitizeHtml';

export default function TextWidgetEditor({ html, editable, onChange }) {
  const editorRef = useRef(null);

  if (!editable) {
    return (
      <div
        className="text-widget-content"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
    );
  }

  function exec(command) {
    editorRef.current?.focus();
    document.execCommand(command);
  }

  return (
    <div className="text-widget-editor">
      <div className="text-widget-toolbar">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <strong>B</strong>
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <em>I</em>
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>
          <u>U</u>
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('insertUnorderedList')}
        >
          • List
        </button>
      </div>
      <div
        ref={editorRef}
        className="text-widget-content"
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: html }}
        onBlur={(e) => onChange(sanitizeHtml(e.currentTarget.innerHTML))}
      />
    </div>
  );
}
