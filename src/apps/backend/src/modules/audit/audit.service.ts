import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface AuditLogInput {
  actorId?: string | null;
  action: string; // vd: 'login_success', 'role_changed', 'workshop_created'
  resource?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Append-only audit log (auth.md §H.4 + design.md §6).
 * Best-effort: lỗi DB không nên làm fail user request, chỉ log warn.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: input.action,
          resource: input.resource ?? null,
          resourceId: input.resourceId ?? null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          ipAddress: input.ipAddress ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`audit failed action=${input.action}: ${(e as Error).message}`);
    }
  }
}
