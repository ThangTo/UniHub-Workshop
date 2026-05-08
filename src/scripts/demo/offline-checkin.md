# Phase 8 Demo: Offline Check-in

This runbook demonstrates the check-in path from `blueprint/specs/checkin.md`
using the Expo app plus backend `POST /checkin/batch`.

## Preconditions

- Infra, backend, and mobile app are running.
- Seed data exists: `pnpm db:seed`.
- Staff account exists: `staff@unihub.local / Test@12345`.
- A student has a `CONFIRMED` registration with a visible QR token in Student Web.
- For a strict wrong-room demo, create a `Room` and `StaffRoomAssignment` in Admin Web.

Recommended terminals from `src/`:

```powershell
pnpm infra:up
pnpm --filter ./apps/backend dev
pnpm --filter ./apps/mobile start
```

## Scenario A: normal online scan

1. Open the mobile app.
2. Set API URL to `http://<your-lan-ip>:3000`, not `localhost` when using a physical phone.
3. Login as `staff@unihub.local / Test@12345`.
4. Scan a valid student QR.
5. Confirm that the app queues the scan and syncs it to `/checkin/batch`.
6. In the database, verify exactly one row:

```sql
select registration_id, scanned_at, device_id
from checkins
order by synced_at desc
limit 5;
```

Expected result: first scan is `accepted`.

## Scenario B: duplicate QR

1. Scan the same QR again.
2. Sync the queue.

Expected result: backend returns the item under `duplicates`; database still has
one `checkins` row because of `UNIQUE (registration_id)` and
`UNIQUE (idempotency_key)`.

## Scenario C: offline queue

1. Login while online.
2. Enable airplane mode or disconnect the phone from Wi-Fi.
3. Scan one or more QR codes.
4. Confirm the items remain in the local queue as `pending`.
5. Disable airplane mode.
6. The app should auto-sync through NetInfo. You can also tap `Sync N`.

Expected result: queued scans are sent as one batch and receive
`accepted`, `duplicates`, or `invalid` item-level results.

## Scenario D: tampered QR

1. Copy a valid QR token.
2. Change one character in the token payload or signature.
3. Paste it into the mobile app while offline.

Expected result: the app rejects it locally before inserting into SQLite.

## Scenario E: wrong room

1. In Admin Web, assign the staff member to a room for one workshop.
2. Scan a registration QR for a different room during that shift.

Expected result: while online, the app calls `/registrations/{regId}/verify`
before queueing and shows an assignment warning. If the item is submitted,
backend returns `wrong_room` or `not_assigned`, and the app stores the item-level
result in the local queue.

## Known implementation notes

- Backend supports offline-safe batch idempotency today.
- Mobile enables SQLite WAL mode and stores a durable queue.
- Mobile caches `GET /auth/jwks` after login and verifies QR JWT RS256 offline
  with the cached public key.
- Mobile auto-syncs when NetInfo reports the network is back.
- Mobile warns before logout when the queue still has unsynced scans.
