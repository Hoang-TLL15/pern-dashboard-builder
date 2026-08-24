# PERN Dashboard Builder

Ứng dụng PERN-stack (Postgres, Express, React, Node) cho phép người dùng tự tạo **báo cáo dạng dashboard nhiều trang, kéo-thả layout tự do** — tương tự cách 1 report Power BI được tổ chức: nhiều **trang (page)** cố định tỉ lệ 16:9, mỗi trang là 1 lưới (grid) mà người dùng đặt/di chuyển/resize các **visual (chart widget)** lên đó, mỗi visual gắn với 1 nguồn dữ liệu + 1 câu query.

## Mục tiêu

- **Không cho user viết SQL tự do** — chỉ được chọn trong danh sách query đã cấu hình/duyệt sẵn (`query_configs`) cho từng nguồn dữ liệu (`db_connections`). Đây là điểm khác Power BI (vốn cho tự viết M/DAX) — đổi lại BE không cần hiểu schema của bất kỳ data source nào, chỉ chạy hộ SQL đã duyệt.
- **Report = layout đã lưu, không lưu dữ liệu.** Giống 1 file `.pbix` chỉ lưu định nghĩa visual + tham chiếu dữ liệu, report ở đây chỉ lưu: widget nào, dùng query nào, vẽ bằng chart type/cấu hình gì, đặt ở đâu trên trang nào. Mỗi lần mở lại report, hệ thống chạy lại toàn bộ query để lấy dữ liệu **mới nhất** rồi render theo layout đã lưu — dashboard "sống" chứ không phải ảnh chụp cũ.
- **Nhiều trang trong 1 report**, mỗi trang là lưới 12 cột x 36 hàng (tỉ lệ 1920x1080/16:9), kéo-thả và resize widget tự do bằng `react-grid-layout`, widget tràn đáy trang tự động dồn sang trang kế.
- **Xuất PDF** — mỗi trang report thành 1 trang PDF landscape (dùng cho việc chia sẻ ngoài ứng dụng, không cần đăng nhập).

## Kiến trúc

- **Meta DB** (`dashboard_builder_meta`) — lưu config của app: user, kết nối data source, query config, report, report widget. Truy cập qua Prisma (`server/prisma/schema.prisma`).
- **Data Source DB** — CSDL bên ngoài mà app chạy hộ SQL đã duyệt sẵn (`query_configs.query`), qua driver layer ở `server/src/db/drivers/` (`postgres`, `mssql`, `mysql`). Backend không biết trước schema hay ý nghĩa dữ liệu của các DB này.
- **Backend**: `routes/ → controllers/ → services/ → repositories/ → Prisma / db drivers`.
- **Frontend**: `pages/ → context/ → services/ → api/`.

Chi tiết đầy đủ về layering và driver interface xem [CLAUDE.md](CLAUDE.md). Thiết kế hệ thống gốc (connection pooling, type mapping OID→type chuẩn, mermaid diagram) xem [docs/thiet-ke-he-thong-dashboard-builder.md](docs/thiet-ke-he-thong-dashboard-builder.md).

## Logic hoạt động

### 1. Đăng nhập
JWT-based auth (`/register`, `/login`); mọi endpoint khác yêu cầu `Bearer` token, `authMiddleware` set `req.user = { id, username }`.

### 2. Duyệt nguồn dữ liệu & xem trước query
- Trang **Nguồn dữ liệu** liệt kê các `db_connections` đã cấu hình sẵn, mỗi kết nối có 1 hoặc nhiều `query_configs` (SELECT đã duyệt, kèm `suggestedChartType` gợi ý mặc định).
- Chọn 1 query → "Xem trước" → BE lấy pool đã cache cho `db_connection_id` đó (hoặc mở mới), chạy SQL, dịch kiểu dữ liệu cột (OID Postgres → `number/date/string/boolean/json`) → trả `{ columns, rows }`.

### 3. Build report — trang & widget
- 1 report gồm nhiều **trang**, mỗi trang là lưới 12x36 (`client/src/reports/pagination.js`). Thêm chart mới sẽ tự rơi vào cuối trang hiện tại; hết chỗ thì mở trang mới.
- Mỗi widget = 1 lần chạy query (`columns/rows`) + `chartType` + vị trí/kích thước trên lưới (`layout: {page, x, y, w, h}`). Kéo-thả/resize bằng `react-grid-layout`; widget vượt đáy trang tự chuyển sang đầu trang kế.
- Đổi loại chart hoặc thêm điều kiện lọc (`WidgetFilterEditor`) chỉ tính toán lại ở client (`chartAdapter.js`, `filterRows.js`) — **không gọi lại API**, vì `columns/rows` đã có sẵn trong bộ nhớ.
- Widget có thể chuyển sang trang trước/sau qua menu, hoặc bị xoá.

### 4. Lưu & mở lại report
- **Lưu**: gom toàn bộ `widgets[]` hiện có trên client (mỗi widget: `queryConfigId`, `chartType`, `chartConfig: {filters, layout}`), gửi `POST/PUT /reports`. BE chạy trong 1 transaction: xoá hết `report_widgets` cũ rồi insert lại toàn bộ — đơn giản hơn diff từng widget.
- **Mở lại**: `GET /reports/:id` lấy danh sách widget (chỉ có config, không có `rows`) → gọi song song `GET /query-configs/:id/run` cho từng widget để lấy dữ liệu mới nhất → render lại theo `chartType`/`layout` đã lưu.
- Report tạo trước khi có tính năng phân trang (chưa có `layout.page`) được tự động quy đổi sang trang khi mở lại (`assignLegacyPages`), không cần migrate dữ liệu.

### 5. Chart adapter
`columns/rows` (dạng thô từ query) → Chart.js config, tuỳ theo `chartType`:
| Nhóm chart | Cách map |
|---|---|
| bar, line, radar, pie, doughnut, polarArea | `labels` dùng chung theo index, mỗi field số → 1 dataset |
| scatter | `dataset.data = rows.map(r => ({x, y}))` |
| bubble | `dataset.data = rows.map(r => ({x, y, r}))` |

Vì BE trả `{columns, rows}` thay vì format sẵn của Chart.js, đổi loại chart/trục X-Y không cần round-trip lên server.

### 6. Xuất PDF
Mỗi trang report được chụp bằng `html2canvas` (ẩn control chỉnh sửa như dropdown chart type, nút xoá/di chuyển) rồi nhúng vào 1 trang PDF landscape qua `jsPDF`; tiêu đề report được vẽ qua `<canvas>` để giữ đúng font Unicode tiếng Việt (font mặc định của jsPDF không có dấu).

## Mô hình dữ liệu (Meta DB)

```
users ──< reports ──< report_widgets >── query_configs >── db_connections
```

- `db_connections`: thông tin kết nối tới 1 data source (`db_type`, host/port/database/user/password — plaintext, chỉ dùng cho prototype).
- `query_configs`: 1 câu SELECT đã duyệt sẵn, gắn với 1 `db_connection`, có `suggestedChartType`.
- `reports`: metadata report (tên, mô tả, chủ sở hữu `user_id`).
- `report_widgets`: 1 visual trong report — `query_config_id`, `chart_type`, `chart_config` (jsonb: filters + layout theo trang/lưới).

## Cài đặt

### Yêu cầu
- Node.js
- Postgres (cho Meta DB, và cho data source mẫu)
- (tuỳ chọn) SQL Server nếu muốn chạy data source mẫu HR

### 1. Database

Chạy tay các script SQL trong `db/` trên server tương ứng:

- `db/init_meta.sql` — schema Meta DB, **bắt buộc**.
- `db/init_datasource.sql` — data source mẫu Postgres (AdventureWorks-lite shop data), tuỳ chọn.
- `db/init_datasource_mssql_hr.sql` — data source mẫu SQL Server (HR data), tuỳ chọn.

### 2. Server

```bash
cd server
npm install
```

Tạo file `.env`:

```
PORT=4000
JWT_SECRET=<chuỗi bí mật của bạn>
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/dashboard_builder_meta
```

Chạy:

```bash
npm run dev    # nodemon, auto-reload
npm start      # chạy thường
```

### 3. Client

```bash
cd client
npm install
npm run dev      # Vite dev server
npm run build    # build production
npm run lint     # ESLint
```

Client gọi API tại `http://localhost:4000/api` (xem `client/src/api/client.js`).

## Ghi chú

- Không có script test/lint cho server.
- `db_connections` lưu credential data source dạng plaintext — chỉ dùng cho môi trường prototype (production nên dùng Vault/KMS).
- Comment code backend và message lỗi API viết bằng tiếng Việt.
