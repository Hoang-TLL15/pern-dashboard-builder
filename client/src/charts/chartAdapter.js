// src/charts/chartAdapter.js
// Chuyển response của /query-configs/:id/run (columns + rows) sang cấu hình
// Chart.js. Không phụ thuộc React — thuần data transform, tái dùng được ở
// đâu cũng gọi. Chart nào để render do người dùng chọn (chartType), không
// bắt buộc theo suggestedChartType — suggestedChartType chỉ là giá trị mặc
// định ban đầu.

export const CHART_TYPE_OPTIONS = [
  { value: 'bar', label: 'Cột (Bar)' },
  { value: 'stacked_bar', label: 'Cột chồng (Stacked bar)' },
  { value: 'line', label: 'Đường (Line)' },
  { value: 'area', label: 'Vùng (Area)' },
  { value: 'pie', label: 'Tròn (Pie)' },
  { value: 'doughnut', label: 'Vành khuyên (Doughnut)' },
  { value: 'radar', label: 'Mạng nhện (Radar)' },
  { value: 'scatter', label: 'Phân tán (Scatter)' },
  { value: 'bubble', label: 'Bong bóng (Bubble)' },
  { value: 'metric', label: 'Số liệu (Metric)' },
  { value: 'table', label: 'Bảng (Table)' },
];

// Điều kiện để mỗi loại chart render ra nghĩa lý với shape response hiện có
// (khớp điều kiện null-return / rỗng của các hàm build* bên dưới, cộng thêm
// vài ràng buộc ngữ nghĩa). labelCount/seriesCount lấy từ chính buildSeries
// thật (không đoán qua số cột/số dòng) nên phản ánh đúng những gì sẽ render,
// kể cả sau khi pivot "long"/tidy: bar cần >=1 series render ra được;
// stacked_bar cần >=2 series thì chồng mới có ý nghĩa (1 series thì giống
// hệt bar); line/area/pie/doughnut cần >=2 nhãn vì 1 điểm không vẽ được
// đường/lát cắt có nghĩa; radar cần >=3 nhãn để thành đa giác (2 trục trở
// xuống suy biến thành 1 đường/điểm); scatter cần x+y, bubble cần thêm r;
// metric chỉ hợp lý khi response đúng 1 dòng — buildMetric() luôn lấy
// rows[0], response nhiều dòng chọn metric sẽ âm thầm bỏ hết các dòng còn
// lại (trông như đúng nhưng sai/thiếu dữ liệu, không phải placeholder rỗng
// nên khó nhận ra); table không có ràng buộc, luôn hiển thị đúng mọi shape.
const CHART_RULES = {
  bar: ({ seriesCount }) => seriesCount >= 1,
  stacked_bar: ({ seriesCount }) => seriesCount >= 2,
  line: ({ seriesCount, labelCount }) => seriesCount >= 1 && labelCount >= 2,
  area: ({ seriesCount, labelCount }) => seriesCount >= 1 && labelCount >= 2,
  pie: ({ seriesCount, labelCount }) => seriesCount >= 1 && labelCount >= 2,
  doughnut: ({ seriesCount, labelCount }) => seriesCount >= 1 && labelCount >= 2,
  radar: ({ seriesCount, labelCount }) => seriesCount >= 1 && labelCount >= 3,
  scatter: ({ numberCols }) => numberCols >= 2,
  bubble: ({ numberCols }) => numberCols >= 3,
  metric: ({ rowCount }) => rowCount === 1,
  table: () => true,
};

// Lọc CHART_TYPE_OPTIONS xuống những loại chart render ra được với shape dữ
// liệu hiện có, để không cho chọn loại chart chắc chắn render null/rỗng hoặc
// vô nghĩa. Dùng buildSeries thật (cùng hàm mà buildCategoryChart/buildLine/
// .../buildRadarChart dùng để render) thay vì đoán riêng qua số cột/số dòng,
// nên luôn khớp với những gì thực sự lên chart — kể cả case pivot long/tidy.
export function getApplicableChartTypes(runResult) {
  if (!runResult?.columns || !runResult.rows) return CHART_TYPE_OPTIONS;
  // 0 dòng: buildSeries vẫn có thể trả series khung rỗng (data: []) nên các
  // rule số lượng ở trên không bắt được — chỉ table hiển thị hợp lý khi
  // không có dữ liệu, mọi chart khác chỉ ra khung trống.
  if (runResult.rows.length === 0) return CHART_TYPE_OPTIONS.filter((opt) => opt.value === 'table');
  const numberCols = runResult.columns.filter((c) => c.type === 'number').length;
  const { labels, series } = buildSeries(runResult);
  const ctx = { numberCols, labelCount: labels.length, seriesCount: series.length, rowCount: runResult.rows.length };
  return CHART_TYPE_OPTIONS.filter((opt) => (CHART_RULES[opt.value] ?? (() => true))(ctx));
}

// Trả về chartType hợp lệ với runResult hiện tại: giữ preferredChartType nếu
// còn nằm trong getApplicableChartTypes, ngược lại rơi về lựa chọn đầu tiên
// còn áp dụng được. Bắt buộc dùng ở mọi nơi set chartType từ 1 giá trị cũ/gợi
// ý (suggestedChartType, chartType đã lưu trong report) — nếu không, dropdown
// lọc đúng nhưng ChartRenderer vẫn có thể nhận 1 chartType đã bị lọc bỏ và
// render ra đúng thứ getApplicableChartTypes được tạo ra để ngăn.
export function pickChartType(runResult, preferredChartType) {
  const applicable = getApplicableChartTypes(runResult);
  if (applicable.some((opt) => opt.value === preferredChartType)) return preferredChartType;
  return applicable[0]?.value ?? 'table';
}

const PALETTE = [
  '#3452e1',
  '#e15134',
  '#22a06b',
  '#e1a834',
  '#8a3ee1',
  '#0ea5c8',
  '#e13487',
  '#6b7280',
];

function colorAt(i) {
  return PALETTE[i % PALETTE.length];
}

function formatLabelValue(value) {
  if (value === null || value === undefined) return '(null)';
  return String(value);
}

// Format số liệu hiển thị trực tiếp trên chart (datalabels) — dùng chung
// locale vi-VN với tooltip radar để nhất quán.
function formatDataLabel(value) {
  return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

// Tách rows thành { labels, series } dùng chung cho bar/stacked_bar/line.
//
// Có 2 dạng response cần xử lý khác nhau:
// - "wide": 1 cột nhãn + N cột số riêng biệt trên cùng 1 dòng
//   (vd: product_name, revenue, cost -> mỗi cột số là 1 series).
// - "long"/tidy: 1 cột nhãn trục X + 1 cột phân nhóm (group) + 1 cột số,
//   mỗi dòng chỉ là 1 điểm dữ liệu (vd: month, category, revenue). Case này
//   PHẢI pivot lại: trục X lấy giá trị duy nhất của cột nhãn, mỗi giá trị
//   duy nhất của cột group thành 1 series riêng — nếu không pivot thì mỗi
//   dòng biến thành 1 cột đứng riêng lẻ, cột nhãn bị lặp lại nhiều lần và
//   không có gì để nhóm/chồng cả (bug thực tế gặp phải với "Doanh thu theo
//   danh mục và tháng": month+category+revenue bị hiểu nhầm thành wide).
//
// Dấu hiệu phân biệt 2 dạng KHÔNG phải là "có >=2 cột non-number" (vd
// title+author+published_at vẫn chỉ là wide 1-dòng-1-thực-thể với 2 cột mô
// tả thêm) mà là cột nhãn có GIÁ TRỊ LẶP LẠI giữa các dòng hay không — chỉ
// khi nhãn lặp mới thực sự cần pivot theo group. Pivot nhầm case title
// unique sẽ tạo series rỗng-gần-hết (mỗi group chỉ có giá trị ở đúng 1
// nhãn) và vẽ ra chart sai (bar mỗi cột 1 màu ngẫu nhiên, line gãy khúc về 0).
function buildSeries(runResult) {
  const { columns, rows } = runResult;
  const nonNumberCols = columns.filter((c) => c.type !== 'number');
  const numberCols = columns.filter((c) => c.type === 'number');
  const labelColumn = nonNumberCols[0] || columns[0];
  const labelValues = rows.map((row) => formatLabelValue(row[labelColumn.key]));
  const hasDuplicateLabels = new Set(labelValues).size < labelValues.length;

  if (nonNumberCols.length >= 2 && numberCols.length >= 1 && hasDuplicateLabels) {
    const groupCol = nonNumberCols[1];
    const valueCol = numberCols[0];

    const labels = [];
    const labelSeen = new Set();
    const groups = [];
    const groupSeen = new Set();
    const valueMap = new Map();

    for (const row of rows) {
      const label = formatLabelValue(row[labelColumn.key]);
      const group = formatLabelValue(row[groupCol.key]);
      if (!labelSeen.has(label)) {
        labelSeen.add(label);
        labels.push(label);
      }
      if (!groupSeen.has(group)) {
        groupSeen.add(group);
        groups.push(group);
      }
      const mapKey = `${label} ${group}`;
      const value = Number(row[valueCol.key]) || 0;
      valueMap.set(mapKey, (valueMap.get(mapKey) || 0) + value);
    }

    const series = groups.map((group) => ({
      label: group,
      data: labels.map((label) => valueMap.get(`${label} ${group}`) ?? 0),
    }));

    return { labels, series };
  }

  const valueColumns = numberCols.filter((c) => c.key !== labelColumn.key);
  const labels = labelValues;
  const series = valueColumns.map((col) => ({
    label: col.label,
    data: rows.map((row) => Number(row[col.key])),
  }));

  return { labels, series };
}

// Bar / Stacked bar: mỗi series thành 1 dataset. stacked=true chồng các
// dataset lên nhau tại từng nhãn trục X, stacked=false đặt cạnh nhau.
function buildCategoryChart(runResult, { stacked }) {
  const { labels, series } = buildSeries(runResult);

  const datasets = series.map((s, i) => ({
    label: s.label,
    data: s.data,
    backgroundColor: stacked ? colorAt(i) : `${colorAt(i)}cc`,
    borderColor: colorAt(i),
    borderWidth: 1,
    borderRadius: stacked ? 0 : 4,
  }));

  return {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Khi giá trị lớn nhất trùng đúng max tự động của trục y (vd data max=3,
      // Chart.js chọn luôn max=3 không dư khoảng trống), datalabel align:'top'
      // của cột cao nhất bị đẩy sát/khuất mép trên canvas. Chừa sẵn padding
      // trên để luôn có chỗ cho label bất kể data.
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: series.length > 1 },
        datalabels: {
          anchor: stacked ? 'center' : 'end',
          align: stacked ? 'center' : 'top',
          color: stacked ? '#fff' : '#1f2933',
          font: { size: 10 },
          display: (ctx) => ctx.dataset.data[ctx.dataIndex] !== 0,
          formatter: formatDataLabel,
        },
      },
      scales: {
        x: { stacked },
        y: { stacked, beginAtZero: true },
      },
    },
  };
}

function buildLineChart(runResult) {
  const { labels, series } = buildSeries(runResult);

  const datasets = series.map((s, i) => ({
    label: s.label,
    data: s.data,
    borderColor: colorAt(i),
    backgroundColor: `${colorAt(i)}33`,
    tension: 0.3,
    fill: false,
  }));

  return {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Xem comment trong buildCategoryChart — điểm cao nhất chạm max tự động
      // của trục y sẽ bị khuất label align:'top' nếu không chừa padding.
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: series.length > 1 },
        datalabels: {
          align: 'top',
          color: (ctx) => colorAt(ctx.datasetIndex),
          font: { size: 10 },
          formatter: formatDataLabel,
        },
      },
      scales: { y: { beginAtZero: true } },
    },
  };
}

// Area: về bản chất là line chart nhưng tô nền dưới đường -> dùng chung
// buildSeries, chỉ khác fill/backgroundColor đậm hơn line thường.
function buildAreaChart(runResult) {
  const { labels, series } = buildSeries(runResult);

  const datasets = series.map((s, i) => ({
    label: s.label,
    data: s.data,
    borderColor: colorAt(i),
    backgroundColor: `${colorAt(i)}4d`,
    tension: 0.3,
    fill: true,
  }));

  return {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Xem comment trong buildCategoryChart — điểm cao nhất chạm max tự động
      // của trục y sẽ bị khuất label align:'top' nếu không chừa padding.
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: series.length > 1 },
        datalabels: {
          align: 'top',
          color: (ctx) => colorAt(ctx.datasetIndex),
          font: { size: 10 },
          formatter: formatDataLabel,
        },
      },
      scales: { y: { beginAtZero: true } },
    },
  };
}

// Radar: dùng chung buildSeries (labels = trục, series = 1 đường/vùng mỗi
// nhóm). Radar chỉ có 1 trục bán kính dùng chung cho mọi series — nếu các
// cột số có đơn vị/độ lớn khác nhau (vd order_count 1-5 vs revenue hàng
// nghìn), series nhỏ sẽ bị nén sát tâm và không đọc được. Chuẩn hoá mỗi
// series về % so với giá trị lớn nhất của chính nó (0-100) để các hình
// dạng so sánh được bằng mắt; giá trị gốc vẫn hiện trong tooltip.
function buildRadarChart(runResult) {
  const { labels, series } = buildSeries(runResult);
  if (series.length === 0) return null;

  const normalized = series.map((s) => {
    const max = Math.max(...s.data, 0) || 1;
    return { label: s.label, raw: s.data, data: s.data.map((v) => (v / max) * 100) };
  });

  const datasets = normalized.map((s, i) => ({
    label: s.label,
    data: s.data,
    borderColor: colorAt(i),
    backgroundColor: `${colorAt(i)}33`,
    pointBackgroundColor: colorAt(i),
  }));

  return {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: series.length > 1 },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const raw = normalized[ctx.datasetIndex].raw[ctx.dataIndex];
              return `${ctx.dataset.label}: ${raw.toLocaleString('vi-VN')} (${Math.round(ctx.parsed.r)}% so với giá trị lớn nhất)`;
            },
          },
        },
        datalabels: {
          color: (ctx) => colorAt(ctx.datasetIndex),
          font: { size: 10 },
          formatter: (_value, ctx) => formatDataLabel(normalized[ctx.datasetIndex].raw[ctx.dataIndex]),
        },
      },
      scales: {
        r: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } },
      },
    },
  };
}

// Scatter / Bubble cần toạ độ (x, y[, r]) chứ không dùng nhãn trục X rời rạc
// -> lấy thẳng 2 (hoặc 3, với bubble) cột số đầu tiên làm x/y/r. Nếu còn dư
// 1 cột không phải số, dùng nó để tách thành nhiều series (mỗi giá trị
// duy nhất 1 màu) — ví dụ cột "category" phân nhóm các điểm.
function buildXYSeries(runResult, { withRadius }) {
  const { columns, rows } = runResult;
  const numberCols = columns.filter((c) => c.type === 'number');
  const nonNumberCols = columns.filter((c) => c.type !== 'number');

  const xCol = numberCols[0];
  const yCol = numberCols[1];
  const rCol = withRadius ? numberCols[2] : null;
  if (!xCol || !yCol || (withRadius && !rCol)) return null;

  const groupCol = nonNumberCols[0];
  const toPoint = (row) => {
    const point = { x: Number(row[xCol.key]), y: Number(row[yCol.key]) };
    if (withRadius) point.r = Number(row[rCol.key]);
    return point;
  };

  if (!groupCol) {
    return [{ label: yCol.label, data: rows.map(toPoint) }];
  }

  const seriesByGroup = new Map();
  const order = [];
  for (const row of rows) {
    const group = formatLabelValue(row[groupCol.key]);
    if (!seriesByGroup.has(group)) {
      seriesByGroup.set(group, []);
      order.push(group);
    }
    seriesByGroup.get(group).push(toPoint(row));
  }

  return order.map((group) => ({ label: group, data: seriesByGroup.get(group) }));
}

function buildScatterChart(runResult) {
  const series = buildXYSeries(runResult, { withRadius: false });
  if (!series) return null;

  const datasets = series.map((s, i) => ({
    label: s.label,
    data: s.data,
    backgroundColor: colorAt(i),
    borderColor: colorAt(i),
  }));

  return {
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: series.length > 1 }, datalabels: { display: false } },
      scales: { x: { type: 'linear', position: 'bottom' } },
    },
  };
}

const BUBBLE_MIN_PX = 6;
const BUBBLE_MAX_PX = 32;

// Chart.js dùng `r` của mỗi điểm trực tiếp làm bán kính TÍNH BẰNG PIXEL, chứ
// không tự co giãn theo dữ liệu. Cột số thứ 3 (r) thường là doanh thu/số
// lượng ở đơn vị gốc (hàng chục/hàng trăm) — nếu đưa thẳng vào sẽ ra bong
// bóng khổng lồ che kín canvas. Phải quy đổi r về khoảng pixel hợp lý dựa
// trên min/max r thực tế trong toàn bộ dữ liệu.
function scaleBubbleRadius(series) {
  const allR = series.flatMap((s) => s.data.map((p) => p.r));
  const minR = Math.min(...allR);
  const maxR = Math.max(...allR);

  return series.map((s) => ({
    ...s,
    data: s.data.map((p) => ({
      x: p.x,
      y: p.y,
      r: maxR === minR ? (BUBBLE_MIN_PX + BUBBLE_MAX_PX) / 2 : BUBBLE_MIN_PX + ((p.r - minR) / (maxR - minR)) * (BUBBLE_MAX_PX - BUBBLE_MIN_PX),
    })),
  }));
}

function buildBubbleChart(runResult) {
  const rawSeries = buildXYSeries(runResult, { withRadius: true });
  if (!rawSeries) return null;
  const series = scaleBubbleRadius(rawSeries);

  const datasets = series.map((s, i) => ({
    label: s.label,
    data: s.data,
    backgroundColor: `${colorAt(i)}99`,
    borderColor: colorAt(i),
  }));

  return {
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: series.length > 1 }, datalabels: { display: false } },
      scales: { x: { type: 'linear', position: 'bottom' } },
    },
  };
}

// Pie / Doughnut chỉ vẽ được 1 vòng giá trị theo nhãn — nếu dữ liệu có
// nhiều series (group), cộng dồn các series lại theo từng nhãn.
function buildSliceChart(runResult) {
  const { labels, series } = buildSeries(runResult);
  if (series.length === 0) return null;

  const data = labels.map((_, idx) => series.reduce((sum, s) => sum + (s.data[idx] || 0), 0));

  return {
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map((_, i) => colorAt(i)),
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        datalabels: {
          color: '#fff',
          font: { size: 11, weight: 'bold' },
          formatter: formatDataLabel,
        },
      },
    },
  };
}

// Metric: 1 số to duy nhất — lấy giá trị số đầu tiên của dòng đầu tiên.
export function buildMetric(runResult) {
  const { columns, rows } = runResult;
  const valueColumn = columns.find((c) => c.type === 'number') || columns[0];
  const row = rows[0];
  return {
    label: valueColumn?.label,
    value: row ? row[valueColumn?.key] : null,
  };
}

// Trả về { data, options } cho Chart.js, hoặc null nếu chartType không phải
// dạng chart.js (metric / table tự render riêng).
export function buildChartConfig(runResult, chartType) {
  if (!runResult || !runResult.rows || runResult.rows.length === 0) return null;

  switch (chartType) {
    case 'bar':
      return buildCategoryChart(runResult, { stacked: false });
    case 'stacked_bar':
      return buildCategoryChart(runResult, { stacked: true });
    case 'line':
      return buildLineChart(runResult);
    case 'area':
      return buildAreaChart(runResult);
    case 'pie':
    case 'doughnut':
      return buildSliceChart(runResult);
    case 'radar':
      return buildRadarChart(runResult);
    case 'scatter':
      return buildScatterChart(runResult);
    case 'bubble':
      return buildBubbleChart(runResult);
    default:
      return null;
  }
}
