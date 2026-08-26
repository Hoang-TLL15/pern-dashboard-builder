// Lớp service — orchestrate gọi API. Không biết gì về React
// (không dùng useState/useContext), không cần lưu session.
import queryConfigApi from '../api/queryConfigApi';

async function listByDbConnectionId(dbConnectionId) {
  const { queryConfigs } = await queryConfigApi.listByDbConnectionIdRequest(dbConnectionId);
  return queryConfigs;
}

async function run(id, filters) {
  return queryConfigApi.runRequest(id, filters);
}

async function runMany(ids, filters) {
  const { results } = await queryConfigApi.runManyRequest(ids, filters);
  return results;
}

async function preview(dbConnectionId, query) {
  return queryConfigApi.previewRequest(dbConnectionId, query);
}

async function create(payload) {
  const { queryConfig } = await queryConfigApi.createRequest(payload);
  return queryConfig;
}

async function update(id, payload) {
  const { queryConfig } = await queryConfigApi.updateRequest(id, payload);
  return queryConfig;
}

async function remove(id) {
  return queryConfigApi.removeRequest(id);
}

export default { listByDbConnectionId, run, runMany, preview, create, update, remove };
