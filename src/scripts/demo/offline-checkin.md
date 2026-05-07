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
4. Confirm the items remain in the local queue.
5. Disable airplane mode.
6. Trigger sync from the mobile app.

Expected result: queued scans are sent as one batch and receive
`accepted`, `duplicates`, or `invalid` item-level results.

## Scenario D: tampered QR

1. Copy a valid QR token.
2. Change one character in the token payload or signature.
3. Submit it through the app or through `POST /checkin/batch`.

Expected result: item result is `invalid_signature`.

## Scenario E: wrong room

1. In Admin Web, assign the staff member to a room for one workshop.
2. Scan a registration QR for a different room during that shift.

Expected result: backend returns `wrong_room` for that item. Current backend
implements the check in `CheckinService`; the UI must surface the item-level
result to the staff user.

## Known implementation notes

- Backend supports offline-safe batch idempotency today.
- Mobile currently persists scans locally and can submit batches.
- Full spec-level offline verification requires cached JWKS, RS256 verification
  on-device, network-change auto-sync, and logout blocking when the queue is not
  empty. Use this runbook to demonstrate the current queue/sync behavior and to
  identify remaining mobile-side gaps.
