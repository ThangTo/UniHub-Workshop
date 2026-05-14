# UniHub Workshop - Huong Dan Test Mobile Expo Tu Dau

Tai lieu nay danh cho nguoi chua quen Expo. Muc tieu la chay app
`apps/mobile`, login staff, scan QR online/offline, va chung minh cac acceptance
criteria check-in trong `blueprint/specs/checkin.md`.

## 1. Mobile App Nay Lam Gi?

App mobile la app cho nhan vien check-in:

- Login bang tai khoan `CHECKIN_STAFF`.
- Cache public key tu `GET /auth/jwks`.
- Verify QR JWT RS256 offline.
- Luu queue vao SQLite voi WAL mode.
- Scan bang camera hoac paste QR token thu cong.
- Sync batch len `POST /checkin/batch` khi online.
- Tu dong sync lai khi co mang bang NetInfo.
- Canh bao khi logout ma van con queue chua sync.

## 2. Cai Dat Cong Cu

### 2.1 Cai Node.js va pnpm

Can Node.js 20+ va pnpm 9+.

```powershell
node -v
pnpm -v
```

Neu chua co pnpm:

```powershell
corepack enable
corepack prepare pnpm@9.7.0 --activate
```

### 2.2 Cai Expo Go tren dien thoai

Dung mot trong hai cach:

- Android: vao Google Play, cai `Expo Go`.
- iPhone: vao App Store, cai `Expo Go`.

Mobile app dang dung Expo SDK 54, tuong thich voi Expo Go hien tai.

May tinh va dien thoai nen cung mot Wi-Fi.

### 2.3 Neu dung emulator

Android emulator:

- Cai Android Studio.
- Tao AVD.
- API URL trong app dung: `http://10.0.2.2:3000`

iOS simulator tren macOS:

- API URL thuong dung: `http://localhost:3000`

Windows + physical phone:

- API URL khong duoc dung `localhost`.
- Phai dung IPv4 cua may tinh, vi du: `http://192.168.1.23:3000`.

Lay IP tren Windows:

```powershell
ipconfig
```

Tim dong `IPv4 Address` cua Wi-Fi adapter.

Neu dien thoai khong goi duoc backend:

- Dam bao cung Wi-Fi.
- Cho phep Windows Firewall mo port 3000.
- Thu mo `http://<IPv4>:3000/health` tren trinh duyet cua dien thoai.

### 2.4 Mobile Co Can `.env` Khong?

Mobile app hien khong bat buoc tao `.env`. Man hinh login co o `API Base URL`;
ban nhap URL backend theo moi truong dang dung:

- Dien thoai that: `http://<IPv4-cua-may-tinh>:3000`
- Android emulator: `http://10.0.2.2:3000`
- iOS simulator: `http://localhost:3000`

Sau khi login, app se luu API URL nay lai bang AsyncStorage. Chi tiet cac env
khac cua he thong nam o `docs/ENVIRONMENT.md`.

## 3. Start Backend Va Web De Tao QR

Tu thu muc `src`:

```powershell
cd d:\HCMUS\Nam_3\HK2\TKPM\Project\UniHubWorkshop\src
pnpm stack:up
docker compose --profile all exec backend pnpm run seed
```

Kiem tra:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Mo web:

- Student Web: http://localhost:5173
- Admin Web: http://localhost:5174

Tai khoan seed:

| Vai tro | Email | Password |
| --- | --- | --- |
| Staff | `staff@unihub.local` | `Test@12345` |
| Organizer | `organizer@unihub.local` | `Test@12345` |
| Admin | `admin@unihub.local` | `Admin@123456` |

## 4. Tao Registration Co QR De Scan

Can co mot sinh vien da `CONFIRMED` registration.

### Cach A: Dung Student Web

1. Mo http://localhost:5173.
2. Register tai khoan sinh vien moi.
3. Dung MSSV co san, vi du `21120004`.
4. Login.
5. Chon workshop mien phi hoac workshop co phi.
6. Register.
7. Neu workshop co phi, thanh toan.
8. Vao My Registrations.
9. Mo QR/token cua registration da `CONFIRMED`.

### Cach B: Dung Admin Web tao workshop nhanh

1. Mo http://localhost:5174.
2. Login organizer/admin.
3. Tao workshop fee = 0, capacity > 0, start trong tuong lai.
4. Publish.
5. Qua Student Web dang ky workshop do.

## 5. Start Expo App

Tu thu muc mobile app:

```powershell
cd d:\HCMUS\Nam_3\HK2\TKPM\Project\UniHubWorkshop\src\apps\mobile
npx expo start
```

Expo CLI se hien QR cho development server.

### Chay tren physical phone

1. Mo Expo Go tren dien thoai.
2. Quet QR cua Expo CLI.
3. Cho app load JS bundle.

Neu QR Expo khong load duoc:

```powershell
npx expo start --tunnel
```

Luu y: tunnel chi giup load app JS. API URL van nen tro ve backend cua may tinh,
vi du `http://192.168.1.23:3000`.

### Chay tren Android emulator

1. Mo Android emulator.
2. Chay:

```powershell
npx expo start --android
```

3. Trong app, API Base URL dung:

```text
http://10.0.2.2:3000
```

## 6. Login Mobile

Trong mobile app:

1. API Base URL:
   - Physical phone: `http://<IPv4-may-tinh>:3000`
   - Android emulator: `http://10.0.2.2:3000`
   - iOS simulator: `http://localhost:3000`
2. Email: `staff@unihub.local`
3. Password: `Test@12345`
4. Bam Login.

Expected:

- Login thanh cong.
- App tai va cache JWKS.
- App luu auth token vao SecureStore.
- App tao deviceId va luu vao AsyncStorage.

Neu login fail:

- Kiem tra backend health.
- Kiem tra API Base URL co dung IP khong.
- Thu mo `http://<api-url>/health` tren browser cua dien thoai.
- Kiem tra seed da chay chua.

## 7. Test Online Scan

1. Dam bao dien thoai dang online.
2. Cho phep camera permission khi app hoi.
3. Bam mo scanner.
4. Quet QR registration `CONFIRMED`.

Expected:

- App verify QR signature.
- Neu online, app co the verify voi backend.
- Scan duoc them vao queue.
- Sync len backend.
- Item hien result `accepted`.

Kiem tra DB:

```powershell
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select registration_id, device_id, scanned_at from checkins order by scanned_at desc limit 5;"
```

Expected:

- Co 1 row check-in moi.

## 8. Test Duplicate QR

1. Quet lai dung QR do.
2. Bam sync neu app chua tu sync.

Expected:

- Backend tra item trong `duplicates`.
- DB van chi co 1 row cho `registration_id`.
- App hien result duplicate, khong tao check-in moi.

## 9. Test Offline Queue

Day la demo quan trong nhat cua Phase 6.

1. Login mobile khi dang online.
2. Tat Wi-Fi/du lieu di dong hoac bat airplane mode.
3. Quet QR hop le.
4. Quan sat queue trong app.

Expected khi offline:

- QR van duoc verify local bang JWKS da cache.
- Item duoc luu vao SQLite.
- `pendingCount` tang.
- App khong mat item khi dong/mo lai app.

Sau do:

1. Bat lai mang.
2. Doi vai giay hoac bam Sync.

Expected:

- NetInfo phat hien online.
- App gui batch len `/checkin/batch`.
- Item chuyen sang synced.
- Backend ghi check-in.

## 10. Test App Crash Giua Luc Offline

1. Login online.
2. Tat mang.
3. Scan QR.
4. Force close app.
5. Mo lai app.

Expected:

- Queue van con vi SQLite luu durable.
- Sau khi online lai, queue sync tiep duoc.

## 11. Test Logout Khi Queue Chua Rong

1. Tat mang.
2. Scan QR de tao pending item.
3. Bam Logout.

Expected:

- App canh bao vi con unsynced scans.
- Khong nen logout ngay neu chua sync xong.

## 12. Test Tampered QR

Khong nen sua QR bang camera. Dung manual token input neu app dang hien o che do paste:

1. Copy QR token hop le tu Student Web.
2. Doi 1 ky tu bat ky trong token.
3. Paste vao app.

Expected:

- App reject local voi `invalid_signature`.
- Khong can network.
- Khong insert item hop le vao backend.

## 13. Test Wrong Room / Not Assigned

Can co room va staff assignment.

1. Admin Web -> Staff Assignments.
2. Gan staff vao workshop/room A.
3. Scan QR cua registration thuoc workshop/room B.

Expected:

- Online verify canh bao sai room hoac not assigned.
- Neu submit len backend, backend tra `wrong_room` hoac `not_assigned`.
- App luu item-level result trong queue.

## 14. Test Notification Sau Check-in

Sau khi accepted check-in:

1. Vao Student Web bang tai khoan student.
2. Kiem tra notifications hoac Mailhog tuy template/channel.

Expected:

- Outbox event `checkin.confirmed` duoc consume.
- Notification duoc tao trong DB.

Kiem tra DB:

```powershell
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select template, channel, status, created_at from notifications order by created_at desc limit 10;"
```

## 15. Troubleshooting Expo

### Expo Go khong load app

Thu:

```powershell
npx expo start --tunnel
```

Hoac dam bao phone va may tinh cung Wi-Fi.

### Login fail tren phone nhung may tinh goi duoc localhost

Dung IP LAN, khong dung localhost:

```text
http://192.168.x.x:3000
```

### Android emulator khong goi duoc localhost

Dung:

```text
http://10.0.2.2:3000
```

### Camera khong hien

- Cho phep permission camera.
- Dung physical device de test camera tot nhat.
- Expo web khong phai moi truong chinh cho camera scan.

### Token QR het han

Tao registration moi trong Student Web.

### JWT/JWKS invalid sau khi restart backend Docker

Docker demo default co the dung ephemeral JWT key neu khong set
`JWT_PRIVATE_KEY/JWT_PUBLIC_KEY`. Restart backend lam token cu invalid.

De demo on dinh hon, set key co dinh trong env truoc khi tao QR.

## 16. Checklist AC Mobile

| AC | Cach test |
| --- | --- |
| AC-01 online scan <= 1s | Scan QR khi online, DB co 1 check-in |
| AC-02 offline scan local | Tat mang, scan QR, item vao SQLite queue |
| AC-03 online lai sync | Bat mang lai, NetInfo auto sync |
| AC-04 duplicate QR | Scan cung QR 2-3 lan, DB van 1 row |
| AC-05 QR tampered | Sua token, app reject local |
| AC-06 retry khi server loi | Stop backend, scan/queue, start backend, sync lai |
| AC-07 notification < 5s | Kiem tra notifications/Mailhog sau accepted |
| AC-08 crash giua queue | Force close app, mo lai queue van con |
| AC-09 wrong room | Tao assignment sai room, scan QR khac room |
| AC-10 batch idempotent | Sync lai cung item, backend tra duplicate |
| AC-11 logout guard | Tao pending queue, bam logout, app canh bao |
