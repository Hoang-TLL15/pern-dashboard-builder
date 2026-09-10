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
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    // File rác (worker crash giữa lúc ghi, đĩa đầy...) -> coi như cache miss,
    // caller chạy SQL live. Cache là phụ trợ, không được kéo sập widget.
    if (err instanceof SyntaxError) return undefined;
    throw err;
  }
  const computedAt = new Date(parsed.computed_at).getTime();
  if (Number.isNaN(computedAt) || Date.now() - computedAt > env.cacheFileTtlMs) {
    return undefined;
  }
  return { columns: parsed.columns, rows: parsed.rows };
}

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

module.exports = {
  paramsKey,
  cacheFilePath,
  readFresh,
  recordHit,
  recordDuration,
  flushHits,
  pendingHits,
  deleteFile,
  deleteDir,
};

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

    // file JSON hỏng (worker crash giữa lúc ghi) -> undefined, KHÔNG ném
    fs.writeFileSync(fresh, '{"columns":[],"rows":[');
    assert.strictEqual(await svc.readFresh(1, {}), undefined);

    // computed_at hỏng -> undefined (trước đây NaN lọt qua check TTL)
    fs.writeFileSync(fresh, JSON.stringify({ columns: [], rows: [], computed_at: 'xxx' }));
    assert.strictEqual(await svc.readFresh(1, {}), undefined);

    // recordHit: gộp cùng biến thể vào 1 entry, cộng dồn hits, duration
    // last-write-wins và không bị xoá bởi cache hit không kèm duration.
    svc.pendingHits.clear();
    svc.recordHit(7, { year: '2024' });
    svc.recordHit(7, { year: '2024' }, 150);
    svc.recordHit(7, { year: '2024' }); // cache hit sau đó -> giữ nguyên 150
    svc.recordHit(9, {});
    assert.strictEqual(svc.pendingHits.size, 2, '2 biến thể riêng -> 2 entry');
    const e7 = [...svc.pendingHits.values()].find((x) => x.queryConfigId === 7);
    assert.strictEqual(e7.hits, 3);
    assert.strictEqual(e7.durationMs, 150);
    svc.pendingHits.clear();

    // recordDuration: ghi durationMs, KHÔNG cộng hits (lượt worker refresh)
    svc.recordDuration(7, { year: '2024' }, 900);
    let d7 = [...svc.pendingHits.values()][0];
    assert.strictEqual(d7.hits, 0, 'recordDuration không cộng hits');
    assert.strictEqual(d7.durationMs, 900);
    svc.recordHit(7, { year: '2024' }); // lượt người dùng sau đó trong cùng chu kỳ
    d7 = [...svc.pendingHits.values()][0];
    assert.strictEqual(d7.hits, 1, 'recordHit sau đó cộng hits lên 1');
    assert.strictEqual(d7.durationMs, 900, 'giữ nguyên durationMs worker đã ghi');
    svc.recordDuration(9, {}); // durationMs undefined -> bỏ qua, không tạo entry
    assert.strictEqual(svc.pendingHits.size, 1, 'recordDuration không durationMs -> no-op');
    svc.pendingHits.clear();

    // flushHits rỗng -> no-op, không ném
    await svc.flushHits();

    console.log('queryCacheService self-check: OK');
  })();
}
