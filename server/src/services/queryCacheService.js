// src/services/queryCacheService.js
// Tầng cache duy nhất (gộp tier-1 RAM + tier-2 file cũ) — lưu kết quả 1 biến
// thể trong Redis. Ghi từ 2 nguồn, TTL khác nhau: Node ghi khi user request
// chạy live (miss cache, TTL ngắn — set()); worker Python ghi khi refresh nền
// (TTL dài, ghi trực tiếp từ worker/actors.py, không qua hàm nào ở đây). Đọc
// luôn qua get(). Sổ sách hit_count/duration_ms (Postgres) không đổi. Redis là
// phụ trợ: mọi lỗi kết nối/lệnh -> log rồi coi như miss/no-op, KHÔNG throw.
// Xem docs/superpowers/specs/2026-09-11-redis-query-cache-design.md.
const crypto = require('crypto');
const { createClient } = require('redis');
const env = require('../config/env');
const queryCacheEntryRepository = require('../repositories/queryCacheEntryRepository');

// Khoá biến thể: '' nếu query không có :param nào có giá trị; ngược lại sha1
// của cặp [tên, giá trị] filter đã sort. CHỈ Node tính khoá này; worker nhận
// sẵn params_key qua message Dramatiq.
function paramsKey(relevantValues) {
  const entries = Object.entries(relevantValues)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => x.localeCompare(y));
  if (entries.length === 0) return '';
  return crypto.createHash('sha1').update(JSON.stringify(entries)).digest('hex');
}

// Hợp đồng key Redis giữa Node và worker/actors.py — đổi 1 bên phải đổi cả 2.
function cacheKey(queryConfigId, key) {
  return `cache:${queryConfigId}:${key || '_'}`;
}

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    const client = createClient({ url: env.redisUrl });
    client.on('error', (err) => console.error('[queryCacheService] Redis lỗi:', err.message));
    clientPromise = client.connect().then(
      () => client,
      (err) => {
        clientPromise = null;
        throw err;
      }
    );
  }
  return clientPromise;
}

// Đọc: { columns, rows } nếu còn trong Redis; undefined nếu miss hoặc Redis
// lỗi/không kết nối được — caller luôn có đường lùi chạy SQL live.
async function get(queryConfigId, relevantValues) {
  try {
    const client = await getClient();
    const raw = await client.get(cacheKey(queryConfigId, paramsKey(relevantValues)));
    return raw ? JSON.parse(raw) : undefined;
  } catch (err) {
    console.error('[queryCacheService] Redis get lỗi:', err.message);
    return undefined;
  }
}

// Ghi sau 1 lượt SQL live do USER request gây ra (miss cache) — TTL ngắn
// (env.cacheTtlFreshMs). Worker refresh nền ghi TTL dài trực tiếp từ Python,
// không qua hàm này.
async function set(queryConfigId, relevantValues, data) {
  try {
    const client = await getClient();
    await client.set(cacheKey(queryConfigId, paramsKey(relevantValues)), JSON.stringify(data), {
      PX: env.cacheTtlFreshMs,
    });
  } catch (err) {
    console.error('[queryCacheService] Redis set lỗi:', err.message);
  }
}

// Xoá 1 biến thể — scheduler cleanup gọi cho từng biến thể idle > 14 ngày.
async function deleteVariant(queryConfigId, key) {
  try {
    const client = await getClient();
    await client.del(cacheKey(queryConfigId, key));
  } catch (err) {
    console.error('[queryCacheService] Redis xoá lỗi:', err.message);
  }
}

// Xoá TOÀN BỘ biến thể của 1 query_config — update()/remove() gọi vì query
// text đổi thì mọi biến thể cũ có thể sai.
async function deleteForQueryConfigId(queryConfigId) {
  try {
    const client = await getClient();
    const pattern = cacheKey(queryConfigId, '*');
    for await (const key of client.scanIterator({ MATCH: pattern })) {
      await client.del(key);
    }
  } catch (err) {
    console.error('[queryCacheService] Redis xoá lỗi:', err.message);
  }
}

// --- Sổ sách hit_count/duration_ms (Postgres) — không đổi so với bản cũ ---

// Gọi sau mỗi lần trả kết quả 1 biến thể — đánh dấu nó được dùng để scheduler
// xếp hạng. KHÔNG upsert Meta DB ngay: 1 report nhiều widget mở nhiều lần =
// hàng trăm write/phút cho dữ liệu chỉ dùng để xếp hạng. Gộp vào RAM, flush
// định kỳ (flushHits). Mất tối đa 1 chu kỳ flush khi tiến trình chết — chấp
// nhận được, đây là số liệu xếp hạng không phải dữ liệu nghiệp vụ.
// durationMs: chỉ lượt chạy SQL live (tier-3) truyền vào; cache hit gọi không
// kèm -> giữ nguyên duration_ms cũ trong DB. Lượt worker làm mới cache (skipCache)
// đo được durationMs nhưng KHÔNG phải lượt người dùng -> gọi recordDuration để
// cập nhật duration_ms mà không cộng hit_count.
const FLUSH_INTERVAL_MS = 30_000;
const pendingHits = new Map(); // key `${id}::${paramsKey}` -> { queryConfigId, paramsKey, params, hits, durationMs }

function recordHit(queryConfigId, relevantValues, durationMs) {
  const key = paramsKey(relevantValues);
  const params = stripUndefined(relevantValues);
  const existing = pendingHits.get(`${queryConfigId}::${key}`);
  if (existing) {
    existing.hits += 1;
    existing.params = params;
    if (durationMs !== undefined) existing.durationMs = durationMs;
  } else {
    pendingHits.set(`${queryConfigId}::${key}`, {
      queryConfigId,
      paramsKey: key,
      params,
      hits: 1,
      durationMs,
    });
  }
}

// Worker làm mới cache (skipCache) vừa đo xong thời gian chạy SQL live — ghi lại
// duration_ms cho biến thể đó mà KHÔNG cộng hit_count (lượt worker không phải
// lượt người dùng xem). Gộp chung pendingHits: nếu chu kỳ này đã có lượt người
// dùng cho cùng biến thể thì chỉ cập nhật durationMs, giữ nguyên hits.
function recordDuration(queryConfigId, relevantValues, durationMs) {
  if (durationMs === undefined) return;
  const key = paramsKey(relevantValues);
  const mapKey = `${queryConfigId}::${key}`;
  const existing = pendingHits.get(mapKey);
  if (existing) {
    existing.durationMs = durationMs;
  } else {
    pendingHits.set(mapKey, {
      queryConfigId,
      paramsKey: key,
      params: stripUndefined(relevantValues),
      hits: 0,
      durationMs,
    });
  }
}

// Ghi toàn bộ hit đã gộp xuống Meta DB. Gọi định kỳ qua timer; cũng nên gọi 1
// lần lúc graceful shutdown để không mất chu kỳ cuối. Nuốt lỗi từng entry: sổ
// sách cache hỏng không được ảnh hưởng report.
// ponytail: loop upsert từng entry, không gộp 1 câu INSERT ... ON CONFLICT nhiều
// VALUES. Số biến thể/chu kỳ nhỏ; việc gộp đã bỏ được phần write-per-read. Nâng
// cấp nếu 1 flush đụng hàng trăm biến thể.
async function flushHits() {
  if (pendingHits.size === 0) return;
  const batch = [...pendingHits.values()];
  pendingHits.clear();
  for (const e of batch) {
    try {
      await queryCacheEntryRepository.upsertHit(
        e.queryConfigId,
        e.paramsKey,
        e.params,
        e.hits,
        e.durationMs
      );
    } catch (err) {
      console.error('[queryCacheService] flushHits lỗi:', err.message);
    }
  }
}

const flushTimer = setInterval(() => flushHits(), FLUSH_INTERVAL_MS);
flushTimer.unref();

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

module.exports = {
  paramsKey,
  get,
  set,
  deleteVariant,
  deleteForQueryConfigId,
  recordHit,
  recordDuration,
  flushHits,
  pendingHits,
};

if (require.main === module) {
  const assert = require('assert');

  const a = module.exports.paramsKey({ year: '2024', region: 'VN' });
  const b = module.exports.paramsKey({ region: 'VN', year: '2024' });
  assert.strictEqual(a, b, 'paramsKey phải độc lập thứ tự key');
  assert.match(a, /^[0-9a-f]{40}$/, 'paramsKey có param -> sha1 hex');
  assert.strictEqual(module.exports.paramsKey({}), '', 'không param -> chuỗi rỗng');
  assert.strictEqual(module.exports.paramsKey({ year: undefined }), '', 'undefined bị bỏ -> chuỗi rỗng');

  (async () => {
    const svc = module.exports;
    const TEST_ID = 999999;
    const env = require('../config/env');

    const probe = require('redis').createClient({
      url: env.redisUrl,
      socket: { connectTimeout: 1000 },
    });
    probe.on('error', () => {});
    try {
      await probe.connect();
      await probe.quit();
    } catch (err) {
      console.log(`queryCacheService self-check: skip phần Redis — không kết nối được ${env.redisUrl} (${err.message})`);
      console.log('queryCacheService self-check: OK (chỉ chạy phần paramsKey)');
      process.exit(0);
    }

    assert.strictEqual(await svc.get(TEST_ID, {}), undefined, 'miss -> undefined');

    const data = { columns: [{ key: 'x', label: 'x', type: 'number' }], rows: [{ x: 1 }] };
    await svc.set(TEST_ID, {}, data);
    assert.deepStrictEqual(await svc.get(TEST_ID, {}), data, 'set rồi get -> đúng data');

    await svc.set(TEST_ID, { year: '2024' }, data);
    await svc.deleteVariant(TEST_ID, svc.paramsKey({}));
    assert.strictEqual(await svc.get(TEST_ID, {}), undefined, 'deleteVariant xoá đúng biến thể');
    assert.deepStrictEqual(await svc.get(TEST_ID, { year: '2024' }), data, 'deleteVariant không đụng biến thể khác');

    await svc.deleteForQueryConfigId(TEST_ID);
    assert.strictEqual(await svc.get(TEST_ID, { year: '2024' }), undefined, 'deleteForQueryConfigId xoá hết');

    svc.pendingHits.clear();
    svc.recordHit(7, { year: '2024' });
    svc.recordHit(7, { year: '2024' }, 150);
    svc.recordHit(7, { year: '2024' });
    svc.recordHit(9, {});
    assert.strictEqual(svc.pendingHits.size, 2, '2 biến thể riêng -> 2 entry');
    const e7 = [...svc.pendingHits.values()].find((x) => x.queryConfigId === 7);
    assert.strictEqual(e7.hits, 3);
    assert.strictEqual(e7.durationMs, 150);
    svc.pendingHits.clear();

    svc.recordDuration(7, { year: '2024' }, 900);
    let d7 = [...svc.pendingHits.values()][0];
    assert.strictEqual(d7.hits, 0, 'recordDuration không cộng hits');
    assert.strictEqual(d7.durationMs, 900);
    svc.recordHit(7, { year: '2024' });
    d7 = [...svc.pendingHits.values()][0];
    assert.strictEqual(d7.hits, 1, 'recordHit sau đó cộng hits lên 1');
    assert.strictEqual(d7.durationMs, 900, 'giữ nguyên durationMs worker đã ghi');
    svc.recordDuration(9, {});
    assert.strictEqual(svc.pendingHits.size, 1, 'recordDuration không durationMs -> no-op');
    svc.pendingHits.clear();

    await svc.flushHits();

    console.log('queryCacheService self-check: OK');
    process.exit(0);
  })();
}
