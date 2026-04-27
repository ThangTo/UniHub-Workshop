/**
 * Mock Payment Gateway — mô phỏng cổng thanh toán cho UniHub Workshop.
 *
 * Endpoints:
 *   POST /charge        — tạo giao dịch + trả status (sync)
 *   GET  /charge/:id    — query status (cho reconcile)
 *   POST /refund        — tạo refund
 *   GET  /health        — health check
 *
 * Hành vi mô phỏng:
 *   - Latency: random 100-800ms
 *   - 5% failure (card_declined)
 *   - 3% timeout (sleep > 5s, làm CB timeout)
 *   - MOCK_PG_DOWN=true → trả 503 hết
 *   - Sau khi charge SUCCESS, fire webhook về backend (async, sau 500ms)
 */
import express, { Request, Response } from 'express';
import * as crypto from 'crypto';
import axios from 'axios';

const PORT = Number(process.env.PORT ?? 4000);
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? 'http://localhost:3000/payments/webhook';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'mock-pg-secret';

interface Charge {
  id: string;
  regId: string;
  amount: number;
  idempotencyKey: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  failureReason?: string;
  createdAt: string;
}

const charges = new Map<string, Charge>();
const chargesByIdemKey = new Map<string, string>(); // idemKey → chargeId

const app = express();
app.use(express.json({ limit: '64kb' }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isDown = () => process.env.MOCK_PG_DOWN === 'true';

function signWebhook(body: object): string {
  const raw = JSON.stringify(body);
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
}

async function fireWebhook(charge: Charge): Promise<void> {
  const body = {
    type: 'charge.completed',
    chargeId: charge.id,
    idempotencyKey: charge.idempotencyKey,
    regId: charge.regId,
    status: charge.status,
    amount: charge.amount,
    failureReason: charge.failureReason,
    occurredAt: new Date().toISOString(),
  };
  const sig = signWebhook(body);
  setTimeout(async () => {
    try {
      await axios.post(WEBHOOK_URL, body, {
        timeout: 3000,
        headers: { 'X-Mock-Pg-Signature': sig },
      });
      console.log(`[mock-pg] webhook → ${charge.id} ${charge.status}`);
    } catch (e) {
      console.warn(`[mock-pg] webhook failed: ${(e as Error).message}`);
    }
  }, 500);
}

app.get('/health', (_req, res) => {
  res.json({ ok: !isDown(), down: isDown() });
});

app.post('/charge', async (req: Request, res: Response) => {
  if (isDown()) {
    res.status(503).json({ error: 'gateway_down' });
    return;
  }

  const { regId, amount, idempotencyKey } = req.body ?? {};
  if (!regId || !amount || !idempotencyKey) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  // Idempotency: cùng key trả lại charge cũ.
  const existingId = chargesByIdemKey.get(idempotencyKey);
  if (existingId) {
    const existing = charges.get(existingId);
    res.status(200).json(existing);
    return;
  }

  // Latency simulation
  const latencyMs = 100 + Math.floor(Math.random() * 700);
  await sleep(latencyMs);

  // 3% timeout: sleep dài để client bị timeout
  if (Math.random() < 0.03) {
    await sleep(5000);
  }

  const chargeId = `pg_${crypto.randomBytes(8).toString('hex')}`;
  const failed = Math.random() < 0.05;

  const charge: Charge = {
    id: chargeId,
    regId,
    amount,
    idempotencyKey,
    status: failed ? 'FAILED' : 'SUCCESS',
    failureReason: failed ? 'card_declined' : undefined,
    createdAt: new Date().toISOString(),
  };
  charges.set(chargeId, charge);
  chargesByIdemKey.set(idempotencyKey, chargeId);

  console.log(`[mock-pg] charge ${chargeId} ${charge.status} reg=${regId} amount=${amount}`);

  // Fire webhook async (sau 500ms) để giả lập gateway báo về sau
  void fireWebhook(charge);

  res.status(failed ? 402 : 200).json(charge);
});

app.get('/charge/:id', (req, res) => {
  if (isDown()) {
    res.status(503).json({ error: 'gateway_down' });
    return;
  }
  const c = charges.get(req.params.id);
  if (!c) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(c);
});

app.post('/refund', async (req: Request, res: Response) => {
  if (isDown()) {
    res.status(503).json({ error: 'gateway_down' });
    return;
  }
  const { chargeId, amount } = req.body ?? {};
  const c = charges.get(chargeId);
  if (!c || c.status !== 'SUCCESS') {
    res.status(404).json({ error: 'charge_not_refundable' });
    return;
  }
  await sleep(200 + Math.floor(Math.random() * 400));
  const refundId = `rf_${crypto.randomBytes(8).toString('hex')}`;
  console.log(`[mock-pg] refund ${refundId} charge=${chargeId} amount=${amount}`);
  res.json({ id: refundId, chargeId, amount, status: 'SUCCESS', createdAt: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[mock-pg] listening on :${PORT}, webhook → ${WEBHOOK_URL}`);
});
