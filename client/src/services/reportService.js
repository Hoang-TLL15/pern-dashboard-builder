// Lớp service — orchestrate gọi API. Không biết gì về React
// (không dùng useState/useContext), không cần lưu session.
import reportApi from '../api/reportApi';

async function list() {
  const { reports } = await reportApi.listRequest();
  return reports;
}

async function getById(id) {
  const { report } = await reportApi.getByIdRequest(id);
  return report;
}

async function create(payload) {
  const { report } = await reportApi.createRequest(payload);
  return report;
}

async function update(id, payload) {
  const { report } = await reportApi.updateRequest(id, payload);
  return report;
}

async function remove(id) {
  return reportApi.deleteRequest(id);
}

export default { list, getById, create, update, remove };
