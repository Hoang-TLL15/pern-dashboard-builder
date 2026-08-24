-- =========================================================
-- DATA SOURCE DB — dữ liệu nghiệp vụ mẫu (mục 4.2, AdventureWorks-lite)
-- Database: dashboard_builder_shop
-- Đây là 1 database HOÀN TOÀN TÁCH BIỆT khỏi Meta DB.
-- BE không biết trước schema này — chỉ chạy hộ SQL đã duyệt sẵn trong query_configs.
-- =========================================================

CREATE TABLE customers (
    customer_id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    city VARCHAR(100),
    country VARCHAR(100),
    signup_date DATE
);

CREATE TABLE products (
    product_id SERIAL PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    unit_price NUMERIC(10,2) NOT NULL
);

CREATE TABLE employees (
    employee_id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    department VARCHAR(100),
    hire_date DATE,
    salary NUMERIC(10,2)
);

CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id),
    order_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'completed'
);

CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(order_id),
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL
);

-- =========================================================
-- SEED DATA
-- Đồng bộ với dữ liệu thực tế đang chạy trong dashboard_builder_shop —
-- nhiều khách hàng/quốc gia, nhiều category sản phẩm, đơn hàng trải dài
-- nhiều tháng (2024-01 -> 2025-03) và đủ trạng thái (completed/pending/
-- cancelled) để các query trong query_configs (mục init_meta.sql) có dữ
-- liệu đa dạng cho mọi loại chart.
-- =========================================================

INSERT INTO customers (first_name, last_name, email, city, country, signup_date) VALUES
('An', 'Nguyen', 'an.nguyen@example.com', 'Ho Chi Minh', 'Vietnam', '2023-01-15'),
('Binh', 'Tran', 'binh.tran@example.com', 'Ha Noi', 'Vietnam', '2023-02-20'),
('Chi', 'Le', 'chi.le@example.com', 'Da Nang', 'Vietnam', '2023-03-05'),
('David', 'Smith', 'david.smith@example.com', 'New York', 'USA', '2023-01-30'),
('Emma', 'Johnson', 'emma.johnson@example.com', 'London', 'UK', '2023-04-11'),
('Khang', 'Le', 'khang.le@example.com', 'Ho Chi Minh', 'Vietnam', '2023-05-12'),
('Sara', 'Connor', 'sara.connor@example.com', 'Los Angeles', 'USA', '2023-06-22'),
('Yuki', 'Tanaka', 'yuki.tanaka@example.com', 'Tokyo', 'Japan', '2023-07-30'),
('Tuan', 'Phan', 'tuan.phan@example.com', 'Can Tho', 'Vietnam', '2023-08-15'),
('Elena', 'Gomez', 'elena.gomez@example.com', 'Madrid', 'Spain', '2023-09-10'),
('John', 'Doe', 'john.doe@example.com', 'Sydney', 'Australia', '2023-10-05'),
('Mai', 'Vo', 'mai.vo@example.com', 'Hai Phong', 'Vietnam', '2023-11-02'),
('Carlos', 'Rivera', 'carlos.rivera@example.com', 'Mexico City', 'Mexico', '2023-11-20'),
('Fatima', 'Al-Sayed', 'fatima.alsayed@example.com', 'Dubai', 'UAE', '2023-12-05'),
('Linh', 'Dang', 'linh.dang@example.com', 'Hue', 'Vietnam', '2024-01-10'),
('Marco', 'Rossi', 'marco.rossi@example.com', 'Milan', 'Italy', '2024-02-14'),
('Priya', 'Sharma', 'priya.sharma@example.com', 'Mumbai', 'India', '2024-03-01');

INSERT INTO products (product_name, category, unit_price) VALUES
('27" Monitor', 'Electronics', 179.99),
('Standing Desk', 'Furniture', 249.00),
('Wireless Mouse', 'Electronics', 24.99),
('Office Chair', 'Furniture', 139.50),
('Mechanical Keyboard', 'Electronics', 89.00),
('Ergonomic Mouse', 'Electronics', 45.00),
('Laptop Stand', 'Accessories', 35.50),
('Noise Cancelling Headphones', 'Electronics', 199.99),
('Desk Lamp', 'Furniture', 29.00),
('4K Webcam', 'Electronics', 120.00),
('Ergonomic Chair', 'Furniture', 199.00),
('USB-C Hub', 'Accessories', 49.99),
('Gaming Mousepad', 'Accessories', 19.99),
('Notebook Set', 'Stationery', 12.50),
('Whiteboard', 'Furniture', 65.00),
('Wireless Charger', 'Electronics', 34.99),
('Desk Organizer', 'Stationery', 15.75),
('External SSD 1TB', 'Electronics', 109.00);

INSERT INTO employees (full_name, department, hire_date, salary) VALUES
('Hoang Pham', 'Sales_1', '2021-05-01', 1200.00),
('Lan Vu', 'Sales_2', '2022-03-15', 1100.00),
('Minh Do', 'Sales_1', '2020-09-10', 950.00),
('Tuan Hoang', 'Sales_3', '2022-11-01', 1300.00),
('Alice Brown', 'Sales_3', '2023-01-15', 980.00),
('Nam Tran', 'Support', '2023-06-01', 1050.00),
('Grace Kim', 'Marketing', '2023-09-15', 1150.00);

INSERT INTO orders (customer_id, employee_id, order_date, status) VALUES
(1, 5, '2024-01-10', 'completed'),
(2, 3, '2024-01-15', 'completed'),
(3, 2, '2024-02-02', 'completed'),
(4, 2, '2024-02-20', 'completed'),
(5, 3, '2024-03-05', 'completed'),
(1, 1, '2024-03-18', 'completed'),
(2, 2, '2024-04-01', 'completed'),
(6, 4, '2024-05-10', 'completed'),
(7, 1, '2024-05-15', 'completed'),
(8, 5, '2024-06-02', 'cancelled'),
(1, 2, '2024-06-20', 'completed'),
(3, 1, '2024-07-05', 'pending'),
(9, 2, '2024-08-01', 'completed'),
(10, 3, '2024-08-10', 'completed'),
(11, 4, '2024-08-15', 'pending'),
(4, 1, '2024-09-02', 'completed'),
(5, 5, '2024-09-20', 'cancelled'),
(2, 3, '2024-10-05', 'completed'),
(6, 6, '2024-11-05', 'completed'),
(7, 7, '2024-11-12', 'completed'),
(12, 1, '2024-11-20', 'completed'),
(13, 2, '2024-11-28', 'pending'),
(8, 3, '2024-12-03', 'completed'),
(14, 4, '2024-12-10', 'completed'),
(9, 5, '2024-12-18', 'cancelled'),
(15, 6, '2024-12-27', 'completed'),
(10, 7, '2025-01-08', 'completed'),
(16, 1, '2025-01-15', 'completed'),
(11, 2, '2025-01-22', 'pending'),
(17, 3, '2025-02-02', 'completed'),
(3, 4, '2025-02-10', 'completed'),
(5, 5, '2025-02-18', 'cancelled'),
(1, 6, '2025-03-01', 'completed');

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
(1, 1, 1, 179.99),
(1, 3, 2, 24.99),
(2, 2, 2, 249.00),
(3, 4, 1, 139.50),
(4, 5, 4, 89.00),
(5, 1, 1, 179.99),
(6, 2, 1, 249.00),
(6, 3, 5, 24.99),
(7, 5, 2, 89.00),
(7, 4, 1, 139.50),
(8, 6, 2, 45.00),
(8, 7, 1, 35.50),
(9, 8, 1, 199.99),
(10, 9, 2, 29.00),
(11, 1, 1, 179.99),
(12, 3, 3, 24.99),
(13, 10, 1, 120.00),
(13, 12, 2, 49.99),
(14, 11, 1, 199.00),
(15, 1, 2, 179.99),
(15, 13, 1, 19.99),
(16, 8, 1, 199.99),
(16, 2, 1, 249.00),
(17, 4, 4, 139.50),
(18, 5, 1, 89.00),
(18, 3, 1, 24.99),
(19, 6, 2, 45.00),
(19, 14, 5, 12.50),
(20, 16, 1, 34.99),
(21, 2, 1, 249.00),
(21, 9, 3, 29.00),
(22, 10, 1, 120.00),
(23, 1, 1, 179.99),
(23, 17, 2, 15.75),
(24, 18, 1, 109.00),
(25, 3, 4, 24.99),
(26, 15, 1, 65.00),
(26, 7, 2, 35.50),
(27, 5, 3, 89.00),
(28, 11, 1, 199.00),
(29, 13, 2, 19.99),
(30, 8, 1, 199.99),
(30, 16, 1, 34.99),
(31, 4, 1, 139.50),
(32, 12, 3, 49.99),
(33, 1, 2, 179.99),
(33, 6, 1, 45.00);
