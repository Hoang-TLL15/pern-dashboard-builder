// scripts/enqueueRefresh.js — thủ công đẩy 1 message refresh để test worker.
// Dùng: node scripts/enqueueRefresh.js <queryConfigId> ['<paramsJson>']
//   node scripts/enqueueRefresh.js 3
//   node scripts/enqueueRefresh.js 31 '{"year":"2024"}'
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const publisher = require('../src/queue/publisher');
const { paramsKey } = require('../src/services/queryCacheService');

const [, , idArg, paramsJson] = process.argv;
if (!idArg) {
  console.error('Thiếu queryConfigId. Dùng: node scripts/enqueueRefresh.js <id> [paramsJson]');
  process.exit(1);
}
const params = paramsJson ? JSON.parse(paramsJson) : {};

publisher
  .publishRefresh({ query_config_id: Number(idArg), params_key: paramsKey(params), params })
  .then(() => {
    console.log('published:', { id: Number(idArg), params_key: paramsKey(params), params });
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
