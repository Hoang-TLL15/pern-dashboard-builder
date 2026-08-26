// Lớp API — chỉ gọi HTTP thuần, trả nguyên response.data.
// Không đọc/ghi localStorage, không xử lý logic nghiệp vụ.
import apiClient from './client';

async function listByDbConnectionIdRequest(dbConnectionId) {
  const res = await apiClient.get(`/db-connections/${dbConnectionId}/query-configs`);
  return res.data; // { queryConfigs }
}

async function runRequest(id) {
  const res = await apiClient.get(`/query-configs/${id}/run`);
  return res.data; // { id, name, suggestedChartType, columns[], rows[] }
}

async function runManyRequest(ids, filters) {
  const res = await apiClient.post('/query-configs/run-batch', { ids, filters });
  return res.data; // { results: [...] }
}

async function previewRequest(dbConnectionId, query) {
  const res = await apiClient.post(`/db-connections/${dbConnectionId}/query-preview`, { query });
  return res.data; // { columns[], rows[] }
}

async function createRequest(payload) {
  const res = await apiClient.post('/query-configs', payload);
  return res.data; // { queryConfig }
}

async function updateRequest(id, payload) {
  const res = await apiClient.put(`/query-configs/${id}`, payload);
  return res.data; // { queryConfig }
}

async function removeRequest(id) {
  await apiClient.delete(`/query-configs/${id}`);
}

export default {
  listByDbConnectionIdRequest,
  runRequest,
  runManyRequest,
  previewRequest,
  createRequest,
  updateRequest,
  removeRequest,
};
