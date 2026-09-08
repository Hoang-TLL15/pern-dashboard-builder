// src/services/queryCacheService.js
// Tier-2 cache: giữa runCache RAM (30s, trong queryConfigService) và SQL live.
// Kết quả biến thể hot được worker ghi ra file JSON; file này lo phần Node ĐỌC
// file + ghi sổ hit vào query_cache_entries + xoá file khi query đổi. KHÔNG tự
// chạy SQL, không biết req/res. Xem docs/query-file-cache-queue-design.md.
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const queryCacheEntryRepository = require('../repositories/queryCacheEntryRepository');

// Khoá biến thể dùng làm tên file: '' nếu query không có :param nào có giá trị;
// ngược lại sha1 của cặp [tên, giá trị] filter đã sort — ổn định giữa các lần,
// an toàn cho tên file. CHỈ Node tính khoá này; worker nhận sẵn qua message.
function paramsKey(relevantValues) {
  const entries = Object.entries(relevantValues)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => x.localeCompare(y));
  if (entries.length === 0) return '';
  return crypto.createHash('sha1').update(JSON.stringify(entries)).digest('hex');
}

function cacheFilePath(queryConfigId, key) {
  return path.join(env.cacheDir, String(queryConfigId), `${key || '_'}.json`);
}

// Đọc tier-2: trả { columns, rows } nếu file tồn tại và computed_at còn trong
// hạn env.cacheFileTtlMs; ngược lại undefined (caller chạy SQL live).
async function readFresh(queryConfigId, relevantValues) {
  const file = cacheFilePath(queryConfigId, paramsKey(relevantValues));
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (Date.now() - new Date(parsed.computed_at).getTime() > env.cacheFileTtlMs) {
    return undefined;
  }
  return { columns: parsed.columns, rows: parsed.rows };
}

// Fire-and-forget sau mỗi lần trả kết quả 1 biến thể — đánh dấu nó được dùng để
// scheduler xếp hạng. Nuốt lỗi: sổ sách cache hỏng không được ảnh hưởng report.
function recordHit(queryConfigId, relevantValues) {
  queryCacheEntryRepository
    .upsertHit(queryConfigId, paramsKey(relevantValues), stripUndefined(relevantValues))
    .catch((err) => console.error('[queryCacheService] recordHit lỗi:', err.message));
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

// Scheduler cleanup: xoá file của 1 biến thể idle. Dọn luôn thư mục <id> nếu
// đã rỗng (rmdir ném ENOTEMPTY khi còn biến thể khác -> bỏ qua).
async function deleteFile(queryConfigId, key) {
  await fsp.rm(cacheFilePath(queryConfigId, key), { force: true });
  await fsp.rmdir(path.join(env.cacheDir, String(queryConfigId))).catch(() => {});
}

// query_config bị sửa/xoá: bỏ toàn bộ thư mục file của id đó.
async function deleteDir(queryConfigId) {
  await fsp.rm(path.join(env.cacheDir, String(queryConfigId)), { recursive: true, force: true });
}

module.exports = { paramsKey, cacheFilePath, readFresh, recordHit, deleteFile, deleteDir };

if (require.main === module) {
  const assert = require('assert');
  const fs = require('fs');
  const os = require('os');

  // paramsKey: thứ tự key không đổi kết quả; bỏ undefined; rỗng -> ''
  const a = module.exports.paramsKey({ year: '2024', region: 'VN' });
  const b = module.exports.paramsKey({ region: 'VN', year: '2024' });
  assert.strictEqual(a, b, 'paramsKey phải độc lập thứ tự key');
  assert.match(a, /^[0-9a-f]{40}$/, 'paramsKey có param -> sha1 hex');
  assert.strictEqual(module.exports.paramsKey({}), '', 'không param -> chuỗi rỗng');
  assert.strictEqual(module.exports.paramsKey({ year: undefined }), '', 'undefined bị bỏ -> chuỗi rỗng');

  (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcache-'));
    process.env.CACHE_DIR = dir;
    delete require.cache[require.resolve('../config/env')];
    delete require.cache[require.resolve('./queryCacheService')];
    const svc = require('./queryCacheService');

    // file thiếu -> undefined
    assert.strictEqual(await svc.readFresh(1, {}), undefined);

    // file còn hạn -> trả { columns, rows }
    const fresh = path.join(dir, '1', '_.json');
    fs.mkdirSync(path.dirname(fresh), { recursive: true });
    fs.writeFileSync(fresh, JSON.stringify({
      columns: [{ key: 'x', label: 'x', type: 'number' }],
      rows: [{ x: 1 }],
      computed_at: new Date().toISOString(),
    }));
    assert.deepStrictEqual(await svc.readFresh(1, {}), {
      columns: [{ key: 'x', label: 'x', type: 'number' }],
      rows: [{ x: 1 }],
    });

    // file quá hạn -> undefined
    fs.writeFileSync(fresh, JSON.stringify({
      columns: [], rows: [],
      computed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    assert.strictEqual(await svc.readFresh(1, {}), undefined);

    console.log('queryCacheService self-check: OK');
  })();
}
