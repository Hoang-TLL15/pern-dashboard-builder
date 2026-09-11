// src/queue/cacheScheduler.js
// Hẹn giờ nền cho cache biến thể hot. Khởi động 1 lần từ app.js khi
// CACHE_SCHEDULER_ENABLED=1. Dùng node-cron: lịch theo GIỜ ĐỒNG HỒ THẬT
// (timezone Asia/Ho_Chi_Minh), không phụ thuộc uptime tính từ lúc khởi động.
//
// Cron chỉ chạy khi tiến trình đang sống đúng thời điểm — server tắt lúc 3h
// sáng thì job hôm đó mất. Bù lại: ~30s sau khi server bật, quét 1 lượt
// enqueue + cleanup (cả 2 idempotent trong ngày). KHÔNG quét bù decay ở đây —
// decay halve toàn bộ hit_count, restart nhiều lần sẽ triệt tiêu hết; decay
// chỉ chạy ở cron Chủ nhật.
//
// ponytail: lịch hardcode, không đưa vào env — 3 mốc này gần như không đổi.
const cron = require('node-cron');
const queryCacheEntryRepository = require('../repositories/queryCacheEntryRepository');
const queryCacheService = require('../services/queryCacheService');
const publisher = require('./publisher');

const TZ = 'Asia/Ho_Chi_Minh';
const DAY_MS = 24 * 60 * 60 * 1000;

const TOP_N = 10;
const READ_WINDOW_MS = 7 * DAY_MS; // chỉ enqueue biến thể còn được đọc trong 7 ngày
const IDLE_MS = 14 * DAY_MS; // biến thể idle quá 14 ngày -> xoá dòng + file

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
    await queryCacheService.deleteVariant(s.queryConfigId, s.paramsKey);
  }
  console.log(`[cacheScheduler] cleanup ${stale.length} biến thể idle`);
}

// Bọc mỗi job: 1 job lỗi không kéo sập job khác, không để unhandledRejection
// thoát ra từ callback của node-cron.
async function runJob(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[cacheScheduler] ${name} lỗi:`, err.message);
  }
}

function start() {
  // enqueue top-N: 3h00 mỗi ngày | cleanup: 3h30 mỗi ngày | decay: 4h00 Chủ nhật
  cron.schedule('0 3 * * *', () => runJob('enqueueTopN', enqueueTopN), { timezone: TZ });
  cron.schedule('30 3 * * *', () => runJob('cleanup', cleanup), { timezone: TZ });
  cron.schedule('0 4 * * 0', () => runJob('decay', decay), { timezone: TZ });

  // Quét bù sau khi server bật (bù cho khoảng server tắt). Delay để không giành
  // tài nguyên lúc khởi động; unref để timer này không giữ tiến trình sống.
  setTimeout(() => {
    runJob('enqueueTopN', enqueueTopN);
    runJob('cleanup', cleanup);
  }, 5_000).unref();

  console.log(`[cacheScheduler] cron đã đặt (tz ${TZ})`);
}

module.exports = { start, enqueueTopN, decay, cleanup };
