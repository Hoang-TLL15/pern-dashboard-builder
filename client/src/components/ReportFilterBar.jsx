// src/components/ReportFilterBar.jsx
// Thanh nhập GIÁ TRỊ global filter hiện tại của report — filterDefs được ReportEditor
// tự suy ra từ :paramName có trong SQL của các widget, không có bước khai báo thủ
// công. Dùng chung cho cả canvas lúc chỉnh sửa lẫn khung trình chiếu toàn màn hình
// (ReportEditor là page duy nhất phục vụ cả 2 vai trò).
// Đổi giá trị chỉ cập nhật state cục bộ (draft) — phải bấm "Áp dụng" mới báo lên cha,
// tránh gọi lại API run-batch theo từng keystroke.
// Nếu report author đã khai 1 list lựa chọn cho param (filterOptions[paramName]) thì
// render <select> thay cho <input>; editable=true (chỉ canvas) hiện thêm ô thêm/xoá
// lựa chọn cho từng param.
import { useState } from 'react';

function castValue(type, rawValue) {
  if (type === 'number') {
    return rawValue === '' ? '' : Number(rawValue);
  }
  return rawValue;
}

// Chips + ô nhập để report author tự thêm/xoá lựa chọn cho dropdown của 1 param.
function OptionEditor({ options, onChange }) {
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (value && !options.includes(value)) onChange([...options, value]);
    setDraft('');
  }

  return (
    <div className="report-filter-options-editor">
      {options.map((opt) => (
        <span className="report-filter-option-chip" key={opt}>
          {opt}
          <button type="button" title="Xoá lựa chọn" onClick={() => onChange(options.filter((o) => o !== opt))}>
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className="report-filter-option-add"
        placeholder="Thêm lựa chọn…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
      />
      <button type="button" className="ghost-button" onClick={add} disabled={!draft.trim()}>
        +
      </button>
    </div>
  );
}

export default function ReportFilterBar({
  filterDefs,
  values,
  onApply,
  filterOptions = {},
  editable = false,
  onFilterOptionsChange,
}) {
  const [draft, setDraft] = useState(values);
  // So sánh trong lúc render (không dùng useEffect) để tránh cascading render —
  // xem https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  // Đồng bộ lại draft khi cha đổi values từ bên ngoài (vd report vừa tải xong) —
  // không phụ thuộc filterDefs vì đổi định nghĩa (thêm/xoá 1 filter khác) không nên
  // xoá giá trị người dùng đang gõ dở ở các filter còn lại.
  const [prevValues, setPrevValues] = useState(values);
  if (values !== prevValues) {
    setPrevValues(values);
    setDraft(values);
  }

  if (filterDefs.length === 0) return null;

  return (
    <div className="report-filter-bar">
      {filterDefs.map((f) => {
        const options = filterOptions[f.paramName];
        const useDropdown = Array.isArray(options) && options.length > 0;
        const current = draft[f.paramName] ?? '';
        const setValue = (raw) =>
          setDraft((prev) => ({ ...prev, [f.paramName]: castValue(f.type, raw) }));

        return (
          <div className="report-filter-bar-item" key={f.paramName}>
            <label htmlFor={`report-filter-${f.paramName}`}>{f.label}</label>
            {useDropdown ? (
              <select
                id={`report-filter-${f.paramName}`}
                value={current}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">—</option>
                {current !== '' && !options.includes(current) && (
                  <option value={current}>{current}</option>
                )}
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`report-filter-${f.paramName}`}
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={current}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            {editable && (
              <details className="report-filter-options-disclosure">
                <summary title="Lựa chọn cho dropdown">
                  ⚙ lựa chọn{useDropdown ? ` (${options.length})` : ''}
                </summary>
                <OptionEditor
                  options={Array.isArray(options) ? options : []}
                  onChange={(next) => onFilterOptionsChange(f.paramName, next)}
                />
              </details>
            )}
          </div>
        );
      })}
      <button type="button" className="primary-button" onClick={() => onApply(draft)}>
        Áp dụng
      </button>
    </div>
  );
}
