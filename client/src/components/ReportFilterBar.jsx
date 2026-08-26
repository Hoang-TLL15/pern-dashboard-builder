// src/components/ReportFilterBar.jsx
// Thanh nhập GIÁ TRỊ global filter hiện tại của report (khác ReportFilterEditor.jsx,
// vốn chỉnh ĐỊNH NGHĨA filter) — dùng chung cho cả canvas lúc chỉnh sửa lẫn khung
// trình chiếu toàn màn hình (ReportEditor là page duy nhất phục vụ cả 2 vai trò).
// Đổi giá trị chỉ cập nhật state cục bộ (draft) — phải bấm "Áp dụng" mới báo lên cha,
// tránh gọi lại API run-batch theo từng keystroke.
import { useState } from 'react';

function castValue(type, rawValue) {
  if (type === 'number') {
    return rawValue === '' ? '' : Number(rawValue);
  }
  return rawValue;
}

export default function ReportFilterBar({ filterDefs, values, onApply }) {
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
      {filterDefs.map((f) => (
        <div className="report-filter-bar-item" key={f.paramName}>
          <label htmlFor={`report-filter-${f.paramName}`}>{f.label}</label>
          <input
            id={`report-filter-${f.paramName}`}
            type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
            value={draft[f.paramName] ?? ''}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, [f.paramName]: castValue(f.type, e.target.value) }))
            }
          />
        </div>
      ))}
      <button type="button" className="primary-button" onClick={() => onApply(draft)}>
        Áp dụng
      </button>
    </div>
  );
}
