import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { Observable, filter, map } from 'rxjs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { InAppChannel } from './channels/inapp.channel';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inApp: InAppChannel,
  ) {}

  @Roles('STUDENT', 'ORGANIZER', 'CHECKIN_STAFF', 'SYS_ADMIN')
  @Get('me')
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('unread') unread?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.prisma.notification.findMany({
      where: {
        userId: user.id,
        channel: 'IN_APP',
        ...(unread === 'true' ? { status: { not: NotificationStatus.READ } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit ?? 20,
    });
  }

  @Roles('STUDENT', 'ORGANIZER', 'CHECKIN_STAFF', 'SYS_ADMIN')
  @Post(':id/read')
  @HttpCode(200)
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { status: NotificationStatus.READ },
    });
    return { ok: true, updated: result.count };
  }

  /**
   * SSE stream cho client online (specs/notification.md In-App).
   */
  @Roles('STUDENT', 'ORGANIZER', 'CHECKIN_STAFF', 'SYS_ADMIN')
  @Sse('stream')
  stream(@CurrentUser() user: AuthenticatedUser): Observable<{ data: unknown }> {
    return this.inApp.asObservable().pipe(
      filter((evt) => evt.userId === user.id),
      map((evt) => ({ data: evt })),
    );
  }
}
