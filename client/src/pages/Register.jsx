import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(username, password);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 1000);
    } catch (err) {
      setError(err.response?.data?.error || 'Đăng ký thất bại');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <span className="auth-eyebrow">Dashboard Builder</span>
        <h1 className="auth-title">Đăng ký</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="register-username">Username</label>
            <input
              id="register-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="register-password">Password</label>
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <span className="field-hint">Tối thiểu 6 ký tự</span>
          </div>
          {error && <p className="form-message error">{error}</p>}
          {success && (
            <p className="form-message success">
              Đăng ký thành công, đang chuyển tới trang đăng nhập…
            </p>
          )}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Đang đăng ký…' : 'Đăng ký'}
          </button>
        </form>
        <p className="auth-footer">
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </p>
      </div>
    </div>
  );
}
