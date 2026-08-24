// Lớp service — business logic: orchestrate gọi API + lưu/đọc session.
// Không biết gì về React (không dùng useState/useContext).
import authApi from '../api/authApi';

function getStoredUser() {
  const stored = localStorage.getItem('user');
  return stored ? JSON.parse(stored) : null;
}

function persistSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

async function login(username, password) {
  const { token, user } = await authApi.loginRequest(username, password);
  persistSession(token, user);
  return user;
}

async function register(username, password) {
  await authApi.registerRequest(username, password);
}

function logout() {
  clearSession();
}

export default { login, register, logout, getStoredUser };
