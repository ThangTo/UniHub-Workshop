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
  regId?: string;
  registrationId?: string;
  status?: string;
  paymentRequired?: boolean;
  code?: string;
  message?: string;
}

function parseArgs(): { clients: number } {
  const arg = process.argv.find((x) => x.startsWith('--clients='));
  const clients = arg ? Number(arg.split('=')[1]) : Number(process.env.CLIENTS ?? 100);
  if (!Number.isInteger(clients) || clients < 2 || clients > 1000) {
    throw new Error('--clients must be an integer from 2 to 1000');
  }
  return { clients };
}

async function main(): Promise<void> {
  const { clients } = parseArgs();
  const ctx = createContext();
  const prisma = createPrisma();

  try {
    await assertBackend(ctx.apiBaseUrl);
    const runId = shortId('race');
    const runSeed = Date.now() % 900_000;
    console.log(`[race] api=${ctx.apiBaseUrl} clients=${clients} run=${runId}`);

    const organizer = await ensureOrganizer(prisma);
    const organizerToken = signAccessToken(organizer.id, ['ORGANIZER']);
    const workshop = await createPublishedWorkshop(ctx.apiBaseUrl, organizerToken, {
      title: `Phase8 Race ${runId}`,
      capacity: 1,
      feeAmount: 0,
    });
    console.log(`[race] workshop=${workshop.id} capacity=1`);

    const students = [];
    for (let i = 0; i < clients; i += 1) {
      const code = studentCodeFor(runSeed, i);
      const email = `${runId}-${i}@demo.unihub.local`;
      const user = await ensureStudentUser(prisma, code, email, `Race Student ${i + 1}`);
      students.push({
        id: user.id,
        token: signAccessToken(user.id, ['STUDENT']),
        index: i,
      });
    }
    console.log(`[race] prepared ${students.length} student users`);

    const startedAt = Date.now();
    const results = await Promise.all(
      students.map(async (student) => {
        const response = await requestJson<RegistrationResponse>(ctx.apiBaseUrl, '/registrations', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${student.token}`,
            'idempotency-key': `${runId}-${student.index}`,
          },
          body: JSON.stringify({ workshopId: workshop.id }),
        });
        return { studentIndex: student.index, ...response };
      }),
    );

    const winners = results.filter((r) => r.status >= 200 && r.status < 300);
    const conflicts = results.filter((r) => r.status === 409);
    const rateLimited = results.filter((r) => r.status === 429);
    const otherErrors = results.filter((r) => r.status >= 400 && r.status !== 409 && r.status !== 429);

    const dbActive = await prisma.registration.count({
      where: {
        workshopId: workshop.id,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
      },
    });
    const seatsLeft = requireOk<{ seatsLeft?: number }>(
      await requestJson(ctx.apiBaseUrl, `/workshops/${workshop.id}`),
      'workshop detail',
    ).seatsLeft;

    console.log(`[race] durationMs=${Date.now() - startedAt}`);
    console.log(`[race] http winners=${winners.length} conflicts=${conflicts.length} rateLimited=${rateLimited.length} otherErrors=${otherErrors.length}`);
    console.log(`[race] dbActive=${dbActive} seatsLeft=${seatsLeft}`);

    if (winners.length !== 1 || dbActive !== 1) {
      console.error('[race] FAIL: expected exactly one successful active registration.');
      console.error(JSON.stringify(results.slice(0, 20), null, 2));
      process.exitCode = 1;
      return;
    }

    console.log('[race] PASS: concurrent registration did not oversell the final seat.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[race] ERROR: ${(error as Error).message}`);
  process.exit(1);
});
