# UniHub Workshop - Huong Dan Cau Hinh Environment

Tai lieu nay giai thich vi sao nhieu buoc test khong yeu cau ban nhap env
thu cong, va khi nao ban can tao file `.env`.

## 1. Chay Bang Docker Full Stack

Neu test theo runbook Docker:

```powershell
cd <repo>\src
pnpm stack:up
```

ban **khong bat buoc** tao `.env`. Ly do: `docker-compose.yml` da gan default
dev values bang cu phap `${VAR:-default}` cho tat ca service local:

- Postgres: user/password/db/port
- Redis: port
- RabbitMQ: user/password/port/UI port
- MinIO: access key/secret/bucket/ports
- Mailhog: SMTP/UI ports
- Backend: connection strings, JWT TTL, bootstrap admin, SMTP, payment, Gemini AI, CSV
- Mock payment gateway: webhook URL/secret
- Student Web/Admin Web: API proxy den backend

Voi cach nay, Mailhog thay SMTP that va mock-pg thay payment gateway that.
Tinh nang AI summary dung Gemini API, nen can cau hinh `GEMINI_API_KEY` neu
muon test upload PDF -> summary. `services/mock-ai` chi con la legacy service,
khong duoc backend goi trong code hien tai.

Neu muon nhin ro hoac tuy bien port/password, copy root env example. Day cung
la noi dat `GEMINI_API_KEY` khi chay Docker Compose:

```powershell
cd <repo>\src
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Docker Compose tu dong doc file `src/.env` neu file nay ton tai.

## 2. Gia Tri Mac Dinh Quan Trong

| Bien | Docker default | Ghi chu |
| --- | --- | --- |
| `POSTGRES_USER` | `unihub` | DB user trong container |
| `POSTGRES_PASSWORD` | `unihub` | Chi dung cho dev/demo |
| `POSTGRES_DB` | `unihub` | DB name |
| `DATABASE_URL` | `postgresql://unihub:unihub@postgres:5432/unihub?schema=public` | Backend trong Docker dung hostname `postgres` |
| `REDIS_URL` | `redis://redis:6379` | Backend trong Docker dung hostname `redis` |
| `RABBITMQ_URL` | `amqp://unihub:unihub@rabbitmq:5672` | Backend trong Docker dung hostname `rabbitmq` |
| `MINIO_ENDPOINT` | `minio` | Backend trong Docker dung hostname `minio` |
| `MINIO_ROOT_USER` | `unihub` | Dev access key |
| `MINIO_ROOT_PASSWORD` | `unihub-secret` | Dev secret key |
| `SMTP_HOST` | `mailhog` | Email gui vao Mailhog, khong gui ra internet |
| `SMTP_PORT` | `1025` | Mailhog SMTP |
| `MOCK_PG_URL` | `http://mock-pg:4000` | Payment gateway local |
| `GEMINI_API_KEY` | empty | Google Gemini API key cho AI summary |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model AI summary |
| `MOCK_PG_WEBHOOK_SECRET` | `mock-pg-secret` | HMAC webhook secret |
| `BOOTSTRAP_ADMIN_EMAIL` | `admin@unihub.local` | Admin seed |
| `BOOTSTRAP_ADMIN_PASSWORD` | `Admin@123456` | Admin seed |

## 3. Chay Backend Local Ngoai Docker

Neu chi dung Docker cho infra, con backend chay local bang `pnpm dev`, backend
can file:

```text
src/apps/backend/.env
```

Co the tao tu example:

```powershell
cd <repo>\src\apps\backend
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Gia tri local khac Docker o hostname: dung `localhost` thay vi ten service
Docker.

Vi du local backend:

```env
DATABASE_URL=postgresql://unihub:unihub@localhost:5432/unihub?schema=public
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://unihub:unihub@localhost:5672

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ROOT_USER=unihub
MINIO_ROOT_PASSWORD=unihub-secret
MINIO_BUCKET=unihub
MINIO_PUBLIC_ENDPOINT=http://localhost:9000

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=UniHub <no-reply@unihub.local>

MOCK_PG_URL=http://localhost:4000
MOCK_PG_WEBHOOK_SECRET=mock-pg-secret
GEMINI_API_KEY=<your-google-ai-studio-key>
GEMINI_MODEL=gemini-2.5-flash
```

Lenh chay infra-only:

```powershell
cd <repo>\src
docker compose up -d postgres redis rabbitmq minio mailhog
pnpm --filter @unihub/mock-pg dev
pnpm --filter @unihub/backend dev
```

## 4. JWT Keypair

Trong dev, neu `JWT_PRIVATE_KEY` va `JWT_PUBLIC_KEY` de trong, backend se tu sinh
keypair tam thoi moi lan start. Cach nay du de login/test web.

Khi can demo offline QR lau hon mot lan restart, hoac can demo script tu sign
JWT, nen dung keypair co dinh:

```powershell
node -e "const {generateKeyPairSync}=require('crypto'); const {privateKey, publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}); console.log('JWT_PRIVATE_KEY=' + JSON.stringify(privateKey)); console.log('JWT_PUBLIC_KEY=' + JSON.stringify(publicKey));"
```

Copy 2 dong output vao file `.env` phu hop.

## 5. Web Env

Student Web va Admin Web deu co file `.env.example` rieng:

```text
src/apps/student-web/.env.example
src/apps/admin-web/.env.example
```

Mac dinh dev:

```env
VITE_API_BASE_URL=/api
VITE_API_PROXY=http://localhost:3000
```

Khi chay Docker web, nginx da proxy `/api` den backend nen khong can sua.

## 6. Mobile Expo Env

Mobile app hien khong bat buoc doc `.env`. App co o nhap API Base URL ngay man
hinh login va luu lai vao local storage.

Gia tri can dung:

- Android emulator: `http://10.0.2.2:3000`
- iOS simulator: `http://localhost:3000`
- Dien thoai that: `http://<IPv4-cua-may-tinh>:3000`

Vi du dien thoai that:

```text
http://192.168.1.23:3000
```

May tinh va dien thoai phai cung Wi-Fi, va firewall phai cho phep port `3000`.

## 7. Production Khong Duoc Dung Default

Nhung default tren chi phu hop local/demo. Khi deploy that, bat buoc doi:

- DB password
- RabbitMQ password
- MinIO access key/secret
- JWT RSA keypair co dinh
- SMTP provider that
- Payment gateway URL/secret that
- AI provider URL/key that
- CORS origins
- `NODE_ENV=production`
