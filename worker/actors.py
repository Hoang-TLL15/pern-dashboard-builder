"""Worker Dramatiq cho cache biến thể query hot.

Nhận message { query_config_id, params_key, params } từ RabbitMQ, gọi endpoint
nội bộ của Node để chạy SQL live, rồi ghi kết quả ra file JSON (atomic: .tmp +
os.replace). KHÔNG biết SQL / driver / credentials — Node lo hết.
Xem docs/query-file-cache-queue-design.md.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import dramatiq
import httpx
from dotenv import load_dotenv
from dramatiq.brokers.rabbitmq import RabbitmqBroker

load_dotenv()

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
NODE_INTERNAL_URL = os.environ.get("NODE_INTERNAL_URL", "http://localhost:4000")
INTERNAL_API_SECRET = os.environ["INTERNAL_API_SECRET"]
CACHE_DIR = Path(os.environ["CACHE_DIR"])  # bắt buộc — phải khớp env.cacheDir của Node

dramatiq.set_broker(RabbitmqBroker(url=RABBITMQ_URL))


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

    dest = CACHE_DIR / str(query_config_id) / f"{params_key or '_'}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_text(
        json.dumps(
            {
                "columns": payload["columns"],
                "rows": payload["rows"],
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }
        ),
        encoding="utf-8",
    )
    os.replace(tmp, dest)  # atomic — Node không bao giờ đọc file dở
