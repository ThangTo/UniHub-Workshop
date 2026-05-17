import * as fs from 'fs';
import * as path from 'path';
import {
  createContext,
  createPrisma,
  ensureStudentUser,
  requestJson,
  shortId,
  signAccessToken,
} from './_lib';

interface Args {
  count: number;
  out: string;
}

function parseArgs(): Args {
  const countArg = process.argv.find((x) => x.startsWith('--count='));
  const outArg = process.argv.find((x) => x.startsWith('--out='));
  const count = countArg ? Number(countArg.split('=')[1]) : Number(process.env.TOKEN_COUNT ?? 500);
  if (!Number.isInteger(count) || count < 1 || count > 5000) {
    throw new Error('--count must be an integer from 1 to 5000');
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
  const baseCode = 830_000_000 + (Date.now() % 1_000_000);
  const tokens: string[] = [];

  try {
    for (let i = 0; i < args.count; i += 1) {
      const code = String(baseCode + i);
      const email = `${runId}-${i}@k6.unihub.local`;
      const user = await ensureStudentUser(prisma, code, email, `K6 Student ${i + 1}`);
      tokens.push(signAccessToken(user.id, ['STUDENT']));
      if ((i + 1) % 100 === 0 || i + 1 === args.count) {
        console.log(`[tokens] prepared ${i + 1}/${args.count}`);
      }
    }

    const outPath = path.resolve(ctx.srcRoot, args.out);
    fs.writeFileSync(outPath, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
    console.log(`[tokens] wrote ${tokens.length} tokens to ${outPath}`);
    console.log('[tokens] use: $env:TOKENS_FILE = ".\\tokens.json"');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[tokens] ERROR: ${(error as Error).message}`);
  process.exit(1);
});
