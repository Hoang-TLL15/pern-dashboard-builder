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
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_user_id ON reports(user_id);

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

