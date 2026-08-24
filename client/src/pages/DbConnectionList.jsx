import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import dbConnectionService from '../services/dbConnectionService';
import Spinner from '../components/Spinner';

export default function DbConnectionList() {
  const { user, logout } = useAuth();
  const [connections, setConnections] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    dbConnectionService
      .list()
      .then((data) => {
        if (!cancelled) setConnections(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Không tải được danh sách kết nối');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="placeholder-page">
      <header className="placeholder-header">
        <span className="auth-eyebrow">Dashboard Builder</span>
        <nav className="top-nav">
          <Link className="top-nav-link" to="/reports">
            Reports
          </Link>
          <button className="ghost-button" onClick={logout}>
            Đăng xuất ({user?.username})
          </button>
        </nav>
      </header>

      {loading && <Spinner label="Đang tải..." />}
      {error && <p className="form-message error">{error}</p>}

      {!loading && !error && (
        <div className="db-connection-grid">
          {connections.map((conn) => (
            <Link className="db-connection-card" to={`/data-sources/${conn.id}`} key={conn.id}>
              <span className="db-connection-type">{conn.dbType}</span>
              <span className="db-connection-name">{conn.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
