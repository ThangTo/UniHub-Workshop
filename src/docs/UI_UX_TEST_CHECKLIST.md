# UniHub Workshop - UI/UX Test Checklist

Muc tieu: test nhanh cac man hinh nguoi dung that su cham vao trong Student Web,
Admin Web va Mobile Check-in. Chay tu thu muc `src/`.

## 0. Chuan bi

```powershell
pnpm stack:up
docker compose --profile all exec backend pnpm run seed
```

URL:

- Student Web: http://localhost:5173
- Admin Web: http://localhost:5174
- Backend health: http://localhost:3000/health
- Mailhog: http://localhost:8025

Tai khoan seed:

- Admin: `admin@unihub.local` / `Admin@123456`
- Organizer: `organizer@unihub.local` / `Test@12345`
- Staff: `staff@unihub.local` / `Test@12345`

MSSV test student: `21120004`, `21120005`, `21120006`, `22120004`, `22120005`.

## 1. Tieu chi UX chung

- App co vao duoc trang dung sau login/register khong.
- Loading, error, empty state co hien ro va khong lam nguoi dung bi ket khong.
- Form co label, placeholder, validate va thong bao loi de hieu khong.
- Nut dang submit co disable/loading khong.
- Mobile width khoang 390px: header/nav/table/card co bi tran, che, kho doc khong.
- Desktop width khoang 1366px: spacing, table, card co de scan khong.
- Refresh trang sau khi login co con giu session khong.
- Khi token het han/401, app co ve login hoac refresh token dung khong.

## 2. Student Web

### 2.1 Register

Test:

1. Mo http://localhost:5173/register.
2. Dang ky voi email moi, password du 8 ky tu, MSSV seed chua dung.
3. Thu MSSV sai va password ngan.

Expected:

- Dang ky thanh cong thi vao `/workshops`.
- Loi MSSV/password hien gan form, de doc.
- Khong submit duoc khi thieu required fields.

Can de y UX:

- Trang register co text demo MSSV trong UI. Tot cho demo, nhung hoi "dev/demo"
  neu cham nhu san pham that.

### 2.2 Login

Test:

1. Login sai password.
2. Login dung account student.
3. Refresh trang sau login.

Expected:

- Loi login hien trong card.
- Login thanh cong vao danh sach workshop.
- Header hien ten student va MSSV neu co.

### 2.3 Workshop List

Test:

1. Xem list workshop.
2. Kiem tra title dai, workshop het ghe, workshop co/khong room/speaker.
3. Thu tren mobile width.

Expected:

- Card de scan: ten, thoi gian, speaker/room, phi, trang thai, ghe con.
- Khong bi tran card/nav tren mobile.

Can de y UX:

- Card dung icon emoji cho speaker/room; co the khong dong nhat voi style admin.
- Neu list nhieu workshop, hien tai chua co search/filter.

### 2.4 Workshop Detail + Register

Test:

1. Mo detail workshop published.
2. Bam dang ky.
3. Thu workshop het ghe/chua publish.
4. Neu co AI summary PENDING, cho auto refresh.

Expected:

- CTA dang ky disable dung khi het ghe/chua publish.
- Dang ky thanh cong chuyen sang "Dang ky cua toi".
- Loi het ghe hoac da dang ky hien ngay trong panel.

### 2.5 My Registrations + Payment + QR

Test:

1. Dang ky workshop free: status thanh `CONFIRMED`, QR hien.
2. Dang ky workshop paid: status `PENDING_PAYMENT`, bam thanh toan.
3. Copy QR token.
4. Huy dang ky.

Expected:

- QR panel de doc, token co the copy.
- Payment success lam registration thanh confirmed.
- Cancel co confirm truoc khi huy.

Can de y UX:

- Dang dung `alert()`/`confirm()` cua browser cho payment/cancel, nhin thua so voi UI card.
- QR panel co dong "Cap nhat" lay thoi gian hien tai moi render, khong phai thoi gian server.

## 3. Admin Web

### 3.1 Login + Navigation

Test:

1. Login admin.
2. Login organizer.
3. Kiem tra menu `CSV import` chi hien voi SYS_ADMIN.

Expected:

- Role-based nav dung.
- Dang xuat xoa session va ve login khi vao protected route.

### 3.2 Workshop List

Test:

1. Xem table workshops.
2. Kiem tra title dai, status DRAFT/PUBLISHED/CANCELLED, summary status.
3. Thu mobile width.

Expected:

- Table de scan tren desktop.
- Link detail/edit dung.

Can de y UX:

- Table khong co horizontal scroll wrapper rieng cho mobile; can test ky tren man hinh nho.
- Chua co search/filter/sort, se bat tien neu nhieu workshop.

### 3.3 Create/Edit Workshop

Test:

1. Tao workshop voi title, description, start/end, capacity, fee.
2. Thu endAt truoc startAt.
3. Thu capacity 0, fee am.
4. Edit workshop da co.

Expected:

- Backend validate va UI hien loi de hieu.
- Save xong ve detail workshop.

Can de y UX:

- `Speaker ID` va `Room ID` dang la input UUID thu cong, kho dung voi organizer.
  Nen ghi nhan day la UX issue lon neu cham theo thao tac nguoi dung that.

### 3.4 Workshop Detail + AI Summary

Test:

1. Publish workshop draft.
2. Cancel workshop published/draft.
3. Upload `scripts/test-workshop.pdf`.
4. Cho summary PENDING -> READY.
5. Neu FAILED, bam Retry.

Expected:

- Nut publish/cancel dung theo status.
- Upload PDF reset file input sau khi xong.
- Summary auto-refresh moi 3 giay.

Can de y UX:

- Cancel dung `prompt()` cua browser de nhap ly do; nen thay bang modal/form trong UI.
- File upload la input mac dinh, chua co drag/drop, progress, filename/status ro.

### 3.5 Registrations

Test:

1. Vao `/registrations`.
2. Tim theo MSSV, ten student, workshop.
3. Kiem tra status payment/check-in.

Expected:

- Neu backend co `/admin/registrations`, table hien du lieu.
- Neu backend chua co endpoint, UI hien empty state khong crash.

Can de y UX:

- Code da co fallback "endpoint chua cung cap"; neu do an bi cham feature completeness,
  day co the bi xem la thieu backend/admin flow.

### 3.6 Staff Assignments

Test:

1. Tao assignment moi.
2. Xoa assignment.
3. Thu UUID sai.

Expected:

- Loi hien trong form.
- Xoa reload list.

Can de y UX:

- Staff/Room/Workshop deu nhap UUID thu cong. Day la friction rat cao; nen co dropdown/search.
- Xoa dung `confirm()` cua browser.

### 3.7 CSV Import Jobs

Test:

1. Vao bang admin.
2. Bam "Chay dong bo ngay".
3. Doi job RUNNING/SUCCESS/PARTIAL/FAILED.
4. Bam Chi tiet job co failed rows.
5. Doi filter ALL/RUNNING/SUCCESS/PARTIAL/FAILED.

Expected:

- Auto refresh moi 5 giay.
- Modal chi tiet dong/mo duoc.
- Filter khong lam mat trang thai table.

## 4. Mobile Check-in

Chay:

```powershell
cd apps/mobile
npx expo start
```

Test chinh:

1. Login staff voi API URL dung moi truong.
2. Scan QR online: item accepted va DB co check-in.
3. Scan duplicate: result duplicate, DB van 1 row.
4. Tat mang, scan QR hop le: item vao local queue.
5. Bat mang lai: queue tu sync.
6. Force close app khi offline queue con item, mo lai van con.
7. Sua 1 ky tu QR token: app reject local.
8. Logout khi queue chua sync: app canh bao.

Can de y UX:

- Mobile app hien nhieu thong tin ky thuat: deviceId, public key, token, idempotency key.
  Tot cho demo ky thuat, nhung hoi nang voi staff that.
- Nhieu text trong mobile dang bang tieng Anh trong khi web pha tieng Viet/Anh.

## 5. Cac diem de ghi vao bao cao UI/UX

Strengths:

- Student flow ro: login/register -> workshops -> detail -> register/payment -> QR.
- Admin co day du man hinh demo: workshop, AI summary, registrations, staff assignment, CSV import.
- Loading/error/empty states co mat o hau het man hinh.
- Role-based nav cho CSV import da duoc xu ly.

Issues nen uu tien:

- Student Web build dang can dependency `qrcode`; neu workspace chua cai/link dependency thi build fail.
- Admin create workshop va staff assignment bat nguoi dung nhap UUID thu cong.
- Dung browser `alert/confirm/prompt` o nhieu thao tac quan trong.
- Table admin co nguy co kho dung tren mobile.
- Admin registrations co fallback cho endpoint chua co, co the bi xem la chua hoan tat flow.
- Ngon ngu UI chua dong nhat: Viet/Anh lan nhau (`Publish`, `Retry`, `Queue Token`, `Login and Cache Key`).
- Thieu search/filter o Student Workshop List va Admin Workshop List.

## 6. Bang test nhanh de nop

| Area | Case | Expected | Result |
| --- | --- | --- | --- |
| Student | Register MSSV hop le | Vao `/workshops` | |
| Student | Register MSSV sai | Hien loi de hieu | |
| Student | Login sai password | Hien loi trong form | |
| Student | Xem workshop list | Card khong vo layout | |
| Student | Dang ky workshop free | Status `CONFIRMED`, co QR | |
| Student | Dang ky workshop paid | Thanh toan xong co QR | |
| Student | Huy dang ky | Status `CANCELLED` | |
| Admin | Login admin | Thay menu CSV import | |
| Admin | Login organizer | Khong thay CSV import | |
| Admin | Tao workshop | Ve detail, status DRAFT | |
| Admin | Publish workshop | Student Web thay workshop | |
| Admin | Upload PDF | Summary PENDING/READY | |
| Admin | Staff assignment | Tao/xoa duoc | |
| Admin | CSV sync | Job status hien dung | |
| Mobile | Online scan | accepted | |
| Mobile | Duplicate scan | duplicate | |
| Mobile | Offline queue | pending trong SQLite | |
| Mobile | Back online sync | pending -> done | |
