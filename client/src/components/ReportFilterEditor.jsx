// src/components/ReportFilterEditor.jsx
// UI chỉnh sửa danh sách ĐỊNH NGHĨA global filter của 1 report (paramName, label,
// type, defaultValue) — khác WidgetFilterEditor.jsx (lọc rows phía client theo cột
// có sẵn của 1 widget, không liên quan SQL). Không gọi API — chỉ báo thay đổi lên
// component cha qua onChange. paramName phải khớp đúng tên :paramName viết tay trong
// SQL của query_config (xem server/src/services/sqlParams.js) để widget nhận đúng
// giá trị filter khi report chạy lại query.
const FILTER_TYPES = [
  { value: 'number', label: 'Số' },
  { value: 'text', label: 'Chữ' },
  { value: 'date', label: 'Ngày' },
];

export default function ReportFilterEditor({ filters, onChange }) {
  function updateFilter(index, patch) {
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function addFilter() {
    onChange([...filters, { paramName: '', label: '', type: 'text', defaultValue: '' }]);
  }

  function removeFilter(index) {
    onChange(filters.filter((_, i) => i !== index));
  }

  return (
    <div className="report-filter-editor">
      {filters.map((f, i) => (
        <div className="report-filter-editor-row" key={i}>
          <input
            type="text"
            placeholder="Tên tham số (vd year)"
            value={f.paramName}
            onChange={(e) => updateFilter(i, { paramName: e.target.value })}
          />
          <input
            type="text"
            placeholder="Nhãn hiển thị (vd Năm)"
            value={f.label}
            onChange={(e) => updateFilter(i, { label: e.target.value })}
          />
          <select value={f.type} onChange={(e) => updateFilter(i, { type: e.target.value })}>
            {FILTER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Giá trị mặc định"
            value={f.defaultValue}
            onChange={(e) => updateFilter(i, { defaultValue: e.target.value })}
          />
          <button type="button" className="ghost-button" onClick={() => removeFilter(i)}>
            Xoá
          </button>
        </div>
      ))}
      <button type="button" className="ghost-button" onClick={addFilter}>
        + Thêm global filter
      </button>
    </div>
  );
}
