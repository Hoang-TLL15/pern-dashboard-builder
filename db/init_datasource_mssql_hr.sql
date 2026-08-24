-- =========================================================
-- DATA SOURCE DB (SQL Server) — dữ liệu nhân sự mẫu (chủ đề HR)
-- Server: TestDashboard.mssql.somee.com — Database: TestDashboard
-- Đây là 1 database HOÀN TOÀN TÁCH BIỆT khỏi Meta DB (Postgres).
-- BE không biết trước schema này — chỉ chạy hộ SQL đã duyệt sẵn trong
-- query_configs (xem server/scripts/seedMssqlHrConnection.js).
-- Chạy file này thủ công lên somee.com (SSMS / Azure Data Studio / sqlcmd)
-- TRƯỚC khi chạy seedMssqlHrConnection.js.
-- =========================================================

CREATE TABLE departments (
    department_id INT IDENTITY(1,1) PRIMARY KEY,
    department_name NVARCHAR(100) NOT NULL,
    location NVARCHAR(100)
);

CREATE TABLE employees (
    employee_id INT IDENTITY(1,1) PRIMARY KEY,
    full_name NVARCHAR(255) NOT NULL,
    department_id INT NOT NULL REFERENCES departments(department_id),
    position NVARCHAR(100),
    gender NVARCHAR(10),
    hire_date DATE NOT NULL,
    salary DECIMAL(10,2) NOT NULL
);

CREATE TABLE salary_history (
    history_id INT IDENTITY(1,1) PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(employee_id),
    effective_date DATE NOT NULL,
    salary DECIMAL(10,2) NOT NULL,
    change_reason NVARCHAR(255)
);

CREATE TABLE leave_requests (
    leave_id INT IDENTITY(1,1) PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(employee_id),
    leave_type NVARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status NVARCHAR(30) NOT NULL DEFAULT 'approved'
);

CREATE TABLE performance_reviews (
    review_id INT IDENTITY(1,1) PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(employee_id),
    review_date DATE NOT NULL,
    score DECIMAL(4,2) NOT NULL,
    reviewer_name NVARCHAR(255)
);
GO

-- =========================================================
-- SEED DATA
-- =========================================================

INSERT INTO departments (department_name, location) VALUES
('Engineering', 'Ha Noi'),
('Sales', 'Ho Chi Minh'),
('Marketing', 'Ho Chi Minh'),
('Human Resources', 'Ha Noi'),
('Finance', 'Da Nang');

INSERT INTO employees (full_name, department_id, position, gender, hire_date, salary) VALUES
('Nguyen Van A', 1, 'Backend Developer', 'Male', '2021-03-01', 1500.00),
('Tran Thi B', 1, 'Frontend Developer', 'Female', '2021-07-15', 1400.00),
('Le Van C', 2, 'Sales Executive', 'Male', '2020-01-10', 1100.00),
('Pham Thi D', 2, 'Sales Manager', 'Female', '2019-05-20', 1800.00),
('Hoang Van E', 3, 'Marketing Specialist', 'Male', '2022-02-01', 1200.00),
('Vu Thi F', 3, 'Marketing Manager', 'Female', '2020-09-12', 1700.00),
('Dang Van G', 4, 'HR Executive', 'Male', '2021-11-05', 1150.00),
('Bui Thi H', 5, 'Accountant', 'Female', '2022-06-18', 1300.00),
('Do Van I', 1, 'QA Engineer', 'Male', '2022-08-01', 1250.00),
('Ngo Thi K', 5, 'Finance Manager', 'Female', '2018-04-22', 1900.00);

INSERT INTO salary_history (employee_id, effective_date, salary, change_reason) VALUES
(1, '2021-03-01', 1300.00, 'Khoi diem'),
(1, '2022-03-01', 1500.00, 'Tang luong dinh ky'),
(2, '2021-07-15', 1250.00, 'Khoi diem'),
(2, '2022-07-15', 1400.00, 'Tang luong dinh ky'),
(3, '2020-01-10', 950.00, 'Khoi diem'),
(3, '2021-01-10', 1100.00, 'Tang luong dinh ky'),
(4, '2019-05-20', 1500.00, 'Khoi diem'),
(4, '2021-05-20', 1800.00, 'Thang chuc'),
(5, '2022-02-01', 1200.00, 'Khoi diem'),
(6, '2020-09-12', 1400.00, 'Khoi diem'),
(6, '2022-09-12', 1700.00, 'Thang chuc'),
(9, '2022-08-01', 1250.00, 'Khoi diem'),
(10, '2018-04-22', 1600.00, 'Khoi diem'),
(10, '2021-04-22', 1900.00, 'Thang chuc');

INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, status) VALUES
(1, 'Annual', '2024-01-10', '2024-01-12', 'approved'),
(2, 'Sick', '2024-02-05', '2024-02-06', 'approved'),
(3, 'Annual', '2024-02-20', '2024-02-22', 'approved'),
(4, 'Unpaid', '2024-03-01', '2024-03-03', 'rejected'),
(5, 'Annual', '2024-03-15', '2024-03-16', 'approved'),
(6, 'Sick', '2024-04-02', '2024-04-02', 'approved'),
(7, 'Annual', '2024-04-18', '2024-04-20', 'pending'),
(8, 'Annual', '2024-05-05', '2024-05-07', 'approved'),
(9, 'Sick', '2024-05-20', '2024-05-21', 'approved'),
(10, 'Annual', '2024-06-01', '2024-06-05', 'approved'),
(1, 'Sick', '2024-06-15', '2024-06-15', 'approved'),
(3, 'Annual', '2024-07-10', '2024-07-12', 'pending'),
(5, 'Unpaid', '2024-08-01', '2024-08-02', 'approved'),
(8, 'Sick', '2024-09-10', '2024-09-11', 'approved'),
(2, 'Annual', '2024-10-01', '2024-10-03', 'approved');

INSERT INTO performance_reviews (employee_id, review_date, score, reviewer_name) VALUES
(1, '2024-01-15', 8.50, 'Pham Thi D'),
(2, '2024-01-15', 7.80, 'Pham Thi D'),
(3, '2024-01-20', 8.00, 'Vu Thi F'),
(4, '2024-01-20', 9.20, 'Vu Thi F'),
(5, '2024-01-25', 7.50, 'Dang Van G'),
(6, '2024-01-25', 8.90, 'Dang Van G'),
(7, '2024-02-01', 7.20, 'Ngo Thi K'),
(8, '2024-02-01', 8.30, 'Ngo Thi K'),
(9, '2024-02-05', 7.90, 'Pham Thi D'),
(10, '2024-02-05', 9.00, 'Pham Thi D');
