// Lớp API — chỉ gọi HTTP thuần, trả nguyên response.data.
// Không đọc/ghi localStorage, không xử lý logic nghiệp vụ.
import apiClient from './client';

async function listRequest() {
  const res = await apiClient.get('/db-connections');
  return res.data; // { connections }
}

async function getByIdRequest(id) {
  const res = await apiClient.get(`/db-connections/${id}`);
  return res.data; // { connection }
}

async function getSchemaRequest(id) {
  const res = await apiClient.get(`/db-connections/${id}/schema`);
  return res.data; // { schema }
}

export default { listRequest, getByIdRequest, getSchemaRequest };
