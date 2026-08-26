// src/reports/pagination.js
// Logic thuần (không phụ thuộc React) để chia widget của 1 report thành các
// trang cố định 1920x1080 (16:9). 36 hàng x rowHeight thiết kế 30px = 1080px.
export const GRID_COLS = 24;
export const GRID_ROWS = 36;
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;
export const DESIGN_MARGIN = 8;
export const DESIGN_ROW_HEIGHT = (DESIGN_HEIGHT - (GRID_ROWS - 1) * DESIGN_MARGIN) / GRID_ROWS;
// Tham số hình học dùng chung cho mọi phép quy đổi pixel<->lưới của
// react-grid-layout (calcXY/calcGridItemPosition, từ 'react-grid-layout/core')
// — 1 nguồn duy nhất để ReportPage (grid thật) và ReportEditor (tính ghost
// preview + toạ độ thả lúc kéo-qua-trang) luôn ra cùng 1 kết quả, không lệch
// pixel do khai báo trùng lặp ở 2 nơi.
export const GRID_POSITION_PARAMS = {
  margin: [DESIGN_MARGIN, DESIGN_MARGIN],
  containerPadding: [0, 0],
  cols: GRID_COLS,
  rowHeight: DESIGN_ROW_HEIGHT,
  maxRows: GRID_ROWS,
  containerWidth: DESIGN_WIDTH,
};
export const NEW_WIDGET_LAYOUT = { w: 12, h: 10, minW: 2, minH: 4 };
// Widget chữ mặc định thấp hơn nhiều so với chart — 1 dòng tiêu đề/kết luận
// không cần cao 10 hàng như chart, để trống nhiều khoảng trắng trên dưới.
// minH cũng hạ theo để có thể kéo nhỏ hơn nữa. h=2 từng bị thử nhưng hụt
// mất 1px chiều cao thật cần cho 1 dòng chữ (clientHeight < scrollHeight,
// đo trực tiếp trên trình duyệt) — h=3 mới đủ khít mà không cắt chữ.
export const NEW_TEXT_WIDGET_LAYOUT = { w: 12, h: 3, minW: 2, minH: 3 };

const LEGACY_WIDGET_LAYOUT = { w: GRID_COLS, h: 10, minW: 3, minH: 4 };

// Report tạo trước khi có tính năng phân trang chưa có field `page` trong
// layout — dùng widget đầu tiên để suy ra report có phải định dạng cũ không.
export function isLegacyReport(report) {
  return report.widgets.length > 0 && report.widgets[0]?.chartConfig?.layout?.page === undefined;
}

// Report cũ dùng 1 lưới liên tục cao vô hạn, chưa có khái niệm trang. Nếu
// tổng chiều cao nội dung (y+h lớn nhất) đã vừa 1 trang (<=36 hàng) — trường
// hợp thực tế phổ biến nhất, kể cả layout tự do nhiều cột — giữ nguyên y hệt
// x/y/w/h đã lưu, chỉ gán page=0. Nếu vượt quá 1 trang: duyệt theo thứ tự y
// tăng dần, widget nào làm tràn trang hiện tại thì cả widget đó (không cắt
// đôi) xuống đầu trang kế, y tịnh tiến về gốc trang mới. Widget hoàn toàn
// chưa có layout (report tạo trước khi có tính năng kéo-thả tự do) được xếp
// nối đuôi dưới mọi widget khác, full-width cao 10 hàng.
export function assignLegacyPages(widgetsInOrder) {
  let cursor = 0;
  const withLayout = widgetsInOrder.map((w) => {
    if (w.layout) {
      cursor = Math.max(cursor, w.layout.y + w.layout.h);
      return w;
    }
    const layout = { x: 0, y: cursor, ...LEGACY_WIDGET_LAYOUT };
    cursor += LEGACY_WIDGET_LAYOUT.h;
    return { ...w, layout };
  });

  const totalHeight = withLayout.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);
  if (totalHeight <= GRID_ROWS) {
    return withLayout.map((w) => ({ ...w, layout: { ...w.layout, page: 0 } }));
  }

  const sortedByY = [...withLayout].sort((a, b) => a.layout.y - b.layout.y);
  let page = 0;
  let pageStartY = 0;
  return sortedByY.map((w) => {
    const { y, h } = w.layout;
    if (y + h - pageStartY > GRID_ROWS) {
      page += 1;
      pageStartY = y;
    }
    return { ...w, layout: { ...w.layout, page, y: y - pageStartY } };
  });
}

// Gom widget theo layout.page thành mảng các trang; luôn trả về ít nhất 1
// trang (rỗng) để report chưa có widget vẫn có khung để thêm vào.
export function groupByPage(widgets) {
  const pageCount = widgets.length === 0 ? 1 : Math.max(...widgets.map((w) => w.layout.page)) + 1;
  return Array.from({ length: pageCount }, (_, i) => widgets.filter((w) => w.layout.page === i));
}

// Tìm trang mà 1 điểm thả chuột (toạ độ viewport) rơi vào, dùng cho việc kéo
// widget từ trang này sang trang khác — pageRects là bounding rect (hoặc
// null nếu ref chưa gắn) của từng trang đang render, theo đúng thứ tự
// pageIndex; loại trừ excludeIndex (trang gốc của widget đang kéo) vì thả lại
// đúng trang cũ không tính là "chuyển trang". Trả về -1 nếu điểm thả không
// rơi vào trang nào khác.
export function findDropTargetPage(pageRects, point, excludeIndex) {
  return pageRects.findIndex(
    (rect, i) =>
      i !== excludeIndex &&
      rect &&
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
  );
}

// Vị trí cho 1 widget mới: thêm vào cuối trang cuối; nếu không đủ chỗ (vượt
// 36 hàng) thì mở trang mới.
export function computeAddPlacement(pages) {
  const lastPageIndex = pages.length - 1;
  const lastPage = pages[lastPageIndex];
  const bottom = lastPage.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);
  if (bottom + NEW_WIDGET_LAYOUT.h > GRID_ROWS) {
    return { page: pages.length, y: 0 };
  }
  return { page: lastPageIndex, y: Infinity };
}
