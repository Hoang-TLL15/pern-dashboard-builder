-- =========================================================
-- META DB — chứa cấu hình app (mục 4.1)
-- Database: dashboard_builder_meta
-- =========================================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE db_connections (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    db_type VARCHAR(50) NOT NULL DEFAULT 'postgres', -- postgres | mysql | bigquery...
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    database_name VARCHAR(100) NOT NULL,
    db_user VARCHAR(100) NOT NULL,
    db_password VARCHAR(255) NOT NULL, -- prototype: plaintext; production: Vault/KMS
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE query_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    db_connection_id INTEGER NOT NULL REFERENCES db_connections(id),
    query TEXT NOT NULL, -- SELECT ... đã duyệt sẵn, chạy trên Data Source DB
    suggested_chart_type VARCHAR(30) NOT NULL, -- bar | line | pie | doughnut | radar | polarArea | scatter | bubble
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_query_configs_db_connection_id ON query_configs(db_connection_id);

CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    filter_values JSONB NOT NULL DEFAULT '{}', -- giá trị global filter áp dụng lần gần nhất, không phải định nghĩa (paramName tự dò từ SQL, xem sqlParams.js)
    filter_options JSONB NOT NULL DEFAULT '{}', -- ánh xạ { paramName: ["opt1","opt2",...] } — filter nào có list thì render dropdown chọn sẵn thay vì ô text; list do report author tự thêm/xoá (xem docs/parameter-filter.md)
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_user_id ON reports(user_id);
-- DB đã tạo từ trước: chạy tay dòng dưới để thêm cột mới
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS filter_options JSONB NOT NULL DEFAULT '{}';

CREATE TABLE report_widgets (
    id SERIAL PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    widget_type VARCHAR(20) NOT NULL DEFAULT 'chart',
    query_config_id INTEGER REFERENCES query_configs(id),
    chart_type VARCHAR(30),
    chart_config JSONB NOT NULL, -- shape khác nhau tuỳ widget_type/chart_type (mục 6)
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_widgets_report_id ON report_widgets(report_id);

-- db_connections trỏ sang database DATA SOURCE riêng (dashboard_builder_shop)
-- Chạy sau khi đã tạo xong database đó (xem init_datasource.sql)
INSERT INTO db_connections (name, db_type, host, port, database_name, db_user, db_password) VALUES
('Local shop DB', 'postgres', 'localhost', 5432, 'dashboard_builder_shop', 'postgres', '12345');

-- query_configs mẫu — mỗi loại chart mà chartAdapter.js hỗ trợ (CHART_TYPE_OPTIONS)
-- có tối thiểu 1 query cho ra đúng shape dữ liệu (columns/rows) mà adapter cần.
-- db_connection_id = 1 -> 'Local shop DB' (dashboard_builder_shop) ở trên.
INSERT INTO query_configs (name, description, db_connection_id, query, suggested_chart_type) VALUES
(
    'Doanh thu theo sản phẩm',
    'Bar: 1 cột nhãn (product_name) + 1 cột số (revenue)',
    1,
    'SELECT p.product_name, SUM(oi.quantity * oi.unit_price) AS revenue FROM order_items oi JOIN products p ON p.product_id = oi.product_id GROUP BY p.product_name ORDER BY revenue DESC',
    'bar'
),
(
    'Doanh thu theo danh mục và tháng',
    'Stacked bar: cột nhãn (month) + cột nhóm (category) + cột số (revenue) - sẽ được pivot thành nhiều series',
    1,
    'SELECT to_char(o.order_date, ''YYYY-MM'') AS month, p.category, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id JOIN products p ON p.product_id = oi.product_id GROUP BY month, p.category ORDER BY month',
    'stacked_bar'
),
(
    'Doanh thu theo tháng',
    'Line: 1 cột nhãn (month) + 1 cột số (revenue)',
    1,
    'SELECT to_char(o.order_date, ''YYYY-MM'') AS month, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id GROUP BY month ORDER BY month',
    'line'
),
(
    'Doanh thu luỹ kế theo danh mục',
    'Area: cột nhãn (month) + cột nhóm (category) + cột số cộng dồn (cumulative_revenue) -> nhiều đường tô vùng tăng dần theo thời gian, khác line (id 3, chỉ 1 đường không cộng dồn) và khác stacked bar (id 2, cột rời rạc theo tháng không cộng dồn). Dùng lưới đầy đủ month x category (CROSS JOIN) để tháng không phát sinh doanh thu giữ nguyên mức cũ thay vì tụt về 0.',
    1,
    'WITH months AS (SELECT DISTINCT to_char(order_date, ''YYYY-MM'') AS month FROM orders), categories AS (SELECT DISTINCT category FROM products), grid AS (SELECT m.month, c.category FROM months m CROSS JOIN categories c), monthly AS (SELECT to_char(o.order_date, ''YYYY-MM'') AS month, p.category, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id JOIN products p ON p.product_id = oi.product_id GROUP BY month, p.category) SELECT g.month, g.category, SUM(COALESCE(monthly.revenue, 0)) OVER (PARTITION BY g.category ORDER BY g.month) AS cumulative_revenue FROM grid g LEFT JOIN monthly ON monthly.month = g.month AND monthly.category = g.category ORDER BY g.month, g.category',
    'area'
),
(
    'Tỷ trọng doanh thu theo danh mục',
    'Pie: 1 cột nhãn (category) + 1 cột số (revenue)',
    1,
    'SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue FROM order_items oi JOIN products p ON p.product_id = oi.product_id GROUP BY p.category',
    'pie'
),
(
    'Số đơn hàng theo phòng ban',
    'Doughnut: 1 cột nhãn (department) + 1 cột số (order_count)',
    1,
    'SELECT e.department, COUNT(*) AS order_count FROM orders o JOIN employees e ON e.employee_id = o.employee_id GROUP BY e.department',
    'doughnut'
),
(
    'Hiệu suất nhân viên',
    'Radar: 1 cột nhãn (full_name) + nhiều cột số (order_count, revenue) làm các trục',
    1,
    'SELECT e.full_name, COUNT(DISTINCT o.order_id) AS order_count, SUM(oi.quantity * oi.unit_price) AS revenue FROM employees e JOIN orders o ON o.employee_id = e.employee_id JOIN order_items oi ON oi.order_id = o.order_id GROUP BY e.full_name',
    'radar'
),
(
    'Đơn giá và số lượng bán theo sản phẩm',
    'Scatter: 2 cột số (unit_price = x, total_quantity = y) + 1 cột nhóm (category)',
    1,
    'SELECT p.category, p.unit_price, SUM(oi.quantity) AS total_quantity FROM products p JOIN order_items oi ON oi.product_id = p.product_id GROUP BY p.category, p.unit_price, p.product_id',
    'scatter'
),
(
    'Đơn giá, số lượng và số đơn theo sản phẩm',
    'Bubble: 3 cột số (unit_price = x, total_quantity = y, order_count = r) + 1 cột nhóm (category)',
    1,
    'SELECT p.category, p.unit_price, SUM(oi.quantity) AS total_quantity, COUNT(DISTINCT o.order_id) AS order_count FROM products p JOIN order_items oi ON oi.product_id = p.product_id JOIN orders o ON o.order_id = oi.order_id GROUP BY p.category, p.unit_price, p.product_id',
    'bubble'
),
(
    'Tổng doanh thu toàn thời gian',
    'Metric: 1 cột số duy nhất (total_revenue), dùng làm KPI',
    1,
    'SELECT SUM(quantity * unit_price) AS total_revenue FROM order_items',
    'metric'
),
(
    'Danh sách đơn hàng chi tiết',
    'Table: liệt kê đơn hàng kèm khách hàng, nhân viên, ngày đặt, trạng thái',
    1,
    'SELECT o.order_id, c.first_name || '' '' || c.last_name AS customer_name, e.full_name AS employee_name, o.order_date, o.status FROM orders o JOIN customers c ON c.customer_id = o.customer_id JOIN employees e ON e.employee_id = o.employee_id ORDER BY o.order_date',
    'table'
);

-- query_configs có tham số :year (dùng cho global filter — xem sqlParams.js) —
-- cùng dữ liệu shop DB, mỗi query 1 loại chart khác nhau. Dữ liệu seed trải dài
-- 2024-01 -> 2025-03 nên :year hợp lệ là 2024 hoặc 2025.
INSERT INTO query_configs (name, description, db_connection_id, query, suggested_chart_type) VALUES
(
    'Doanh thu theo sản phẩm (theo năm)',
    'Bar có tham số :year — 1 cột nhãn (product_name) + 1 cột số (revenue)',
    1,
    'SELECT p.product_name, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id JOIN products p ON p.product_id = oi.product_id WHERE EXTRACT(YEAR FROM o.order_date) = :year GROUP BY p.product_name ORDER BY revenue DESC',
    'bar'
),
(
    'Doanh thu theo danh mục và tháng (theo năm)',
    'Stacked bar có tham số :year — cột nhãn (month) + cột nhóm (category) + cột số (revenue)',
    1,
    'SELECT to_char(o.order_date, ''YYYY-MM'') AS month, p.category, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id JOIN products p ON p.product_id = oi.product_id WHERE EXTRACT(YEAR FROM o.order_date) = :year GROUP BY month, p.category ORDER BY month',
    'stacked_bar'
),
(
    'Doanh thu theo tháng (theo năm)',
    'Line có tham số :year — 1 cột nhãn (month) + 1 cột số (revenue)',
    1,
    'SELECT to_char(o.order_date, ''YYYY-MM'') AS month, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id WHERE EXTRACT(YEAR FROM o.order_date) = :year GROUP BY month ORDER BY month',
    'line'
),
(
    'Tỷ trọng doanh thu theo danh mục (theo năm)',
    'Pie có tham số :year — 1 cột nhãn (category) + 1 cột số (revenue)',
    1,
    'SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id JOIN products p ON p.product_id = oi.product_id WHERE EXTRACT(YEAR FROM o.order_date) = :year GROUP BY p.category',
    'pie'
),
(
    'Số đơn hàng theo phòng ban (theo năm)',
    'Doughnut có tham số :year — 1 cột nhãn (department) + 1 cột số (order_count)',
    1,
    'SELECT e.department, COUNT(*) AS order_count FROM orders o JOIN employees e ON e.employee_id = o.employee_id WHERE EXTRACT(YEAR FROM o.order_date) = :year GROUP BY e.department',
    'doughnut'
),
(
    'Hiệu suất nhân viên (theo năm)',
    'Radar có tham số :year — 1 cột nhãn (full_name) + nhiều cột số (order_count, revenue) làm các trục',
    1,
    'SELECT e.full_name, COUNT(DISTINCT o.order_id) AS order_count, SUM(oi.quantity * oi.unit_price) AS revenue FROM employees e JOIN orders o ON o.employee_id = e.employee_id JOIN order_items oi ON oi.order_id = o.order_id WHERE EXTRACT(YEAR FROM o.order_date) = :year GROUP BY e.full_name',
    'radar'
),
(
    'Đơn giá và số lượng bán theo sản phẩm (theo năm)',
    'Scatter có tham số :year — 2 cột số (unit_price = x, total_quantity = y) + 1 cột nhóm (category)',
    1,
    'SELECT p.category, p.unit_price, SUM(oi.quantity) AS total_quantity FROM products p JOIN order_items oi ON oi.product_id = p.product_id JOIN orders o ON o.order_id = oi.order_id WHERE EXTRACT(YEAR FROM o.order_date) = :year GROUP BY p.category, p.unit_price, p.product_id',
    'scatter'
),
(
    'Đơn giá, số lượng và số đơn theo sản phẩm (theo năm)',
    'Bubble có tham số :year — 3 cột số (unit_price = x, total_quantity = y, order_count = r) + 1 cột nhóm (category)',
    1,
    'SELECT p.category, p.unit_price, SUM(oi.quantity) AS total_quantity, COUNT(DISTINCT o.order_id) AS order_count FROM products p JOIN order_items oi ON oi.product_id = p.product_id JOIN orders o ON o.order_id = oi.order_id WHERE EXTRACT(YEAR FROM o.order_date) = :year GROUP BY p.category, p.unit_price, p.product_id',
    'bubble'
),
(
    'Tổng doanh thu theo năm',
    'Metric có tham số :year — 1 cột số duy nhất (total_revenue), dùng làm KPI',
    1,
    'SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id WHERE EXTRACT(YEAR FROM o.order_date) = :year',
    'metric'
),
(
    'Danh sách đơn hàng theo năm',
    'Table có tham số :year — liệt kê đơn hàng kèm khách hàng, nhân viên, ngày đặt, trạng thái',
    1,
    'SELECT o.order_id, c.first_name || '' '' || c.last_name AS customer_name, e.full_name AS employee_name, o.order_date, o.status FROM orders o JOIN customers c ON c.customer_id = o.customer_id JOIN employees e ON e.employee_id = o.employee_id WHERE EXTRACT(YEAR FROM o.order_date) = :year ORDER BY o.order_date',
    'table'
);

-- query_configs cho 2 loại chart mới (xem client/src/charts/chartAdapter.js):
-- - combo: shape "wide" 1 cột nhãn + >=2 cột số; cột số đầu -> bar (trục y trái),
--   các cột sau -> line (trục y phụ bên phải).
-- - metric_delta: 1 số to + % thay đổi. Tự nhận 2 dạng: (a) >=2 cột số 1 dòng
--   (cột 1 = hiện tại, cột 2 = kỳ trước); (b) 1 cột số nhiều dòng (dòng cuối vs
--   dòng áp cuối). Dạng (a) đặt alias tiếng Việt để thẻ KPI hiển thị đẹp.
INSERT INTO query_configs (name, description, db_connection_id, query, suggested_chart_type) VALUES
(
    'Doanh thu và số đơn theo tháng',
    'Combo: month (nhãn) + revenue (bar, trục trái) + order_count (line, trục phải) — 2 đơn vị chênh nhau nên tách trục',
    1,
    'SELECT to_char(o.order_date, ''YYYY-MM'') AS month, SUM(oi.quantity * oi.unit_price) AS revenue, COUNT(DISTINCT o.order_id) AS order_count FROM orders o JOIN order_items oi ON oi.order_id = o.order_id GROUP BY month ORDER BY month',
    'combo'
),
(
    'Doanh thu và tăng trưởng theo tháng',
    'Combo: revenue (bar) + growth_pct (line, trục phải) tính bằng LAG so với tháng liền trước',
    1,
    'WITH monthly AS (SELECT to_char(o.order_date, ''YYYY-MM'') AS month, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id GROUP BY month) SELECT month, revenue, ROUND((revenue - LAG(revenue) OVER (ORDER BY month)) / NULLIF(LAG(revenue) OVER (ORDER BY month), 0) * 100, 1) AS growth_pct FROM monthly ORDER BY month',
    'combo'
),
(
    'Doanh thu và giá trị dòng đơn trung bình theo danh mục',
    'Combo: revenue (bar) + avg_line_value (line, trục phải) — cùng đơn vị tiền nhưng chênh độ lớn nên tách trục cho dễ đọc',
    1,
    'SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue, ROUND(AVG(oi.quantity * oi.unit_price), 2) AS avg_line_value FROM order_items oi JOIN products p ON p.product_id = oi.product_id GROUP BY p.category ORDER BY revenue DESC',
    'combo'
),
(
    'Số đơn theo tháng (KPI có so sánh kỳ trước)',
    'Metric+delta dạng chuỗi thời gian: month (nhãn) + order_count (số) nhiều dòng — thẻ KPI lấy dòng cuối làm hiện tại, dòng áp cuối làm kỳ trước',
    1,
    'SELECT to_char(order_date, ''YYYY-MM'') AS month, COUNT(*) AS order_count FROM orders GROUP BY month ORDER BY month',
    'metric_delta'
),
(
    'Doanh thu tháng mới nhất so với tháng liền trước',
    'Metric+delta dạng 2 cột số trên 1 dòng: cột 1 = tháng mới nhất có dữ liệu, cột 2 = tháng liền trước',
    1,
    'WITH monthly AS (SELECT date_trunc(''month'', o.order_date) AS m, SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.order_id GROUP BY m), ranked AS (SELECT revenue, ROW_NUMBER() OVER (ORDER BY m DESC) AS rn FROM monthly) SELECT MAX(CASE WHEN rn = 1 THEN revenue END) AS "Doanh thu tháng này", MAX(CASE WHEN rn = 2 THEN revenue END) AS "Tháng trước" FROM ranked',
    'metric_delta'
),
(
    'Đơn hoàn tất năm nay so với năm trước',
    'Metric+delta dạng 2 cột số: số đơn completed năm 2025 so với 2024',
    1,
    'SELECT SUM(CASE WHEN EXTRACT(YEAR FROM order_date) = 2025 THEN 1 ELSE 0 END) AS "Đơn hoàn tất 2025", SUM(CASE WHEN EXTRACT(YEAR FROM order_date) = 2024 THEN 1 ELSE 0 END) AS "Đơn hoàn tất 2024" FROM orders WHERE status = ''completed''',
    'metric_delta'
);

-- =========================================================
-- query_cache_entries — 1 dòng / biến thể (query_config + bộ giá trị filter).
-- CHỈ chứa metadata xếp hạng để scheduler chọn "biến thể hot" đem chạy sẵn;
-- KHÔNG chứa rows (kết quả nằm ở Redis, key cache:<id>:<params_key>).
-- Xem docs/superpowers/specs/2026-09-11-redis-query-cache-design.md.
-- =========================================================
CREATE TABLE query_cache_entries (
    query_config_id INTEGER NOT NULL REFERENCES query_configs(id) ON DELETE CASCADE,
    params_key   TEXT NOT NULL DEFAULT '',       -- '' = query không có :param; ngược lại = sha1(cặp [tên,giá trị] filter đã sort)
    params       JSONB NOT NULL DEFAULT '{}',    -- giá trị bind, vd {"year":"2024"} — scheduler đọc để dựng message
    hit_count    INTEGER NOT NULL DEFAULT 0,
    duration_ms  INTEGER,                        -- ms lần chạy SQL live gần nhất; NULL nếu chưa đo. Scheduler xếp hạng theo hit_count * duration_ms ("hot × đắt")
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (query_config_id, params_key)
);
CREATE INDEX idx_query_cache_entries_hit_count ON query_cache_entries(hit_count DESC);
-- DB đã tạo từ trước: chạy tay dòng dưới để thêm cột mới
-- ALTER TABLE query_cache_entries ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

