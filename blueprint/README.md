# UniHub Workshop — Blueprint

Tài liệu thiết kế hệ thống cho đồ án môn Thiết kế Phần mềm (TKPM), HCMUS.

Diagram images in `design.md` and `specs/*.md` now use high-resolution public ImgBB PNG URLs for stable online Markdown/PDF rendering; local white-background PNG fallback remains in `assets/diagrams-png/`.

## Cấu trúc thư mục

```
blueprint/
|-- assets/
|   |-- diagrams/                 # SVG source/original render assets
|   |-- diagrams-png/             # High-resolution white-background PNG local fallback
|   `-- imgbb-diagram-urls.json  # Public ImgBB URL mapping for 23 diagrams
|-- README.md                     # File nay
|-- proposal.md                   # Boi canh, muc tieu, pham vi, rui ro
|-- design.md                     # Kien truc, C4, HLA, DB, RBAC, co che bao ve, ADR
`-- specs/
    |-- auth.md
    |-- workshop-catalog.md
    |-- registration.md
    |-- payment.md
    |-- notification.md
    |-- checkin.md
    |-- ai-summary.md
    |-- csv-sync.md
    |-- rate-limiting.md
    |-- circuit-breaker.md
    `-- idempotency.md
```

## Cách đọc

1. **`proposal.md`** — Đọc trước để hiểu vấn đề và mục tiêu của hệ thống.
2. **`design.md`** — Tài liệu trung tâm: kiến trúc tổng thể, C4 diagrams (Level 1 + 2), High-Level Architecture, thiết kế CSDL, RBAC, 3 cơ chế bảo vệ, và 11 ADR.
3. **`specs/*.md`** — Đặc tả chi tiết từng tính năng. Mỗi file có cấu trúc:
   - Mô tả
   - Luồng chính (sequence diagrams)
   - Kịch bản lỗi
   - Ràng buộc
   - Tiêu chí chấp nhận (checklist)

## Mapping yêu cầu đề bài → tài liệu

| Yêu cầu đề bài | Tài liệu |
|---|---|
| 1. Tài liệu thiết kế hệ thống | `design.md` §1 |
| 2. C4 Diagram (Level 1 + 2) | `design.md` §2 |
| 3. High-Level Architecture Diagram | `design.md` §3 |
| 4. Thiết kế cơ sở dữ liệu | `design.md` §4 |
| 5. Mô tả luồng nghiệp vụ quan trọng (≥ 2) | `design.md` §5 (đăng ký có phí, check-in offline, CSV import) |
| 6. Thiết kế kiểm soát truy cập | `design.md` §6, `specs/auth.md` |
| 7. Cơ chế bảo vệ hệ thống | `design.md` §7, `specs/{rate-limiting,circuit-breaker,idempotency}.md` |
| ADR (quyết định kỹ thuật) | `design.md` §8 |

## Mapping vấn đề kỹ thuật → giải pháp

| Vấn đề | Giải pháp | Tài liệu |
|---|---|---|
| Tranh chấp chỗ ngồi | Atomic `DECR` Redis + DB UNIQUE | `specs/registration.md` |
| Tải đột biến (12K SV/10 phút) | Token Bucket (Redis Lua) + queue FCFS | `specs/rate-limiting.md` |
| Cổng thanh toán không ổn định | Circuit Breaker 3-state + Graceful Degradation | `specs/circuit-breaker.md` |
| Trừ tiền 2 lần | Idempotency Key (Redis 24h + bảng `idempotency_keys` + UNIQUE trên payment) | `specs/idempotency.md` |
| Check-in offline | SQLite local + sync batch idempotent | `specs/checkin.md` |
| Tích hợp 1 chiều CSV | Cron + staging + UPSERT idempotent + quarantine | `specs/csv-sync.md` |
| Notification mở rộng | Strategy pattern (channel adapter) | `specs/notification.md` |
| AI Summary | Async pipeline + cache theo SHA-256 | `specs/ai-summary.md` |

## Phiên bản

- **v1.0** — 2026-04-25 — Bản đầu cho phần 1 đồ án.

## Tác giả

- Thắng — Auth, Catalog, Registration, Rate Limiting (Lead)
- Đức — Payment, Notification, Circuit Breaker, Idempotency
- Hưng — Check-in (Offline), AI Summary, CSV Sync
