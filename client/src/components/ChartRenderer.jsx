// src/components/ChartRenderer.jsx
// Nhận thẳng response của /query-configs/:id/run (runResult) + chartType do
// người dùng chọn, render ra chart.js tương ứng. Không tự quyết định loại
// chart — chartType luôn do component cha (DbConnectionDetail) điều khiển.
import '../charts/registerChartjs';
import { Bar, Line, Pie, Doughnut, Radar, Scatter, Bubble } from 'react-chartjs-2';
import { buildChartConfig, buildMetric } from '../charts/chartAdapter';

const CHART_COMPONENT_BY_TYPE = {
  bar: Bar,
  stacked_bar: Bar,
  line: Line,
  area: Line,
  pie: Pie,
  doughnut: Doughnut,
  radar: Radar,
  scatter: Scatter,
  bubble: Bubble,
};

function formatMetricValue(value) {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return numeric.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

export default function ChartRenderer({ runResult, chartType }) {
  if (chartType === 'table') {
    const { columns, rows } = runResult;
    return (
      <div className="query-result-table-wrap">
        <table className="query-result-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key}>
                  {col.label}
                  <span className="query-result-col-type">{col.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key}>{String(row[col.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (chartType === 'metric') {
    const { label, value } = buildMetric(runResult);
    return (
      <div className="metric-card">
        <span className="metric-value">{formatMetricValue(value)}</span>
        {label && <span className="metric-label">{label}</span>}
      </div>
    );
  }

  const config = buildChartConfig(runResult, chartType);
  const ChartComponent = CHART_COMPONENT_BY_TYPE[chartType];

  if (!config || !ChartComponent) {
    return <p className="placeholder-text">Không có dữ liệu để vẽ biểu đồ</p>;
  }

  return (
    <div className="chart-canvas-wrap">
      <ChartComponent data={config.data} options={config.options} />
    </div>
  );
}
