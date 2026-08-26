// Lớp API — chỉ gọi HTTP thuần, trả nguyên response.data.
// Không đọc/ghi localStorage, không xử lý logic nghiệp vụ.
import apiClient from './client';

async function listRequest() {
  const res = await apiClient.get('/reports');
  return res.data; // { reports }
}

async function getByIdRequest(id) {
  const res = await apiClient.get(`/reports/${id}`);
  return res.data; // { report }
}

async function createRequest(payload) {
  const res = await apiClient.post('/reports', payload);
  return res.data; // { report }
}

async function updateRequest(id, payload) {
  const res = await apiClient.put(`/reports/${id}`, payload);
  return res.data; // { report }
}

async function deleteRequest(id) {
  await apiClient.delete(`/reports/${id}`);
}

async function updateFilterValuesRequest(id, filterValues) {
  await apiClient.patch(`/reports/${id}/filter-values`, { filterValues });
}

export default {
  listRequest,
  getByIdRequest,
  createRequest,
  updateRequest,
  updateFilterValuesRequest,
  deleteRequest,
};
