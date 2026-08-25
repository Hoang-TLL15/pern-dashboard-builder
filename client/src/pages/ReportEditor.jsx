import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { useAuth } from '../context/AuthContext';
import reportService from '../services/reportService';
import dbConnectionService from '../services/dbConnectionService';
import queryConfigService from '../services/queryConfigService';
import ChartRenderer from '../components/ChartRenderer';
import Spinner from '../components/Spinner';
import WidgetFilterEditor from '../components/WidgetFilterEditor';
import ReportPage from '../components/ReportPage';
import TextWidgetEditor from '../components/TextWidgetEditor';
import { getApplicableChartTypes, pickChartType } from '../charts/chartAdapter';
import { applyFilters } from '../charts/filterRows';
import {
  GRID_ROWS,
  NEW_WIDGET_LAYOUT,
  assignLegacyPages,
  computeAddPlacement,
  groupByPage,
  isLegacyReport,
} from '../reports/pagination';

let widgetKeySeq = 0;
function nextWidgetKey() {
  widgetKeySeq += 1;
  return `w${widgetKeySeq}`;
}

// Đọc cỡ chữ (px) thật của 1 Range để hiển thị lên ô "Cỡ" — giống Word:
// con trỏ (range rỗng) trả về cỡ tại đúng vị trí đó; có bôi đen thì duyệt
// mọi text node nằm trong vùng chọn, nếu tất cả CÙNG 1 cỡ mới trả về cỡ đó,
// khác nhau thì trả về '' (rỗng). Dùng getComputedStyle nên tự tính đúng cả
// chữ chưa từng chỉnh cỡ (kế thừa từ CSS mặc định), không chỉ chữ có
// style="font-size" tường minh.
function getRangeFontSize(range) {
  if (!range) return '';
  if (range.collapsed) {
    const container = range.startContainer;
    const el = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    if (!el) return '';
    return parseInt(getComputedStyle(el).fontSize, 10) || '';
  }
  const sizes = new Set();
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode();
  while (node) {
    if (node.textContent.trim() !== '' && range.intersectsNode(node)) {
      sizes.add(getComputedStyle(node.parentElement).fontSize);
    }
    node = walker.nextNode();
  }
  if (sizes.size !== 1) return '';
  return parseInt([...sizes][0], 10) || '';
}

// Marker của bullet (•) lấy cỡ chữ từ chính thẻ <li>, không tự kế thừa từ
// span lồng bên trong nó — nếu không set thêm, bullet luôn giữ cỡ mặc định
// dù chữ bên trong đã to lên, BẤT KỂ thứ tự thao tác (chỉnh cỡ trước rồi
// mới bấm List, hay bấm List trước rồi mới chỉnh cỡ). Nên không gắn cố
// định vào 1 chỗ gọi — quét lại mọi <li> trong `root`, set cỡ theo cỡ LỚN
// NHẤT đang có trong nội dung của chính nó, gọi lại sau cả 2 thao tác.
function syncListItemFontSizes(root) {
  root.querySelectorAll('li').forEach((li) => {
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    let max = 0;
    let node = walker.nextNode();
    while (node) {
      if (node.textContent.trim() !== '') {
        const size = parseInt(getComputedStyle(node.parentElement).fontSize, 10) || 0;
        if (size > max) max = size;
      }
      node = walker.nextNode();
    }
    if (max > 0) li.style.fontSize = `${max}px`;
  });
}

export default function ReportEditor() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [widgets, setWidgets] = useState([]); // { key, queryConfigId, chartType, runResult, filters, layout: {page,x,y,w,h,minW,minH} }
  const [loading, setLoading] = useState(isEditing);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [openFilterKeys, setOpenFilterKeys] = useState(() => new Set());
  const [saveError, setSaveError] = useState('');

  const [dbConnections, setDbConnections] = useState([]);
  const [pickerDbConnectionId, setPickerDbConnectionId] = useState('');
  const [pickerQueryConfigs, setPickerQueryConfigs] = useState([]);
  const [pickerQueryConfigId, setPickerQueryConfigId] = useState('');
  const [pickerPreview, setPickerPreview] = useState(null);
  const [pickerChartType, setPickerChartType] = useState('bar');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [presentPageIndex, setPresentPageIndex] = useState(null); // null = không trình chiếu
  const [presentDisplayWidth, setPresentDisplayWidth] = useState(1280);

  const pageRefs = useRef([]); // DOM node của từng trang, dùng để xuất PDF theo từng trang
  const presentRef = useRef(null);

  // Widget chữ đang được chọn/sửa gần nhất — toolbar định dạng dùng chung
  // (không nằm trong từng widget) tác động vào đây. Dùng ref (không phải
  // state) cho chính node/range vì không cần re-render khi nó đổi; chỉ có
  // "đã từng active hay chưa" mới cần state để bật/tắt toolbar.
  const activeTextEditorRef = useRef({ node: null, range: null });
  const [hasActiveTextEditor, setHasActiveTextEditor] = useState(false);
  // Cỡ chữ hiển thị trong ô "Cỡ" — phản ánh đúng vùng chọn hiện tại, giống
  // Word: rỗng nếu vùng chọn gồm nhiều cỡ khác nhau. activeFontSizeRef giữ
  // giá trị đã đồng bộ gần nhất để so sánh lúc blur, tránh áp lại 1 giá trị
  // người dùng không hề gõ (chỉ click vào ô rồi click ra).
  const [activeFontSize, setActiveFontSize] = useState('');
  const activeFontSizeRef = useRef('');

  const pages = groupByPage(widgets);
  const isPresenting = presentPageIndex !== null;

  useEffect(() => {
    dbConnectionService.list().then(setDbConnections).catch(() => {});
  }, []);

  // Đồng bộ lại state khi người dùng thoát toàn màn hình bằng phím Esc hoặc
  // nút "X" của trình duyệt.
  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) setPresentPageIndex(null);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Chỉ gọi requestFullscreen khi CHUYỂN từ không trình chiếu -> trình chiếu
  // (không phụ thuộc presentPageIndex đổi qua lại giữa các trang).
  useEffect(() => {
    if (isPresenting && document.fullscreenElement !== presentRef.current) {
      presentRef.current?.requestFullscreen();
    }
  }, [isPresenting]);

  // Khung trình chiếu luôn vừa khít màn hình thật (khác canvas nhỏ cố định
  // lúc chỉnh sửa) — đo lại mỗi khi cửa sổ đổi kích thước trong lúc trình
  // chiếu. An toàn ở đây vì lúc trình chiếu grid không tương tác (interactive
  // =false), không có nguy cơ phá vỡ toán kéo/resize như lúc chỉnh sửa.
  useEffect(() => {
    if (!isPresenting) return;
    function updateSize() {
      const designAspect = 16 / 9;
      const screenAspect = window.innerWidth / window.innerHeight;
      const width =
        screenAspect > designAspect ? window.innerHeight * designAspect : window.innerWidth;
      setPresentDisplayWidth(width);
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [isPresenting]);

  // Điều hướng trang bằng phím mũi tên trong lúc trình chiếu.
  useEffect(() => {
    if (!isPresenting) return;
    function onKeyDown(e) {
      if (e.key === 'ArrowRight') {
        setPresentPageIndex((i) => Math.min(pages.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setPresentPageIndex((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPresenting, pages.length]);

  function handlePresent() {
    if (widgets.length === 0) return;
    setPresentPageIndex(0);
  }

  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const report = await reportService.getById(id);
        const chartIndices = report.widgets
          .map((w, i) => ((w.widgetType ?? 'chart') === 'chart' ? i : -1))
          .filter((i) => i !== -1);
        const chartResults =
          chartIndices.length > 0
            ? await queryConfigService.runMany(chartIndices.map((i) => report.widgets[i].queryConfigId))
            : [];
        const resultByIndex = new Map(chartIndices.map((origIdx, j) => [origIdx, chartResults[j]]));
        if (cancelled) return;
        setName(report.name);
        setDescription(report.description || '');
        const legacy = isLegacyReport(report);
        const loaded = report.widgets.map((w, i) => {
          const widgetType = w.widgetType ?? 'chart';
          if (widgetType === 'text') {
            return {
              key: nextWidgetKey(),
              widgetType: 'text',
              text: w.chartConfig?.text || '',
              layout: w.chartConfig?.layout,
            };
          }
          const result = resultByIndex.get(i);
          return {
            key: nextWidgetKey(),
            widgetType: 'chart',
            queryConfigId: w.queryConfigId,
            chartType: pickChartType(result, w.chartType),
            runResult: result,
            filters: w.chartConfig?.filters || [],
            layout: w.chartConfig?.layout,
          };
        });
        setWidgets(legacy ? assignLegacyPages(loaded) : loaded);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err.response?.data?.error || 'Không tải được report');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, isEditing]);

  function handlePickerDbConnectionChange(dbConnectionId) {
    setPickerDbConnectionId(dbConnectionId);
    setPickerQueryConfigId('');
    setPickerPreview(null);
    setPickerError('');
    setPickerQueryConfigs([]);
    if (!dbConnectionId) return;
    queryConfigService
      .listByDbConnectionId(dbConnectionId)
      .then(setPickerQueryConfigs)
      .catch((err) => setPickerError(err.response?.data?.error || 'Không tải được danh sách query'));
  }

  async function handlePickerPreview() {
    if (!pickerQueryConfigId) return;
    setPickerLoading(true);
    setPickerError('');
    setPickerPreview(null);
    try {
      const result = await queryConfigService.run(pickerQueryConfigId);
      setPickerPreview(result);
      setPickerChartType(pickChartType(result, result.suggestedChartType));
    } catch (err) {
      setPickerError(err.response?.data?.error || 'Không chạy được query');
    } finally {
      setPickerLoading(false);
    }
  }

  function handleAddWidget() {
    if (!pickerPreview) return;
    const { page, y } = computeAddPlacement(groupByPage(widgets));
    setWidgets((prev) => [
      ...prev,
      {
        key: nextWidgetKey(),
        queryConfigId: Number(pickerQueryConfigId),
        chartType: pickerChartType,
        runResult: pickerPreview,
        filters: [],
        layout: { page, x: 0, y, ...NEW_WIDGET_LAYOUT },
      },
    ]);
    setPickerDbConnectionId('');
    setPickerQueryConfigs([]);
    setPickerQueryConfigId('');
    setPickerPreview(null);
  }

  function handleAddTextWidget() {
    const { page, y } = computeAddPlacement(groupByPage(widgets));
    setWidgets((prev) => [
      ...prev,
      {
        key: nextWidgetKey(),
        widgetType: 'text',
        text: '',
        layout: { page, x: 0, y, ...NEW_WIDGET_LAYOUT },
      },
    ]);
  }

  function handleWidgetTextChange(key, html) {
    setWidgets((prev) => prev.map((w) => (w.key === key ? { ...w, text: html } : w)));
  }

  function handleTextWidgetActivate(node, range) {
    activeTextEditorRef.current = { node, range };
    setHasActiveTextEditor(true);
    const size = getRangeFontSize(range);
    activeFontSizeRef.current = size;
    setActiveFontSize(size);
  }

  // Khôi phục đúng con trỏ/vùng chọn của widget chữ đang active trước khi
  // gọi execCommand — toolbar giờ nằm ngoài widget nên bấm nút luôn làm
  // widget mất focus, phải tự set lại selection cho execCommand tác động
  // đúng chỗ.
  function execOnActiveTextWidget(command, value) {
    const { node, range } = activeTextEditorRef.current;
    if (!node) return;
    node.focus();
    if (range) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    // styleWithCSS là toggle chung của cả document — chỉ bật cho foreColor
    // (để ra <span style="color:...">, khớp sanitizer) — bật chung cho mọi
    // command sẽ khiến bold/italic/underline ra <span style="font-weight:...">
    // thay vì <b>/<i>/<u>, không khớp allowlist và bị sanitizer strip mất.
    document.execCommand('styleWithCSS', false, command === 'foreColor');
    document.execCommand(command, false, value);

    // Bấm "• List" SAU KHI chữ đã có cỡ riêng: <li> vừa tạo ra không tự
    // nhận cỡ chữ của nội dung bên trong — đồng bộ lại ngay.
    if (command === 'insertUnorderedList') syncListItemFontSizes(node);
  }

  // execCommand('fontSize') chỉ hỗ trợ 7 mức cố định, không ra đúng số px —
  // tự bọc vùng chọn trong 1 <span style="font-size:...px"> bằng Range API
  // gốc của trình duyệt thay vì execCommand.
  function applyFontSizeToActiveTextWidget(px) {
    const { node, range } = activeTextEditorRef.current;
    if (!node || !range) return;
    node.focus();
    const span = document.createElement('span');
    span.style.fontSize = `${px}px`;

    if (range.collapsed) {
      // Chưa bôi đen gì (chỉ có con trỏ) — bold/italic/underline/color đi
      // qua execCommand nên trình duyệt tự áp dụng cho chữ gõ TIẾP THEO dù
      // chưa chọn gì; font-size không đi qua execCommand nên phải tự dựng 1
      // span rỗng (chứa 1 zero-width space để có chỗ đặt con trỏ VÀO
      // TRONG, span thật sự rỗng thì trình duyệt không cho đặt con trỏ bên
      // trong) rồi đặt con trỏ vào đó — chữ gõ tiếp theo sẽ rơi vào trong
      // span này, tự nhận đúng cỡ.
      span.appendChild(document.createTextNode('​'));
      range.insertNode(span);
      const caretRange = document.createRange();
      caretRange.setStart(span.firstChild, 1);
      caretRange.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(caretRange);
    } else {
      const extracted = range.extractContents();
      // Nếu vùng chọn đang có nhiều cỡ chữ khác nhau (do từng chỉnh riêng
      // lẻ trước đó), các span/li lồng bên trong VẪN giữ font-size riêng
      // của chúng — font-size của span mới bọc ngoài không đè được lên vì
      // 1 phần tử luôn ưu tiên font-size trên chính nó hơn là kế thừa từ
      // cha. Phải xoá font-size khỏi mọi phần tử lồng bên trong trước, để
      // toàn bộ vùng chọn thật sự về cùng 1 cỡ mới duy nhất.
      const walker = document.createTreeWalker(extracted, NodeFilter.SHOW_ELEMENT);
      let el = walker.nextNode();
      while (el) {
        el.style.removeProperty('font-size');
        el = walker.nextNode();
      }
      span.appendChild(extracted);
      range.insertNode(span);
      window.getSelection().removeAllRanges();
    }

    syncListItemFontSizes(node);
  }

  function toggleFilters(key) {
    setOpenFilterKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleRemoveWidget(key) {
    setWidgets((prev) => prev.filter((w) => w.key !== key));
  }

  function handleWidgetChartTypeChange(key, chartType) {
    setWidgets((prev) => prev.map((w) => (w.key === key ? { ...w, chartType } : w)));
  }

  function handleWidgetFiltersChange(key, filters) {
    setWidgets((prev) => prev.map((w) => (w.key === key ? { ...w, filters } : w)));
  }

  // Chuyển widget sang trang trước/sau (direction = -1 hoặc +1). Đặt y:
  // Infinity để tự xếp xuống cuối trang đích, giống cơ chế thêm widget mới.
  // Nút "sang trang sau" ở widget cuối cùng của trang cuối cùng sẽ tạo trang
  // mới (page = số trang hiện có), vì pages được suy ra từ max(page)+1.
  function handleMovePage(key, direction) {
    setWidgets((prev) =>
      prev.map((w) =>
        w.key === key
          ? { ...w, layout: { ...w.layout, page: w.layout.page + direction, y: Infinity } }
          : w
      )
    );
  }

  // jsPDF's built-in fonts (Helvetica/Times) chỉ có bảng WinAnsi/Latin-1,
  // không có các ký tự có dấu tiếng Việt (ọ, ụ, ẩ...) nên doc.text() ra chữ
  // lỗi font. Vẽ tiêu đề lên <canvas> rồi nhúng như ảnh thay vì gọi
  // doc.text() — canvas dùng font hệ thống của trình duyệt, hỗ trợ Unicode
  // đầy đủ (giống cách chart tự vẽ nhãn tiếng Việt vẫn đúng).
  function titleImage(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontPx = 28;
    ctx.font = `bold ${fontPx}px Arial, sans-serif`;
    canvas.width = Math.ceil(ctx.measureText(text).width) + 4;
    canvas.height = fontPx + 10;
    ctx.font = `bold ${fontPx}px Arial, sans-serif`; // resize canvas reset context, phải set lại
    ctx.fillStyle = '#1f2933';
    ctx.textBaseline = 'top';
    ctx.fillText(text, 2, 2);
    return canvas;
  }

  // Mỗi trang report đã đúng tỉ lệ 16:9 cố định (xem ReportPage) nên không
  // cần thuật toán cắt lát pixel như trước — chụp riêng từng trang rồi mỗi
  // ảnh thành đúng 1 trang PDF landscape.
  async function handleExportPdf() {
    if (widgets.length === 0) return;
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;

      for (let i = 0; i < pageRefs.current.length; i += 1) {
        const pageEl = pageRefs.current[i];
        if (!pageEl) continue;

        const canvas = await html2canvas(pageEl, {
          backgroundColor: '#ffffff',
          scale: 2,
          // Report xuất ra chỉ nên có nội dung, không có control chỉnh sửa
          // (dropdown loại chart, nút +/Xoá/↑/↓, panel điều kiện lọc).
          ignoreElements: (el) =>
            el.classList?.contains('widget-card-controls') ||
            el.classList?.contains('widget-filter-editor'),
        });

        if (i > 0) doc.addPage(undefined, 'landscape');

        let contentY = margin;
        if (i === 0) {
          const titleHeight = 8;
          const title = titleImage(name || 'report');
          const titleWidth = (title.width / title.height) * titleHeight;
          doc.addImage(title.toDataURL('image/png'), 'PNG', margin, margin, titleWidth, titleHeight);
          contentY = margin + titleHeight + 4;
        }

        const contentWidth = pageWidth - margin * 2;
        const contentHeight = pageHeight - contentY - margin;
        const imageAspect = canvas.width / canvas.height;
        const boxAspect = contentWidth / contentHeight;
        const drawWidth = imageAspect > boxAspect ? contentWidth : contentHeight * imageAspect;
        const drawHeight = imageAspect > boxAspect ? contentWidth / imageAspect : contentHeight;

        doc.addImage(canvas.toDataURL('image/png'), 'PNG', margin, contentY, drawWidth, drawHeight);
      }

      doc.save(`${name || 'report'}.pdf`);
    } finally {
      setExporting(false);
    }
  }

  // Guard so sánh giá trị trước khi setWidgets — react-grid-layout gọi
  // onLayoutChange cả lúc mount lẫn sau compact; nếu luôn tạo object layout
  // mới cho mọi widget thì mỗi render lại đổi reference của prop `layout`,
  // khiến thư viện tưởng layout đổi và gọi lại onLayoutChange -> vòng lặp
  // render vô hạn. Trả về đúng `prev` (cùng reference) khi không có gì đổi
  // để React bỏ qua re-render. Chỉ xét widget thuộc đúng `pageIndex` vừa
  // đổi — mỗi trang có instance grid + onLayoutChange riêng.
  //
  // isBounded/maxRows chỉ chặn widget đang được kéo/resize trực tiếp, không
  // chặn các widget khác bị compactType="vertical" dồn xuống vượt đáy trang
  // như hệ quả phụ. Widget nào rơi vào tình huống đó (y+h vượt GRID_ROWS)
  // được tự chuyển sang đầu trang kế (y: Infinity, giống nút ↓) thay vì bị
  // overflow:hidden của trang nuốt mất khỏi tầm nhìn — nếu trang kế cũng đầy,
  // việc thêm widget vào đó lại tự kích hoạt onLayoutChange của trang kế,
  // nên tự dồn tiếp sang trang sau nữa mà không cần đệ quy thủ công.
  function handleGridLayoutChange(pageIndex, newLayout) {
    setWidgets((prev) => {
      let changed = false;
      const next = prev.map((w) => {
        if (w.layout.page !== pageIndex) return w;
        const item = newLayout.find((l) => l.i === w.key);
        if (!item) return w;
        const overflowsPage = item.y + item.h > GRID_ROWS;
        const same =
          !overflowsPage &&
          w.layout.x === item.x &&
          w.layout.y === item.y &&
          w.layout.w === item.w &&
          w.layout.h === item.h;
        if (same) return w;
        changed = true;
        return {
          ...w,
          layout: overflowsPage
            ? { ...w.layout, page: pageIndex + 1, y: Infinity }
            : { ...w.layout, x: item.x, y: item.y, w: item.w, h: item.h, minW: item.minW, minH: item.minH },
        };
      });
      return changed ? next : prev;
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    const payload = {
      name,
      description,
      widgets: widgets.map((w) => {
        const widgetType = w.widgetType ?? 'chart';
        if (widgetType === 'text') {
          return { widgetType: 'text', chartConfig: { text: w.text, layout: w.layout } };
        }
        return {
          queryConfigId: w.queryConfigId,
          chartType: w.chartType,
          chartConfig: { filters: w.filters, layout: w.layout },
        };
      }),
    };
    try {
      if (isEditing) {
        await reportService.update(id, payload);
      } else {
        await reportService.create(payload);
      }
      navigate('/reports');
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Không lưu được report');
    } finally {
      setSaving(false);
    }
  }

  function renderWidgetCard(w, { hideControls = false } = {}) {
    const widgetType = w.widgetType ?? 'chart';
    return (
      <div className={widgetType === 'text' ? 'widget-card widget-card-text' : 'widget-card'} key={w.key}>
        <div className="query-result-header">
          {widgetType === 'chart' && <h3 className="section-title">{w.runResult.name}</h3>}
          {!hideControls && (
          <div className="widget-card-controls">
            <details className="widget-menu">
              <summary className="ghost-button" title="Tuỳ chọn khác">
                ⋯
              </summary>
              <div className="widget-menu-items">
                {widgetType === 'chart' && (
                  <select
                    className="chart-type-select"
                    value={w.chartType}
                    onChange={(e) => {
                      e.target.closest('details').removeAttribute('open');
                      handleWidgetChartTypeChange(w.key, e.target.value);
                    }}
                  >
                    {getApplicableChartTypes(w.runResult).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  disabled={w.layout.page === 0}
                  onClick={(e) => {
                    e.currentTarget.closest('details').removeAttribute('open');
                    handleMovePage(w.key, -1);
                  }}
                >
                  ↑ Chuyển lên trang trước
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest('details').removeAttribute('open');
                    handleMovePage(w.key, 1);
                  }}
                >
                  ↓ Chuyển xuống trang sau
                </button>
                {widgetType === 'chart' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.closest('details').removeAttribute('open');
                      toggleFilters(w.key);
                    }}
                  >
                    {openFilterKeys.has(w.key) ? '✕ Ẩn điều kiện lọc' : '+ Điều kiện lọc'}
                  </button>
                )}
                <button
                  type="button"
                  className="widget-menu-danger"
                  onClick={(e) => {
                    e.currentTarget.closest('details').removeAttribute('open');
                    handleRemoveWidget(w.key);
                  }}
                >
                  Xoá
                </button>
              </div>
            </details>
          </div>
          )}
        </div>
        {widgetType === 'chart' && !hideControls && openFilterKeys.has(w.key) && (
          <WidgetFilterEditor
            columns={w.runResult.columns}
            rows={w.runResult.rows}
            filters={w.filters}
            onChange={(filters) => handleWidgetFiltersChange(w.key, filters)}
          />
        )}
        {widgetType === 'chart' ? (
          <ChartRenderer runResult={applyFilters(w.runResult, w.filters)} chartType={w.chartType} />
        ) : (
          <TextWidgetEditor
            html={w.text}
            editable={!hideControls}
            onChange={(html) => handleWidgetTextChange(w.key, html)}
            onActivate={handleTextWidgetActivate}
          />
        )}
      </div>
    );
  }

  return (
    <div className="placeholder-page">
      <header className="placeholder-header">
        <span className="auth-eyebrow">Dashboard Builder</span>
        <nav className="top-nav">
          <Link className="top-nav-link" to="/reports">
            Reports
          </Link>
          <Link className="top-nav-link" to="/data-sources">
            Nguồn dữ liệu
          </Link>
          <button className="ghost-button" onClick={logout}>
            Đăng xuất ({user?.username})
          </button>
        </nav>
      </header>

      <Link className="back-link" to="/reports">
        &larr; Quay lại danh sách report
      </Link>

      {loading && <Spinner label="Đang tải..." />}
      {loadError && <p className="form-message error">{loadError}</p>}

      {!loading && !loadError && (
        <>
          <div className="detail-card-wrap">
            <div className="detail-card report-meta-form">
              <div className="field">
                <label htmlFor="report-name">Tên report</label>
                <input
                  id="report-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="report-description">Mô tả</label>
                <input
                  id="report-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="widget-picker">
            <h2 className="section-title">Thêm chart</h2>
            <div className="widget-picker-row">
              <select
                className="chart-type-select"
                value={pickerDbConnectionId}
                onChange={(e) => handlePickerDbConnectionChange(e.target.value)}
              >
                <option value="">Chọn nguồn dữ liệu…</option>
                {dbConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                className="chart-type-select"
                value={pickerQueryConfigId}
                disabled={!pickerDbConnectionId}
                onChange={(e) => setPickerQueryConfigId(e.target.value)}
              >
                <option value="">Chọn query…</option>
                {pickerQueryConfigs.map((qc) => (
                  <option key={qc.id} value={qc.id}>
                    {qc.name}
                  </option>
                ))}
              </select>

              <button
                className="ghost-button"
                disabled={!pickerQueryConfigId || pickerLoading}
                onClick={handlePickerPreview}
              >
                {pickerLoading ? 'Đang chạy...' : 'Xem trước'}
              </button>
            </div>

            {pickerError && <p className="form-message error">{pickerError}</p>}

            {pickerPreview && (
              <div className="widget-picker-preview">
                <div className="query-result-header">
                  <h3 className="section-title">{pickerPreview.name}</h3>
                  <select
                    className="chart-type-select"
                    value={pickerChartType}
                    onChange={(e) => setPickerChartType(e.target.value)}
                  >
                    {getApplicableChartTypes(pickerPreview).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <pre className="query-sql-block">
                  <code>{pickerPreview.query}</code>
                </pre>
                <ChartRenderer runResult={pickerPreview} chartType={pickerChartType} />
                <button className="primary-button" onClick={handleAddWidget}>
                  Thêm vào report
                </button>
              </div>
            )}
          </div>

          <div className="text-widget-toolbar-row">
            <button type="button" className="ghost-button" onClick={handleAddTextWidget}>
              + Thêm widget chữ
            </button>
            <div className="text-widget-global-toolbar">
              <button
                type="button"
                disabled={!hasActiveTextEditor}
                onClick={() => execOnActiveTextWidget('bold')}
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                disabled={!hasActiveTextEditor}
                onClick={() => execOnActiveTextWidget('italic')}
              >
                <em>I</em>
              </button>
              <button
                type="button"
                disabled={!hasActiveTextEditor}
                onClick={() => execOnActiveTextWidget('underline')}
              >
                <u>U</u>
              </button>
              <button
                type="button"
                disabled={!hasActiveTextEditor}
                onClick={() => execOnActiveTextWidget('insertUnorderedList')}
              >
                •
              </button>
              <input
                type="number"
                className="text-widget-size-input"
                title="Cỡ chữ (px) — gõ số tuỳ ý hoặc chọn từ danh sách"
                placeholder="Cỡ"
                list="text-widget-size-list"
                min="6"
                max="300"
                value={activeFontSize}
                disabled={!hasActiveTextEditor}
                onChange={(e) => setActiveFontSize(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const val = e.target.value;
                  if (val && String(val) !== String(activeFontSizeRef.current)) {
                    applyFontSizeToActiveTextWidget(val);
                    activeFontSizeRef.current = val;
                  }
                }}
              />
              <datalist id="text-widget-size-list">
                {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96].map(
                  (size) => (
                    <option key={size} value={size} />
                  )
                )}
              </datalist>
              <input
                type="color"
                title="Màu chữ"
                disabled={!hasActiveTextEditor}
                onChange={(e) => execOnActiveTextWidget('foreColor', e.target.value)}
              />
              <button
                type="button"
                disabled={!hasActiveTextEditor}
                onClick={() => execOnActiveTextWidget('justifyLeft')}
              >
                Trái
              </button>
              <button
                type="button"
                disabled={!hasActiveTextEditor}
                onClick={() => execOnActiveTextWidget('justifyCenter')}
              >
                Giữa
              </button>
              <button
                type="button"
                disabled={!hasActiveTextEditor}
                onClick={() => execOnActiveTextWidget('justifyRight')}
              >
                Phải
              </button>
              <button
                type="button"
                disabled={!hasActiveTextEditor}
                onClick={() => execOnActiveTextWidget('justifyFull')}
              >
                Đều
              </button>
            </div>
          </div>

          <div className="report-pages-toolbar">
            <button type="button" className="ghost-button" disabled={widgets.length === 0} onClick={handlePresent}>
              Toàn màn hình
            </button>
          </div>

          <div>
            {pages.map((pageWidgets, pageIndex) => (
              <div className="report-page-list-item" key={pageIndex}>
                <ReportPage
                  pageIndex={pageIndex}
                  widgets={pageWidgets}
                  onLayoutChange={handleGridLayoutChange}
                  pageRef={(el) => {
                    pageRefs.current[pageIndex] = el;
                  }}
                  draggableCancel=".chart-type-select, .ghost-button, .primary-button, input, textarea, select, button, .text-widget-content"
                  renderWidget={renderWidgetCard}
                />
              </div>
            ))}
          </div>

          {isPresenting && (
            <div className="present-overlay" ref={presentRef}>
              <div className="present-toolbar">
                <span className="present-page-indicator">
                  Trang {presentPageIndex + 1}/{pages.length}
                </span>
              </div>
              <div className="present-stage">
                <ReportPage
                  pageIndex={presentPageIndex}
                  widgets={pages[presentPageIndex]}
                  onLayoutChange={() => {}}
                  pageRef={() => {}}
                  draggableCancel=""
                  displayWidth={presentDisplayWidth}
                  interactive={false}
                  renderWidget={(w) => renderWidgetCard(w, { hideControls: true })}
                />
              </div>
            </div>
          )}

          {saveError && <p className="form-message error">{saveError}</p>}

          <button
            className="ghost-button"
            disabled={exporting || widgets.length === 0}
            onClick={handleExportPdf}
          >
            {exporting ? 'Đang xuất...' : 'Xuất PDF'}
          </button>
          <button
            className="primary-button"
            disabled={saving || !name.trim() || widgets.length === 0}
            onClick={handleSave}
          >
            {saving ? 'Đang lưu...' : 'Lưu report'}
          </button>
        </>
      )}
    </div>
  );
}
