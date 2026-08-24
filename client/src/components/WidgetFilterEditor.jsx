// src/components/WidgetFilterEditor.jsx
// UI chỉnh sửa danh sách filter (client-side) của 1 widget. Không gọi API —
// chỉ báo thay đổi filters lên component cha qua onChange. Operator và kiểu
// input value tự khớp theo columns[].type để tránh người dùng chọn toán tử
// vô nghĩa (vd "chứa" trên cột number); value còn gợi ý sẵn giá trị có thật
// trong dữ liệu (datalist) để đỡ phải gõ tay/đoán chính tả.
import { operatorsForType, defaultOperatorForType } from '../charts/filterRows';

function distinctValues(rows, columnKey, limit = 200) {
  const seen = new Set();
  for (const row of rows) {
    seen.add(row[columnKey]);
    if (seen.size >= limit) break;
  }
  return [...seen].filter((v) => v !== null && v !== undefined);
}

export default function WidgetFilterEditor({ columns, rows, filters, onChange }) {
  const columnByKey = new Map(columns.map((c) => [c.key, c]));

  function updateFilter(index, patch) {
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function handleColumnChange(index, columnKey) {
    const type = columnByKey.get(columnKey)?.type;
    updateFilter(index, { column: columnKey, op: defaultOperatorForType(type), value: '' });
  }

  function addFilter() {
    const firstCol = columns[0];
    onChange([
      ...filters,
      { column: firstCol?.key || '', op: defaultOperatorForType(firstCol?.type), value: '' },
    ]);
  }

  function removeFilter(index) {
    onChange(filters.filter((_, i) => i !== index));
  }

  return (
    <div className="widget-filter-editor">
      {filters.map((f, i) => {
        const column = columnByKey.get(f.column);
        const type = column?.type;
        const listId = `widget-filter-values-${column?.key || i}`;

        return (
          <div className="widget-filter-row" key={i}>
            <select value={f.column} onChange={(e) => handleColumnChange(i, e.target.value)}>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <select value={f.op} onChange={(e) => updateFilter(i, { op: e.target.value })}>
              {operatorsForType(type).map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            {type === 'boolean' ? (
              <select value={f.value} onChange={(e) => updateFilter(i, { value: e.target.value })}>
                <option value="">Chọn giá trị…</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <>
                <input
                  type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                  value={f.value}
                  placeholder="Giá trị"
                  list={listId}
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                />
                <datalist id={listId}>
                  {distinctValues(rows, f.column).map((v) => (
                    <option key={String(v)} value={v} />
                  ))}
                </datalist>
              </>
            )}
            <button className="ghost-button" onClick={() => removeFilter(i)}>
              Xoá
            </button>
          </div>
        );
      })}
      <button className="ghost-button" onClick={addFilter}>
        + Thêm điều kiện lọc
      </button>
    </div>
  );
}
