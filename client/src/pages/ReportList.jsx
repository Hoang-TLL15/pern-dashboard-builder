import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import reportService from '../services/reportService';
import Spinner from '../components/Spinner';

export default function ReportList() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    reportService
      .list()
      .then((data) => {
        if (!cancelled) setReports(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Không tải được danh sách report');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(e, id) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Xoá report này?')) return;
    setDeletingId(id);
    try {
      await reportService.remove(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Không xoá được report');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="placeholder-page">
      <header className="placeholder-header">
        <span className="auth-eyebrow">Dashboard Builder</span>
        <nav className="top-nav">
          <Link className="top-nav-link" to="/data-sources">
            Nguồn dữ liệu
          </Link>
          <button className="ghost-button" onClick={logout}>
            Đăng xuất ({user?.username})
          </button>
        </nav>
      </header>

      <div className="workspace-panel-header">
        <h1 className="section-title">Reports của bạn</h1>
        <button className="primary-button" onClick={() => navigate('/reports/new')}>
          Tạo report mới
        </button>
      </div>

      {loading && <Spinner label="Đang tải..." />}
      {error && <p className="form-message error">{error}</p>}

      {!loading && !error && reports.length === 0 && (
        <div className="empty-state">
          <p className="empty-state-title">Chưa có report nào</p>
          <p className="placeholder-text">Bấm "Tạo report mới" để bắt đầu</p>
        </div>
      )}

      {!loading && !error && reports.length > 0 && (
        <div className="report-grid">
          {reports.map((r) => (
            <Link className="report-card" to={`/reports/${r.id}`} key={r.id}>
              <div className="report-card-header">
                <span className="report-card-name">{r.name}</span>
                <button
                  className="ghost-button report-card-delete"
                  disabled={deletingId === r.id}
                  onClick={(e) => handleDelete(e, r.id)}
                >
                  Xoá
                </button>
              </div>
              {r.description && <p className="report-card-description">{r.description}</p>}
              <div className="report-card-footer">
                <span>{r._count?.widgets ?? 0} chart</span>
                <span>Cập nhật {new Date(r.updatedAt).toLocaleString('vi-VN')}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
