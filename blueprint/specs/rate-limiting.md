# Đặc tả: Rate Limiting (Kiểm soát tải đột biến)

## Mô tả

Cơ chế kiểm soát tốc độ request để bảo vệ backend khỏi:

- **Tải đột biến**: 12K SV truy cập trong 10 phút khi mở đăng ký, 60% trong 3 phút đầu.
- **Bot / auto-clicker** spam đăng ký để chiếm chỗ.
- **Người dùng vô tình** retry quá nhanh khi mạng chậm.

Yêu cầu chính:

- Đảm bảo 1 SV không thể chiếm tài nguyên của nhiều SV khác.
- Endpoint đăng ký vẫn giữ tinh thần **FCFS** khi vượt giới hạn global.
- Khi quá tải, hệ thống degrade có kiểm soát thay vì làm sập backend.

Giải pháp chọn:

- **Token Bucket** bằng Redis Lua cho per-IP, per-user, per-endpoint.
- **Sliding Window Counter** cho ngưỡng global system-wide.
- **Redis FIFO queue ngắn hạn** cho `POST /registrations` khi global threshold bị chạm.

## Luồng chính

### A. Request đi qua RateLimitGuard

1. Client gửi request đến Backend qua Nginx.
2. Backend xác định scope:
   - Anonymous: theo IP.
   - Authenticated: theo `userId`.
   - Endpoint nhạy cảm: thêm bucket riêng cho route.
3. `RateLimitGuard` build Redis key, ví dụ:
   - `ratelimit:ip:1.2.3.4:site`
   - `ratelimit:user:{userId}:registrations`
   - `ratelimit:user:{userId}:payments`
4. Guard gọi Lua script trên Redis để refill token và trừ token atomically.
5. Nếu còn token:
   - Request đi tiếp đến controller.
   - Response kèm header `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
6. Nếu hết token:
   - Backend trả `429 Too Many Requests`.
   - Response kèm `Retry-After`.

### B. Cấu hình bucket

| #     | Phạm vi                                  |  Capacity |    Refill rate | Khi vượt            |
| ----- | ---------------------------------------- | --------: | -------------: | ------------------- |
| RL-01 | Per-IP toàn site                         |        60 |        30/phút | 429 + `Retry-After` |
| RL-02 | Per-user authenticated toàn site         |       120 |        60/phút | 429                 |
| RL-03 | Per-user trên `POST /registrations`      |         5 |      1/10 giây | 429                 |
| RL-04 | Per-user trên `POST /payments`           |        10 |         5/phút | 429                 |
| RL-05 | Per-IP trên `POST /auth/login`           |        10 |         1/phút | 429                 |
| RL-06 | Global trên `POST /registrations`        | 500 req/s | Sliding Window | 202 + queue FIFO    |
| RL-07 | Per-user trên `POST /workshops/{id}/pdf` |         5 |         1/phút | 429                 |

### C. Lua script Token Bucket

```lua
-- KEYS[1] = bucket key, ví dụ "ratelimit:user:abc:registrations"
-- ARGV[1] = capacity
-- ARGV[2] = refill_per_sec
-- ARGV[3] = now_ms
-- ARGV[4] = cost

local data = redis.call("HMGET", KEYS[1], "tokens", "last_refill")
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local tokens = tonumber(data[1]) or capacity
local last = tonumber(data[2]) or now_ms
local elapsed = (now_ms - last) / 1000.0

tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call("HMSET", KEYS[1], "tokens", tokens, "last_refill", now_ms)
redis.call("EXPIRE", KEYS[1], math.ceil(capacity / refill) * 2 + 60)

local retry_after = 0
if allowed == 0 then
  retry_after = math.ceil((cost - tokens) / refill)
end

return { allowed, tokens, retry_after }
```

### D. Global registration queue

Khi global threshold trên `POST /registrations` vượt 500 req/s:

1. Backend vẫn chạy per-user bucket trước để loại bot.
2. Nếu user hợp lệ nhưng global threshold đã đầy:
   - Ghi request metadata vào `regqueue:{workshopId}` với TTL 10 giây.
   - Tạo `processingId`.
   - Trả `202 Accepted`.
3. Client polling `GET /registrations/processing/{processingId}`.
4. Registration worker xử lý FIFO tối đa 500 item/giây.
5. Kết quả cuối cùng là:
   - `201 CONFIRMED` hoặc `201 PENDING_PAYMENT`.
   - `409 sold_out`.
   - `409 already_registered`.
   - `422 invalid_state`.

Response khi vào queue:

```json
{
  "status": "QUEUED",
  "processingId": "uuid",
  "estimatedWaitMs": 3000
}
```

### E. Tích hợp vào NestJS

```ts
@UseGuards(JwtAuthGuard, RolesGuard, RateLimitGuard)
@RateLimit({ scope: 'user', bucket: 'registrations', capacity: 5, refillPerSec: 0.1 })
@Post('/registrations')
create(...) {}
```

Guard set headers:

- `X-RateLimit-Limit: 5`
- `X-RateLimit-Remaining: 3`
- `Retry-After: 7` nếu bị 429

## Kịch bản lỗi

| Tình huống                            | Phản ứng                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| Per-user bucket hết token             | 429 `rate_limited`, có `Retry-After`                                            |
| Global registration limit vượt ngưỡng | 202 `QUEUED`, client polling kết quả                                            |
| Queue đầy hoặc TTL 10 giây hết        | 503 `registration_queue_full`, client retry sau                                 |
| Bot spam 100 request/giây từ 1 user   | RL-03 chặn trước khi vào queue                                                  |
| Bot đổi IP nhưng cùng user            | Per-user bucket vẫn chặn                                                        |
| Anonymous spam catalog                | Per-IP toàn site chặn                                                           |
| Redis down                            | Fallback in-memory bucket per-instance + giảm global capacity an toàn           |
| Lua script lỗi                        | Fail-closed với endpoint ghi quan trọng; fail-open có log với catalog read-only |
| Client retry do mạng                  | Frontend backoff exponential với jitter ±20%                                    |

## Ràng buộc

- **Hiệu năng**:
  - Rate limit check p95 < 5 ms khi Redis khoẻ.
  - Token Bucket dùng O(1) memory per active bucket.
  - Global registration worker xử lý tối đa 500 item/giây để bảo vệ DB.
- **Công bằng**:
  - Per-user bucket chạy trước global queue.
  - Global queue xử lý FIFO theo thời điểm request được chấp nhận vào queue.
  - Không dùng 503 cho request đã được xếp hàng; request đã queue phải trả 202.
- **Khả dụng**:
  - Redis down không làm toàn site sập; fallback in-memory chỉ là chế độ degrade.
  - Catalog đọc có thể fail-open có kiểm soát, nhưng đăng ký/thanh toán phải fail-closed hoặc giảm ngưỡng.
- **Quan sát**:
  - Metrics: `rate_limit_rejected_total{scope}`, `rate_limit_allowed_total{scope}`, `registration_queue_size`, `registration_queue_wait_ms`.
  - Log có `scope`, `userId/ip`, `retryAfterSec`, `processingId` nếu vào queue.

## Tiêu chí chấp nhận

- [ ] AC-01: 1 user gửi 6 POST `/registrations` liên tiếp → 5 request đầu đi tiếp, lần 6 trả 429 với `Retry-After`.
- [ ] AC-02: Sau 10 giây, user gửi tiếp → OK vì bucket refill 1 token.
- [ ] AC-03: 1 IP gửi 100 request/phút vào catalog → 60 OK, 40 trả 429.
- [ ] AC-04: Brute force `POST /auth/login` 11 lần/phút từ 1 IP → lần 11 trả 429.
- [ ] AC-05: Load test k6 với 3000 vRPS/60s vào `/registrations` → backend không crash, request vượt global threshold nhận 202 và được xử lý FIFO.
- [ ] AC-06: Queue đầy hoặc item quá TTL → trả 503 `registration_queue_full`, không tạo registration ngầm.
- [ ] AC-07: Headers `X-RateLimit-Remaining`, `X-RateLimit-Limit`, `Retry-After` xuất hiện đúng.
- [ ] AC-08: Tắt Redis → fallback in-memory hoạt động và log cảnh báo cho SYS_ADMIN.
- [ ] AC-09: Lua script atomic — 100 client cùng trừ bucket cap=10 → đúng 10 request thắng.
- [ ] AC-10: Metrics `rate_limit_rejected_total{scope}` và `registration_queue_size` expose ở `/metrics`.
