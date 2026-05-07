import type { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

export type RoleName = 'STUDENT' | 'ORGANIZER' | 'CHECKIN_STAFF' | 'SYS_ADMIN';

export const DEMO_PASSWORD = 'Demo@12345';

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

export interface DemoContext {
  srcRoot: string;
  apiBaseUrl: string;
}

export function createContext(): DemoContext {
  const srcRoot = findSrcRoot(process.cwd());
  loadBackendEnv(srcRoot);
  return {
    srcRoot,
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
  };
}

export function createPrisma(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing. Copy src/.env.example to src/apps/backend/.env and run migrations first.');
  }
  const { PrismaClient } = requireBackend<typeof import('@prisma/client')>('@prisma/client');
  return new PrismaClient();
}

export async function assertBackend(apiBaseUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/health`);
  } catch (error) {
    throw new Error(`Backend is not reachable at ${apiBaseUrl}. Start it with: pnpm --filter ./apps/backend dev`);
  }
  if (!res.ok) {
    throw new Error(`Backend health check failed: HTTP ${res.status}`);
  }
}

export async function requestJson<T = unknown>(
  apiBaseUrl: string,
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${apiBaseUrl}${pathOrUrl}`;
  const headers = new Headers(init.headers);
  const hasBody = init.body !== undefined;
  if (hasBody && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body: body as T };
}

export function requireOk<T>(result: ApiResult<T>, label: string): T {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label} failed: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

export function signAccessToken(userId: string, roles: RoleName[]): string {
  const rawPrivateKey = process.env.JWT_PRIVATE_KEY;
  if (!rawPrivateKey) {
    throw new Error(
      'JWT_PRIVATE_KEY is missing. Demo scripts need stable JWT keys in apps/backend/.env; ephemeral backend keys cannot be reproduced.',
    );
  }

  const privateKey = decodeEnvValue(rawPrivateKey);
  const issuer = process.env.JWT_ISSUER ?? 'unihub-workshop';
  const jwt = requireBackend<typeof import('jsonwebtoken')>('jsonwebtoken');
  return jwt.sign(
    { sub: userId, roles, jti: crypto.randomUUID() },
    privateKey,
    { algorithm: 'RS256', issuer, expiresIn: '15m' },
  );
}

export async function ensureUserWithRoles(
  prisma: PrismaClient,
  email: string,
  fullName: string,
  roles: RoleName[],
  studentCode?: string,
): Promise<{ id: string; email: string }> {
  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role },
      update: {},
      create: { name: role },
    });
  }
  const roleRecords = await prisma.role.findMany({ where: { name: { in: roles } } });
  const bcrypt = requireBackend<typeof import('bcrypt')>('bcrypt');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 8);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      passwordHash,
      studentCode: studentCode ?? undefined,
      isActive: true,
    },
    create: {
      email,
      fullName,
      passwordHash,
      studentCode,
      isActive: true,
    },
  });

  await prisma.userRole.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.createMany({
    data: roleRecords.map((role) => ({ userId: user.id, roleId: role.id })),
    skipDuplicates: true,
  });

  return { id: user.id, email: user.email };
}

export async function ensureStudentUser(
  prisma: PrismaClient,
  code: string,
  email: string,
  fullName: string,
): Promise<{ id: string; email: string; studentCode: string }> {
  await prisma.student.upsert({
    where: { studentCode: code },
    update: {
      fullName,
      email,
      faculty: 'CNTT',
      cohort: '2026',
      isActive: true,
      lastSyncedAt: new Date(),
    },
    create: {
      studentCode: code,
      fullName,
      email,
      faculty: 'CNTT',
      cohort: '2026',
      isActive: true,
      sourceExportedAt: new Date(),
    },
  });

  const user = await ensureUserWithRoles(prisma, email, fullName, ['STUDENT'], code);
  return { ...user, studentCode: code };
}

export async function ensureOrganizer(prisma: PrismaClient): Promise<{ id: string; email: string }> {
  return ensureUserWithRoles(prisma, 'organizer@unihub.local', 'Organizer Demo', ['ORGANIZER']);
}

export async function createPublishedWorkshop(
  apiBaseUrl: string,
  organizerToken: string,
  opts: { title: string; capacity: number; feeAmount: number; startsInHours?: number },
): Promise<{ id: string; title: string }> {
  const startsInHours = opts.startsInHours ?? 24 * 7;
  const startAt = new Date(Date.now() + startsInHours * 3600_000);
  const endAt = new Date(startAt.getTime() + 2 * 3600_000);
  const created = requireOk<{ id: string; title: string }>(
    await requestJson(apiBaseUrl, '/workshops', {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        title: opts.title,
        description: 'Phase 8 demo workshop',
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        capacity: opts.capacity,
        feeAmount: opts.feeAmount,
      }),
    }),
    'create workshop',
  );

  requireOk(
    await requestJson(apiBaseUrl, `/workshops/${created.id}/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${organizerToken}` },
    }),
    'publish workshop',
  );

  return { id: created.id, title: created.title };
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function shortId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function studentCodeFor(runSeed: number, index: number): string {
  return String(820_000_000 + (runSeed % 900_000) + index);
}

function findSrcRoot(start: string): string {
  let current = path.resolve(start);
  for (;;) {
    const pkg = path.join(current, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
        if (parsed.name === 'unihub-workshop') return current;
      } catch {
        // keep walking up
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Cannot locate src/package.json from ${start}`);
}

function loadBackendEnv(srcRoot: string): void {
  for (const file of [path.join(srcRoot, 'apps', 'backend', '.env'), path.join(srcRoot, '.env')]) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = decodeEnvValue(trimmed.slice(eq + 1).trim());
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

function requireBackend<T>(moduleName: string): T {
  const srcRoot = findSrcRoot(process.cwd());
  const backendRequire = createRequire(path.join(srcRoot, 'apps', 'backend', 'package.json'));
  return backendRequire(moduleName) as T;
}

function decodeEnvValue(value: string): string {
  let v = value;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.replace(/\\n/g, '\n');
}
