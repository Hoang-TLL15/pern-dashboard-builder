// src/components/ReportPage.jsx
// Trang report luôn được layout ở kích thước thiết kế CỐ ĐỊNH (1920x1080,
// cols/rowHeight/margin không đổi) — giống hệt cách grid gốc hoạt động.
// Hiển thị nhỏ lúc chỉnh sửa hay phóng to lúc toàn màn hình chỉ là 1 CSS
// transform:scale() bọc ngoài khung thiết kế đó; react-grid-layout hỗ trợ
// sẵn prop `transformScale` để bù trừ toạ độ chuột theo đúng hệ số scale đó
// (xem react-grid-layout/dist/chunk-QAWP6PEK.js — truyền thẳng vào
// react-draggable/react-resizable), nên kéo/resize luôn đúng bất kể đang
// hiển thị to hay nhỏ, không cần đo lại rowHeight theo container như trước.
//
// react-grid-layout tự tính chiều cao container theo công thức
// rows*rowHeight + (rows-1)*margin + 2*containerPadding (containerPadding
// mặc định = margin nếu không set) — CỘNG DỒN margin giữa mọi hàng, không
// chỉ riêng ô có widget. Nếu chỉ chia đơn giản rowHeight=1080/36, 1 trang
// đầy 36 hàng sẽ cần nhiều hơn 1080px thật (dư margin), bị `.report-page`
// clip mất phần dưới. rowHeight ở đây được tính ngược lại đúng công thức
// đó (với containerPadding=[0,0]) để 36 hàng luôn vừa khít 1080px.
import { useEffect, useRef, useState } from 'react';
import { ReactGridLayout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { GRID_COLS, GRID_ROWS } from '../reports/pagination';

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_MARGIN = 8;
const DESIGN_ROW_HEIGHT = (DESIGN_HEIGHT - (GRID_ROWS - 1) * DESIGN_MARGIN) / GRID_ROWS;
const EDIT_DISPLAY_WIDTH = 1280; // kích thước hiển thị lúc chỉnh sửa — khung cố định, thu nhỏ bằng transform:scale

export default function ReportPage({
  pageIndex,
  widgets,
  onLayoutChange,
  renderWidget,
  pageRef,
  draggableCancel,
}) {
  const wrapperRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenWidth, setFullscreenWidth] = useState(EDIT_DISPLAY_WIDTH);

  useEffect(() => {
    const el = wrapperRef.current;
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === el);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    function updateSize() {
      const designAspect = DESIGN_WIDTH / DESIGN_HEIGHT;
      const screenAspect = window.innerWidth / window.innerHeight;
      const width =
        screenAspect > designAspect ? window.innerHeight * designAspect : window.innerWidth;
      setFullscreenWidth(width);
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [isFullscreen]);

  const displayWidth = isFullscreen ? fullscreenWidth : EDIT_DISPLAY_WIDTH;

  function toggleFullscreen() {
    wrapperRef.current.requestFullscreen();
  }

  const scale = displayWidth / DESIGN_WIDTH;

  return (
    <div className="report-page-outer">
      <div className="report-page-toolbar">
        <button type="button" className="ghost-button" onClick={toggleFullscreen}>
          Toàn màn hình
        </button>
      </div>
      <div
        className={`report-page${isFullscreen ? ' report-page-fullscreen' : ''}`}
        ref={(el) => {
          wrapperRef.current = el;
          pageRef(el);
        }}
      >
        <div
          className="report-page-canvas"
          style={{ width: DESIGN_WIDTH, height: DESIGN_HEIGHT, transform: `scale(${scale})` }}
        >
          <ReactGridLayout
            className="widget-grid"
            layout={widgets.map((w) => ({ i: w.key, ...w.layout }))}
            cols={GRID_COLS}
            rowHeight={DESIGN_ROW_HEIGHT}
            width={DESIGN_WIDTH}
            maxRows={GRID_ROWS}
            isBounded
            isDraggable={!isFullscreen}
            isResizable={!isFullscreen}
            transformScale={scale}
            margin={[DESIGN_MARGIN, DESIGN_MARGIN]}
            containerPadding={[0, 0]}
            compactType="vertical"
            useCSSTransforms={false}
            draggableCancel={draggableCancel}
            onLayoutChange={(newLayout) => onLayoutChange(pageIndex, newLayout)}
          >
            {widgets.map((w) => renderWidget(w))}
          </ReactGridLayout>
        </div>
      </div>
    </div>
  );
}
