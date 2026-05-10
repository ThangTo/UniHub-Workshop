import { ForbiddenException } from '@nestjs/common';
import { WorkshopStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service';
import { AuthenticatedUser } from '../../common/types/auth.types';

function makeService(createdBy = 'owner-user-id') {
  const workshop = {
    id: 'workshop-id',
    title: 'Ownership Test',
    description: 'demo',
    speakerId: null,
    roomId: null,
    startAt: new Date(Date.now() + 86_400_000),
    endAt: new Date(Date.now() + 90_000_000),
    capacity: 10,
    feeAmount: 0,
    bannerUrl: null,
    pdfObjectKey: null,
    pdfSha256: null,
    summary: null,
    summaryHighlights: null,
    summaryStatus: 'NONE',
    createdBy,
    status: WorkshopStatus.DRAFT,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const tx = {
    workshop: {
      update: vi.fn().mockResolvedValue({
        ...workshop,
        status: WorkshopStatus.PUBLISHED,
        version: 2,
      }),
    },
  };
  const prisma = {
    workshop: {
      findUnique: vi.fn().mockResolvedValue(workshop),
    },
    $transaction: vi.fn((fn: (txArg: typeof tx) => unknown) => fn(tx)),
  };
  const redisClient = {
    scan: vi.fn().mockResolvedValue(['0', []]),
    del: vi.fn().mockResolvedValue(0),
    set: vi.fn().mockResolvedValue('OK'),
  };
  const redis = { getClient: vi.fn().mockReturnValue(redisClient) };
  const outbox = { append: vi.fn().mockResolvedValue(undefined) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };

  const service = new CatalogService(
    prisma as any,
    redis as any,
    outbox as any,
    audit as any,
  );

  return { service, prisma, outbox, audit, tx };
}

function user(id: string, roles: AuthenticatedUser['roles']): AuthenticatedUser {
  return { id, roles, jti: 'jti' };
}

describe('CatalogService ownership', () => {
  it('blocks an organizer from publishing another organizer workshop', async () => {
    const { service, prisma } = makeService('owner-user-id');

    await expect(service.publish('workshop-id', user('other-user-id', ['ORGANIZER'])))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows the owner to publish and writes an audit log', async () => {
    const { service, audit, outbox } = makeService('owner-user-id');

    const result = await service.publish('workshop-id', user('owner-user-id', ['ORGANIZER']));

    expect(result.status).toBe(WorkshopStatus.PUBLISHED);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'workshop.published' }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'owner-user-id',
        action: 'workshop_published',
        resource: 'workshop',
        resourceId: 'workshop-id',
      }),
    );
  });

  it('allows SYS_ADMIN to publish any organizer workshop', async () => {
    const { service } = makeService('owner-user-id');

    const result = await service.publish('workshop-id', user('admin-user-id', ['SYS_ADMIN']));

    expect(result.status).toBe(WorkshopStatus.PUBLISHED);
  });

  it('builds public seat snapshots from PUBLISHED workshops only', async () => {
    const prisma = {
      workshop: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'published-1', capacity: 20 },
          { id: 'published-2', capacity: 10 },
        ]),
      },
    };
    const redisClient = {
      mget: vi.fn().mockResolvedValue(['8', 'not-a-number']),
    };
    const service = new CatalogService(
      prisma as any,
      { getClient: vi.fn().mockReturnValue(redisClient) } as any,
      { append: vi.fn() } as any,
      { log: vi.fn() } as any,
    );

    const snapshot = await service.publishedSeatSnapshot();

    expect(prisma.workshop.findMany).toHaveBeenCalledWith({
      where: { status: WorkshopStatus.PUBLISHED },
      select: { id: true, capacity: true },
      orderBy: { startAt: 'asc' },
    });
    expect(redisClient.mget).toHaveBeenCalledWith('seat:published-1', 'seat:published-2');
    expect(snapshot).toEqual({ 'published-1': 8, 'published-2': 10 });
  });
});
