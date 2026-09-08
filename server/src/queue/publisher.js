// src/queue/publisher.js
// Producer RabbitMQ (amqplib) — đẩy message "làm mới 1 biến thể" vào queue
// `refresh_query` cho worker Dramatiq (Python) tiêu thụ. Body phải đúng
// "envelope" của Dramatiq (dramatiq.Message.asdict) vì worker decode bằng JSON
// encoder mặc định — đây là HỢP ĐỒNG duy nhất giữa 2 phía, KHÔNG share code.
//
// Kết nối lazy + tái dùng 1 confirm channel. KHÔNG assertQueue ở đây: để worker
// Dramatiq khai báo queue (chạy worker ít nhất 1 lần trước khi publish); nếu
// queue chưa tồn tại thì message rơi vào hư không — chấp nhận được vì cache là
// phụ trợ.
//
// Dùng confirm channel + await ack của broker: amqplib đệm sendToQueue, nếu
// tiến trình thoát ngay (vd script enqueue) thì message chưa kịp bay đi. Confirm
// bảo đảm broker đã nhận trước khi publishRefresh() resolve.
//
// ponytail: 1 channel dùng chung, không pool. Đủ cho tần suất publish của scheduler.
const crypto = require('crypto');
const amqp = require('amqplib');
const env = require('../config/env');

const QUEUE = 'refresh_query';
const ACTOR = 'refresh_query';

let channelPromise = null;

async function getChannel() {
  if (!channelPromise) {
    channelPromise = (async () => {
      const conn = await amqp.connect(env.rabbitmqUrl);
      conn.on('error', () => { channelPromise = null; });
      conn.on('close', () => { channelPromise = null; });
      return conn.createConfirmChannel();
    })().catch((err) => { channelPromise = null; throw err; });
  }
  return channelPromise;
}

function buildDramatiqMessage(args) {
  return {
    queue_name: QUEUE,
    actor_name: ACTOR,
    args,
    kwargs: {},
    options: {},
    message_id: crypto.randomUUID(),
    message_timestamp: Date.now(),
  };
}

// message: { query_config_id, params_key, params }
async function publishRefresh(message) {
  const ch = await getChannel();
  const envelope = buildDramatiqMessage([
    message.query_config_id,
    message.params_key,
    message.params,
  ]);
  await new Promise((resolve, reject) => {
    ch.sendToQueue(
      QUEUE,
      Buffer.from(JSON.stringify(envelope)),
      { persistent: true },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

module.exports = { publishRefresh, buildDramatiqMessage, QUEUE };

if (require.main === module) {
  const assert = require('assert');
  const m = buildDramatiqMessage([13, 'abc123', { year: '2024' }]);
  assert.strictEqual(m.queue_name, 'refresh_query');
  assert.strictEqual(m.actor_name, 'refresh_query');
  assert.deepStrictEqual(m.args, [13, 'abc123', { year: '2024' }]);
  assert.deepStrictEqual(m.kwargs, {});
  assert.deepStrictEqual(m.options, {});
  assert.ok(typeof m.message_id === 'string' && m.message_id.length >= 32);
  assert.ok(Number.isFinite(m.message_timestamp));
  console.log('publisher self-check: OK');
}
