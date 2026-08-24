// Lớp API — chỉ gọi HTTP thuần, trả nguyên response.data.
// Không đọc/ghi localStorage, không xử lý logic nghiệp vụ.
import apiClient from './client';

async function loginRequest(username, password) {
  const res = await apiClient.post('/login', { username, password });
  return res.data; // { token, user }
}

async function registerRequest(username, password) {
  const res = await apiClient.post('/register', { username, password });
  return res.data; // { user }
}

export default { loginRequest, registerRequest };
