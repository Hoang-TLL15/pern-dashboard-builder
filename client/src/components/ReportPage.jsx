// src/components/ReportPage.jsx
// Render 1 trang report ở kích thước thiết kế cố định (1920x1080), thu/phóng
// bằng CSS transform:scale() theo `displayWidth` do component cha truyền
// vào — dùng chung cho cả canvas nhỏ lúc chỉnh sửa lẫn khung to lúc trình
// chiếu toàn màn hình (xem ReportEditor, nơi quản lý state toàn màn hình và
// điều hướng giữa các trang). react-grid-layout hỗ trợ sẵn prop
// `transformScale` để bù trừ toạ độ chuột theo đúng hệ số scale, nên
// kéo/resize luôn đúng bất kể đang hiển thị to hay nhỏ.
//
// react-grid-layout tự tính chiều cao container theo công thức
// rows*rowHeight + (rows-1)*margin + 2*containerPadding — CỘNG DỒN margin
// giữa mọi hàng, không chỉ riêng ô có widget. rowHeight ở đây được tính
// ngược lại đúng công thức đó (với containerPadding=[0,0]) để 36 hàng luôn
// vừa khít 1080px, không bị `.report-page` clip mất phần dưới.
import { ReactGridLayout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { GRID_COLS, GRID_ROWS } from '../reports/pagination';

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_MARGIN = 8;
const DESIGN_ROW_HEIGHT = (DESIGN_HEIGHT - (GRID_ROWS - 1) * DESIGN_MARGIN) / GRID_ROWS;

export default function ReportPage({
  pageIndex,
  widgets,
  onLayoutChange,
  renderWidget,
  pageRef,
  draggableCancel,
  displayWidth = 1280,
  interactive = true,
}) {
  const scale = displayWidth / DESIGN_WIDTH;
  const displayHeight = (displayWidth * DESIGN_HEIGHT) / DESIGN_WIDTH;

  return (
    // CSS transform:scale() không đổi kích thước layout box, chỉ đổi phần
    // vẽ ra màn hình — phải set width/height thật ở đây (không dựa vào CSS
    // tĩnh) để `.report-page` co đúng theo displayWidth, dùng chung được cho
    // cả canvas nhỏ lúc chỉnh sửa lẫn khung to lúc trình chiếu toàn màn hình.
    <div className="report-page" ref={pageRef} style={{ width: displayWidth, height: displayHeight }}>
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
          isDraggable={interactive}
          isResizable={interactive}
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
  );
}
