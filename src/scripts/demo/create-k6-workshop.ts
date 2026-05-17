import * as fs from 'fs';
import * as path from 'path';
import {
  assertBackend,
  createContext,
  createPrisma,
  createPublishedWorkshop,
  ensureOrganizer,
  shortId,
  signAccessToken,
} from './_lib';

interface Args {
  capacity: number;
  out: string;
}

function parseArgs(): Args {
  const capacityArg = process.argv.find((x) => x.startsWith('--capacity='));
  const outArg = process.argv.find((x) => x.startsWith('--out='));
  const capacity = capacityArg ? Number(capacityArg.split('=')[1]) : Number(process.env.K6_WORKSHOP_CAPACITY ?? 15000);
  if (!Number.isInteger(capacity) || capacity < 12000) {
    throw new Error('--capacity must be an integer >= 12000 for the 12k fairness demo');
  }
  return {
    capacity,
    out: outArg ? outArg.split('=').slice(1).join('=') : 'scripts/outputs/k6-workshop.json',
  };
}

function normalizeHostDatabaseUrl(): void {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  if (url.includes('@postgres:5432')) {
    process.env.DATABASE_URL = url.replace('@postgres:5432', '@localhost:5432');
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const ctx = createContext();
  normalizeHostDatabaseUrl();
  await assertBackend(ctx.apiBaseUrl);

  const prisma = createPrisma();
  try {
    const organizer = await ensureOrganizer(prisma);
    const organizerToken = signAccessToken(organizer.id, ['ORGANIZER']);
    const workshop = await createPublishedWorkshop(ctx.apiBaseUrl, organizerToken, {
      title: `K6 12k Load Workshop ${shortId('ws')}`,
      capacity: args.capacity,
      feeAmount: 0,
      startsInHours: 24,
    });

    const outPath = path.resolve(ctx.srcRoot, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify({ ...workshop, capacity: args.capacity }, null, 2)}\n`, 'utf8');
    console.log(`[workshop] created ${workshop.title}`);
    console.log(`[workshop] WORKSHOP_ID=${workshop.id}`);
    console.log(`[workshop] wrote ${outPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[workshop] ERROR: ${(error as Error).message}`);
  process.exit(1);
});
