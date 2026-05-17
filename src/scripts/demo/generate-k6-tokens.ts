import * as fs from 'fs';
import * as path from 'path';
import {
  createContext,
  createPrisma,
  requestJson,
  requireBackend,
  signAccessToken,
  shortId,
  verifyAccessToken,
} from './_lib';

interface Args {
  count: number;
  out: string;
}

function parseArgs(): Args {
  const countArg = process.argv.find((x) => x.startsWith('--count='));
  const outArg = process.argv.find((x) => x.startsWith('--out='));
  const count = countArg ? Number(countArg.split('=')[1]) : Number(process.env.TOKEN_COUNT ?? 500);
  if (!Number.isInteger(count) || count < 1 || count > 12000) {
    throw new Error('--count must be an integer from 1 to 12000');
  }
  return {
    count,
    out: outArg ? outArg.split('=').slice(1).join('=') : 'tokens.json',
  };
}

function normalizeHostDatabaseUrl(): void {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  if (url.includes('@postgres:5432')) {
    process.env.DATABASE_URL = url.replace('@postgres:5432', '@localhost:5432');
  }
}

function requireStableJwtKeys(): void {
  if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
    throw new Error(
      [
        'JWT_PRIVATE_KEY/JWT_PUBLIC_KEY are missing in src/.env or apps/backend/.env.',
        'Add stable keys and restart backend before generating k6 tokens.',
        'If backend uses ephemeral in-memory keys, offline-generated tokens cannot pass JWT verification.',
      ].join(' '),
    );
  }
}

async function assertBackendUsesSamePublicKey(apiBaseUrl: string): Promise<void> {
  const result = await requestJson<{ publicKey?: string }>(apiBaseUrl, '/auth/jwks');
  if (result.status !== 200 || !result.body?.publicKey) {
    throw new Error(`Cannot read backend JWKS: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  }
  const envPublicKey = String(process.env.JWT_PUBLIC_KEY).replace(/\\n/g, '\n').trim();
  const backendPublicKey = result.body.publicKey.trim();
  if (envPublicKey !== backendPublicKey) {
    throw new Error(
      [
        'Backend public key does not match JWT_PUBLIC_KEY from env.',
        'Restart backend after updating JWT keys, then run this script again.',
      ].join(' '),
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const ctx = createContext();
  normalizeHostDatabaseUrl();
  requireStableJwtKeys();
  await assertBackendUsesSamePublicKey(ctx.apiBaseUrl);

  const prisma = createPrisma();
  const runId = shortId('k6tokens');
  const baseCode = 850_000_000_000 + (Date.now() % 10_000_000) * 100_000;
  const tokens: string[] = [];

  try {
    const bcrypt = requireBackend<typeof import('bcrypt')>('bcrypt');
    const passwordHash = await bcrypt.hash('Demo@12345', 8);
    const tokenTtl = process.env.K6_TOKEN_TTL ?? '30m';

    const studentRole = await prisma.role.upsert({
      where: { name: 'STUDENT' },
      update: {},
      create: { name: 'STUDENT' },
    });

    const batchSize = Number(process.env.K6_TOKEN_BATCH_SIZE ?? 1000);
    for (let offset = 0; offset < args.count; offset += batchSize) {
      const size = Math.min(batchSize, args.count - offset);
      const now = new Date();
      const students = Array.from({ length: size }, (_, j) => {
        const index = offset + j;
        const code = String(baseCode + index);
        return {
          studentCode: code,
          fullName: `K6 Student ${index + 1}`,
          email: `${runId}-${index}@k6.unihub.local`,
          faculty: 'CNTT',
          cohort: '2026',
          isActive: true,
          sourceExportedAt: now,
          lastSyncedAt: now,
        };
      });

      await prisma.student.createMany({ data: students, skipDuplicates: true });
      await prisma.user.createMany({
        data: students.map((student) => ({
          email: student.email,
          fullName: student.fullName,
          passwordHash,
          studentCode: student.studentCode,
          isActive: true,
        })),
        skipDuplicates: true,
      });

      const users = await prisma.user.findMany({
        where: { studentCode: { in: students.map((student) => student.studentCode) } },
        select: { id: true },
      });

      await prisma.userRole.createMany({
        data: users.map((user) => ({ userId: user.id, roleId: studentRole.id })),
        skipDuplicates: true,
      });

      for (const user of users) {
        const token = signAccessToken(user.id, ['STUDENT'], tokenTtl);
        verifyAccessToken(token);
        tokens.push(token);
      }

      console.log(`[tokens] prepared ${Math.min(offset + size, args.count)}/${args.count}`);
    }

    const outPath = path.resolve(ctx.srcRoot, args.out);
    fs.writeFileSync(outPath, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
    console.log(`[tokens] wrote ${tokens.length} tokens to ${outPath}`);
    console.log('[tokens] use with scripts/k6/*.js: $env:TOKENS_FILE = "../outputs/<file>.json"');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[tokens] ERROR: ${(error as Error).message}`);
  process.exit(1);
});
