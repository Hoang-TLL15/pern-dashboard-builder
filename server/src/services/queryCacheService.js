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

// get()/set() được await NGAY TRÊN request path, nên mọi đường Redis hỏng đều
// phải fail nhanh, không được treo:
// - reconnectStrategy: false — mặc định node-redis retry kết nối vô hạn, khiến
//   connect() không bao giờ settle và try/catch bên dưới vô dụng (đo được: mặc
//   định treo > 6s và không dừng; với false thì reject sau ~6ms).
// - disableOfflineQueue: true — chặn nốt đường lệnh phát ra lúc socket mất kết
//   nối bị xếp hàng chờ thay vì reject.
// Đánh đổi: client không tự hồi phục, nên quên nó đi mỗi lần đứt để lượt sau
// dựng client mới — Redis sống lại là cache tự chạy lại.
// getClient() trả null khi Redis không dùng được — caller coi như miss/no-op.
const RETRY_COOLDOWN_MS = 5_000;
let clientPromise = null;
let nextRetryAt = 0;

function getClient() {
  if (!clientPromise) {
    // Redis vừa chết: đừng dựng socket mới cho TỪNG request (1 report = hàng
    // chục widget -> hàng chục lần thử). Nghỉ rồi thử lại; trong lúc nghỉ trả
    // null, không log (lỗi gốc đã log 1 lần ở handler 'error' bên dưới).
    if (Date.now() < nextRetryAt) {
      return Promise.resolve(null);
    }

    const client = createClient({
      url: env.redisUrl,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
    const forget = () => {
      clientPromise = null;
      nextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
    };
    // Chỗ DUY NHẤT log lỗi kết nối — node-redis phát 'error' đúng 1 lần cho cả
    // bị từ chối lẫn timeout (đã đo). `|| err.code`: localhost phân giải ra cả
    // ::1 lẫn 127.0.0.1 nên lỗi bị từ chối là AggregateError với message RỖNG.
    client.on('error', (err) => {
      console.error('[queryCacheService] Redis lỗi:', err.message || err.code);
      forget();
    });
    client.on('end', forget);
    clientPromise = client.connect().then(
      () => client,
      () => {
        forget();
        return null;
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
    if (!client) return undefined;
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
    if (!client) return;
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
    if (!client) return;
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
    if (!client) return;
    const pattern = cacheKey(queryConfigId, '*');
    // scanIterator yield từng MẢNG key (batch), không phải từng key. Trang rỗng
    // là bình thường với SCAN — del([]) sẽ ném lỗi, bị catch nuốt và bỏ dở các
    // trang sau, để lại cache cũ của query vừa sửa.
    for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 1000 })) {
      if (keys.length) await client.del(keys);
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

    // reconnectStrategy: false vì lý do y hệt getClient() — thiếu nó thì probe
    // retry vô hạn, connect() không settle và self-check treo thay vì in "skip".
    const probe = require('redis').createClient({
      url: env.redisUrl,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    probe.on('error', () => {});
    try {
      await probe.connect();
      await probe.quit();
    } catch (err) {
      console.log(`queryCacheService self-check: skip phần Redis — không kết nối được ${env.redisUrl} (${err.message || err.code})`);
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

    // Đủ nhiều biến thể để SCAN phải chạy nhiều trang và gặp trang rỗng — bản
    // trước dừng ngay ở trang rỗng nên để sót key, mà 1 key thì test không thấy.
    const MANY = 50;
    for (let i = 0; i < MANY; i++) await svc.set(TEST_ID, { i: String(i) }, data);
    await svc.deleteForQueryConfigId(TEST_ID);
    for (let i = 0; i < MANY; i++) {
      assert.strictEqual(
        await svc.get(TEST_ID, { i: String(i) }),
        undefined,
        `deleteForQueryConfigId phải xoá hết mọi biến thể (sót biến thể ${i})`
      );
    }

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
