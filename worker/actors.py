"""Worker Dramatiq cho cache biến thể query hot.

Nhận message { query_config_id, params_key, params } từ RabbitMQ, gọi endpoint
nội bộ của Node để chạy SQL live, rồi ghi kết quả vào Redis (key
cache:<query_config_id>:<params_key>, TTL riêng của worker — dài hơn TTL Node
tự ghi khi user request miss cache, xem queryCacheService.js). KHÔNG biết SQL /
driver / credentials — Node lo hết.
Xem docs/superpowers/specs/2026-09-11-redis-query-cache-design.md.
"""
import json
import os

import dramatiq
import httpx
import redis
from dotenv import load_dotenv
from dramatiq.brokers.rabbitmq import RabbitmqBroker

load_dotenv()

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
NODE_INTERNAL_URL = os.environ.get("NODE_INTERNAL_URL", "http://localhost:4000")
INTERNAL_API_SECRET = os.environ["INTERNAL_API_SECRET"]
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
CACHE_TTL_WARM_SECONDS = int(os.environ.get("CACHE_TTL_WARM_SECONDS", 24 * 60 * 60))

dramatiq.set_broker(RabbitmqBroker(url=RABBITMQ_URL))
redis_client = redis.from_url(REDIS_URL)


@dramatiq.actor(queue_name="refresh_query", max_retries=3)
def refresh_query(query_config_id, params_key, params):
    resp = httpx.post(
        f"{NODE_INTERNAL_URL}/api/internal/refresh-cache",
        json={"queryConfigId": query_config_id, "params": params or {}},
        headers={"x-internal-secret": INTERNAL_API_SECRET},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()

    key = f"cache:{query_config_id}:{params_key or '_'}"
    value = json.dumps({"columns": payload["columns"], "rows": payload["rows"]})
    try:
        redis_client.set(key, value, ex=CACHE_TTL_WARM_SECONDS)
    except redis.RedisError as err:
        # Redis là phụ trợ — mất pre-warm của lượt này không đáng để Dramatiq retry.
        print(f"[actors] Redis set lỗi: {err}")
