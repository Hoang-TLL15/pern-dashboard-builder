// src/queue/cacheScheduler.js
// Hẹn giờ nền cho cache biến thể hot. Khởi động 1 lần từ app.js khi
// CACHE_SCHEDULER_ENABLED=1. KHÔNG phải cron thật — mỗi job tự nhớ mốc chạy
// gần nhất trong RAM, tick mỗi giờ xem tới hạn chưa. Đủ cho bài toán này.
//
// ponytail: mốc chạy giữ trong RAM -> restart server thì cả 3 job chạy lại
// ngay 1 nhịp. Chấp nhận được (enqueue lại top-N chỉ tốn vài message; decay/
// cleanup idempotent trong ngày). Nâng cấp: lưu mốc vào 1 bảng nếu cần.
const queryCacheEntryRepository = require('../repositories/queryCacheEntryRepository');
const queryCacheService = require('../services/queryCacheService');
const publisher = require('./publisher');

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;

const TOP_N = 20;
const READ_WINDOW_MS = 7 * DAY_MS; // chỉ enqueue biến thể còn được đọc trong 7 ngày
const DECAY_EVERY_MS = 7 * DAY_MS;
const IDLE_MS = 14 * DAY_MS; // biến thể idle quá 14 ngày -> xoá dòng + file

let lastEnqueue = 0;
let lastDecay = 0;
let lastCleanup = 0;

async function enqueueTopN() {
  const since = new Date(Date.now() - READ_WINDOW_MS);
  const entries = await queryCacheEntryRepository.findTopN(TOP_N, since);
  for (const e of entries) {
    await publisher.publishRefresh({
      query_config_id: e.queryConfigId,
      params_key: e.paramsKey,
      params: e.params,
    });
  }
  console.log(`[cacheScheduler] enqueue ${entries.length} biến thể hot`);
}

async function decay() {
  await queryCacheEntryRepository.halveAllHitCounts();
  console.log('[cacheScheduler] decay: hit_count /= 2');
}

async function cleanup() {
  const stale = await queryCacheEntryRepository.deleteIdle(new Date(Date.now() - IDLE_MS));
  for (const s of stale) {
    await queryCacheService.deleteFile(s.queryConfigId, s.paramsKey);
  }
  console.log(`[cacheScheduler] cleanup ${stale.length} biến thể idle`);
}

async function tick() {
  const now = Date.now();
  try {
    if (now - lastEnqueue >= DAY_MS) { lastEnqueue = now; await enqueueTopN(); }
    if (now - lastDecay >= DECAY_EVERY_MS) { lastDecay = now; await decay(); }
    if (now - lastCleanup >= DAY_MS) { lastCleanup = now; await cleanup(); }
  } catch (err) {
    console.error('[cacheScheduler] tick lỗi:', err.message);
  }
}

function start() {
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  tick();
  return timer;
}

module.exports = { start, tick, enqueueTopN, decay, cleanup };
