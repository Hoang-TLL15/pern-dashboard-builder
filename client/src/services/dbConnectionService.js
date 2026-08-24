// Lớp service — orchestrate gọi API. Không biết gì về React
// (không dùng useState/useContext), không cần lưu session.
import dbConnectionApi from '../api/dbConnectionApi';

async function list() {
  const { connections } = await dbConnectionApi.listRequest();
  return connections;
}

async function getById(id) {
  const { connection } = await dbConnectionApi.getByIdRequest(id);
  return connection;
}

async function getSchema(id) {
  const { schema } = await dbConnectionApi.getSchemaRequest(id);
  return schema;
}

export default { list, getById, getSchema };
