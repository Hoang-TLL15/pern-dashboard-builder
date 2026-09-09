# PERN Dashboard Builder

Ứng dụng PERN-stack (Postgres, Express, React, Node) để người dùng tự tạo **báo cáo dashboard nhiều trang, kéo-thả** kiểu Power BI: nhiều trang cố định 16:9, mỗi trang là 1 lưới đặt/di chuyển/resize các chart widget, mỗi widget gắn 1 nguồn dữ liệu + 1 query.

## Mục tiêu

- **User không viết SQL tự do** — chỉ chọn trong danh sách query đã duyệt sẵn (`query_configs`) cho từng `db_connection`. Đổi lại backend không cần biết schema của data source.
- **Report = layout, không lưu dữ liệu.** Chỉ lưu: widget nào, dùng query nào, chart type/cấu hình gì, đặt ở đâu. Mở lại report → chạy lại toàn bộ query để lấy số liệu mới nhất.
- Nhiều trang / report, mỗi trang lưới 12×36 (`react-grid-layout`), widget tràn đáy tự dồn sang trang kế.
- Xuất PDF mỗi trang thành 1 trang landscape.

## Kiến trúc

### Hai database tách biệt

- **Meta DB** (`dashboard_builder_meta`) — config của app: user, db_connection, query_config, report, report_widget, query_cache_entries. Truy cập qua Prisma singleton (`server/src/config/prisma.js`), không có `pg` pool riêng.
- **Data Source DB** — CSDL bên ngoài, backend không biết schema, chỉ chạy hộ SQL đã duyệt (`query_configs.query`) và trả `{ columns, rows }` kèm kiểu cột.

### Driver layer (`server/src/db/`)

`db_connections.db_type` (`postgres` | `mssql` | `mysql`) chọn driver trong `db/drivers/`, tất cả cùng interface (`createPool`, `runQuery` → `{ columns, rows }`, `resolveColumnType` → `number/date/string/boolean/json`, `listSchema`/`listForeignKeys`). `dataSourcePool.js` cache 1 pool / `db_connection_id` (TTL 10 phút idle). Thêm loại DB = thêm 1 file driver + đăng ký.

### Backend layering (`server/src/`)

Phân lớp 1 chiều, bắt buộc: `routes/ → controllers/ → services/ → repositories/ → Prisma | db/drivers`.

- **routes** — khai báo endpoint. Mọi route cần `authMiddleware` trừ `/register`, `/login`, `/api/internal/*` (chặn bằng header `x-internal-secret`).
- **controllers** — đọc `req`, gọi 1 service, trả `res`/`next`. Không logic, không DB.
- **services** — nghiệp vụ; không biết `req`/`res`.
- **repositories** — chỉ truy cập dữ liệu. Chống IDOR bằng cách luôn lọc/ghi kèm `userId` với report/widget.
- Lỗi: service `throw new AppError(msg, status)` → 1 `errorHandler` chuyển thành JSON.
- Env đọc tập trung ở `config/env.js`, nơi khác không đụng `process.env`.

### Frontend layering (`client/src/`)

`pages/ → context/ (React state) → services/ (điều phối + localStorage) → api/ (chỉ HTTP)`.

- **api/** — HTTP thuần qua `apiClient` (axios, tự gắn `Bearer` từ `localStorage`).
- **context/AuthContext** — nơi duy nhất giữ state auth (`useAuth()`); `App.jsx` `ProtectedRoute` chặn khi chưa đăng nhập.
- **charts/chartAdapter.js** — `{ columns, rows }` → Chart.js config, 13 chart type. Đổi chart type / lọc widget tính lại ở client, không gọi API.

## Logic hoạt động

1. **Auth** — JWT (`/register`, `/login`); endpoint khác cần `Bearer`, `authMiddleware` set `req.user`.
2. **Xem trước query** — chọn 1 `query_config` → BE chạy SQL trên pool đã cache → trả `{ columns, rows }` kèm kiểu cột.
3. **Build report** — thêm chart rơi vào cuối trang, hết chỗ mở trang mới. Đổi chart type / lọc = tính lại ở client.
4. **Lưu / mở lại** — Lưu: `PUT /reports/:id` xoá hết widget cũ rồi insert lại (không diff). Mở: `GET /reports/:id` (chỉ config) → `POST /query-configs/run-batch` lấy số liệu mới cho mọi widget song song.
5. **Report-wide filter** — author viết `:param` trong SQL; editor tự dò `:param` từ widget để dựng filter. Áp giá trị → `run-batch { ids, filters }` (bind, không nối chuỗi) + `PATCH /filter-values` để lưu.
6. **Xuất PDF** — `html2canvas` mỗi trang → `jsPDF` landscape; tiêu đề vẽ qua `<canvas>` để giữ dấu tiếng Việt.
7. **Cache biến thể query hot (tuỳ chọn)** — xem dưới.

## Cache biến thể query hot (tuỳ chọn)

**Biến thể** = 1 query_config + 1 bộ giá trị filter. Biến thể hay mở được chạy sẵn theo lịch, lưu kết quả ra **file JSON**; `executeQueryConfig` đọc theo thứ tự **runCache RAM (30s) → file JSON (hạn 1 ngày) → SQL live**. Cache là phụ trợ — RabbitMQ/worker/file hỏng thì vẫn chạy live.

- `query_cache_entries` = sổ xếp hạng (`hit_count`, `last_read_at`, `params`), không chứa `rows`.
- **Worker Python** (`worker/`, Dramatiq) nhận message từ **RabbitMQ** → gọi `POST /api/internal/refresh-cache` (Node chạy SQL) → ghi file. Worker không giữ SQL/driver/credentials.
- **Scheduler** (`node-cron`, `CACHE_SCHEDULER_ENABLED=1`): 3h enqueue top-10 biến thể hot, 3h30 dọn biến thể idle > 14 ngày, CN 4h `hit_count /= 2`.

Chi tiết + sơ đồ: `docs/query-file-cache-queue-design.md`.

## Mô hình dữ liệu (Meta DB)

```
users ──< reports ──< report_widgets >── query_configs >── db_connections
                                              │
                                              └──< query_cache_entries
```

- `db_connections` — kết nối 1 data source (`db_type`, host/port/db/user/password plaintext, prototype-only).
- `query_configs` — 1 SELECT đã duyệt, gắn 1 `db_connection`, có `suggestedChartType`.
- `reports` — metadata (tên, mô tả, `user_id`, `filter_values`/`filter_options` JSONB).
- `report_widgets` — 1 visual: `query_config_id`, `chart_type`, `chart_config` JSONB (filters + layout).
- `query_cache_entries` — 1 dòng / biến thể (`query_config_id` + `params_key`); sổ xếp hạng cho file cache.

## Cài đặt

### Yêu cầu
- Node.js, Postgres (Meta DB + data source mẫu)
- (tuỳ chọn) SQL Server cho data source mẫu HR
- (tuỳ chọn) Docker + Python cho cache biến thể query

### 1. Database

Chạy tay script SQL trong `db/`:
- `db/init_meta.sql` — schema Meta DB, **bắt buộc**
- `db/init_datasource.sql` (Postgres) / `db/init_datasource_mssql_hr.sql` (SQL Server) — data source mẫu, tuỳ chọn

### 2. Server

```bash
cd server && npm install
```

`.env`:
```
PORT=4000
JWT_SECRET=<chuỗi bí mật>
DATABASE_URL=postgresql://<user>:<pass>@<host>:<port>/dashboard_builder_meta

# Cache (tuỳ chọn — xem bước 4)
RABBITMQ_URL=amqp://guest:guest@localhost:5672
INTERNAL_API_SECRET=<bí mật dùng chung với worker>
CACHE_DIR=<đường dẫn tuyệt đối>
CACHE_SCHEDULER_ENABLED=0
```

```bash
npm run dev    # nodemon
npm start
```

### 3. Client

```bash
cd client && npm install
npm run dev      # Vite
npm run build
npm run lint
```

API tại `http://localhost:4000/api`.

### 4. Cache biến thể query (tuỳ chọn)

Bỏ qua thì app vẫn chạy đầy đủ, chỉ không có file cache.

```bash
docker compose up -d rabbitmq          # UI: http://localhost:15672 (guest/guest)

cd worker
python -m venv .venv && .venv\Scripts\activate   # hoặc: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                   # điền INTERNAL_API_SECRET + CACHE_DIR khớp server/.env
dramatiq actors

# server/.env: CACHE_SCHEDULER_ENABLED=1, rồi npm run dev
```

Đẩy thử: `node server/scripts/enqueueRefresh.js <queryConfigId>`. Xem `worker/README.md`.

## Ghi chú

- Không có script test/lint cho server.
- `db_connections` lưu credential plaintext — prototype-only (production: Vault/KMS).
- Comment backend + message lỗi API viết tiếng Việt.
