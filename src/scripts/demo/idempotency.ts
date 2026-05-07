import {
  assertBackend,
  createContext,
  createPrisma,
  createPublishedWorkshop,
  ensureOrganizer,
  ensureStudentUser,
  requestJson,
  requireOk,
  shortId,
  signAccessToken,
  studentCodeFor,
} from './_lib';

interface RegistrationResponse {
  regId: string;
  registrationId: string;
  status: string;
  paymentRequired: boolean;
}

interface PaymentResponse {
  status?: string;
  paymentId?: string;
  gatewayTxnId?: string | null;
  code?: string;
  message?: string;
}

function parseArgs(): { attempts: number } {
  const arg = process.argv.find((x) => x.startsWith('--attempts='));
  const attempts = arg ? Number(arg.split('=')[1]) : Number(process.env.ATTEMPTS ?? 5);
  if (!Number.isInteger(attempts) || attempts < 2 || attempts > 20) {
    throw new Error('--attempts must be an integer from 2 to 20');
  }
  return { attempts };
}

async function main(): Promise<void> {
  const { attempts } = parseArgs();
  const ctx = createContext();
  const prisma = createPrisma();

  try {
    await assertBackend(ctx.apiBaseUrl);
    const runId = shortId('idem');
    const runSeed = Date.now() % 900_000;
    console.log(`[idempotency] api=${ctx.apiBaseUrl} attempts=${attempts} run=${runId}`);

    const organizer = await ensureOrganizer(prisma);
    const organizerToken = signAccessToken(organizer.id, ['ORGANIZER']);
    const workshop = await createPublishedWorkshop(ctx.apiBaseUrl, organizerToken, {
      title: `Phase8 Idempotency ${runId}`,
      capacity: 1,
      feeAmount: 50_000,
    });
    console.log(`[idempotency] workshop=${workshop.id} fee=50000`);

    const student = await ensureStudentUser(
      prisma,
      studentCodeFor(runSeed, 0),
      `${runId}@demo.unihub.local`,
      'Idempotency Demo Student',
    );
    const studentToken = signAccessToken(student.id, ['STUDENT']);

    const registration = requireOk<RegistrationResponse>(
      await requestJson(ctx.apiBaseUrl, '/registrations', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${studentToken}`,
          'idempotency-key': `${runId}-registration`,
        },
        body: JSON.stringify({ workshopId: workshop.id }),
      }),
      'create paid registration',
    );
    if (!registration.paymentRequired) {
      throw new Error('Registration unexpectedly did not require payment.');
    }
    console.log(`[idempotency] registration=${registration.registrationId} status=${registration.status}`);

    const idempotencyKey = `${runId}-payment`;
    const responses = [];
    for (let i = 0; i < attempts; i += 1) {
      const response = await requestJson<PaymentResponse>(ctx.apiBaseUrl, '/payments', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${studentToken}`,
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ registrationId: registration.registrationId }),
      });
      responses.push(response);
      console.log(
        `[idempotency] attempt=${i + 1} http=${response.status} paymentId=${response.body?.paymentId ?? '-'} status=${response.body?.status ?? response.body?.code ?? '-'}`,
      );
    }

    const payments = await prisma.payment.findMany({
      where: { idempotencyKey },
      orderBy: { createdAt: 'asc' },
    });
    const uniquePaymentIds = new Set(responses.map((r) => r.body?.paymentId).filter(Boolean));
    const successfulHttp = responses.filter((r) => r.status >= 200 && r.status < 300);

    console.log(`[idempotency] dbPaymentsWithKey=${payments.length}`);
    console.log(`[idempotency] responsePaymentIds=${Array.from(uniquePaymentIds).join(', ') || '-'}`);
    console.log(`[idempotency] successfulHttp=${successfulHttp.length}/${responses.length}`);

    if (payments.length !== 1) {
      console.error('[idempotency] FAIL: expected exactly one payment row for the repeated Idempotency-Key.');
      process.exitCode = 1;
      return;
    }
    if (uniquePaymentIds.size > 1) {
      console.error('[idempotency] FAIL: repeated responses returned multiple payment IDs.');
      process.exitCode = 1;
      return;
    }

    console.log('[idempotency] PASS: repeated POST /payments with one key produced one durable payment record.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[idempotency] ERROR: ${(error as Error).message}`);
  process.exit(1);
});
