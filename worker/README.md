# Query cache worker (Dramatiq)

Chạy sẵn các biến thể query hot ra file JSON cho server Node đọc.
Thiết kế: `../docs/query-file-cache-queue-design.md`.

## Chạy

1. RabbitMQ: từ repo root `docker compose up -d rabbitmq` (UI http://localhost:15672, guest/guest).
2. `cd worker`
3. `python -m venv .venv` rồi kích hoạt:
   - Windows PowerShell: `.venv\Scripts\Activate.ps1`
   - Git Bash: `source .venv/Scripts/activate`
4. `pip install -r requirements.txt`
5. `cp .env.example .env` rồi sửa:
   - `INTERNAL_API_SECRET` cho khớp `server/.env`
   - `CACHE_DIR` cho khớp `env.cacheDir` của server (đường tuyệt đối là chắc nhất)
6. `dramatiq actors` — Dramatiq nạp module `actors.py`, tự khai báo queue `refresh_query`,
   bắt đầu tiêu thụ. Chạy nhiều tiến trình: `dramatiq actors --processes 2`.

## Test nhanh

Với server Node đang chạy (`INTERNAL_API_SECRET` đã set) và worker đang chạy:

```
cd ../server
node scripts/enqueueRefresh.js 3
```

→ file `server/.query-cache/3/_.json` xuất hiện, nội dung `{ columns, rows, computed_at }`.
