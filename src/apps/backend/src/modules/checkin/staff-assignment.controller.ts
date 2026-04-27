import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AssignStaffDto } from './dto/assign-staff.dto';

/**
 * Quản lý phân công staff phụ trách phòng cho workshop (specs/checkin.md ràng buộc §"Bảo mật").
 * Chỉ ORGANIZER/SYS_ADMIN được gán/xoá.
 */
@Controller('staff-assignments')
export class StaffAssignmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async assign(@Body() dto: AssignStaffDto, @CurrentUser() actor: AuthenticatedUser) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt_must_be_after_startsAt');
    }

    const [staff, workshop, room] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.staffId },
        include: { roles: { include: { role: true } } },
      }),
      this.prisma.workshop.findUnique({ where: { id: dto.workshopId } }),
      this.prisma.room.findUnique({ where: { id: dto.roomId } }),
    ]);
    if (!staff) throw new NotFoundException('staff_not_found');
    if (!workshop) throw new NotFoundException('workshop_not_found');
    if (!room) throw new NotFoundException('room_not_found');
    const hasRole = staff.roles.some((r) => r.role.name === 'CHECKIN_STAFF');
    if (!hasRole) {
      throw new BadRequestException({ code: 'staff_missing_role', message: 'User must have CHECKIN_STAFF role' });
    }

    const result = await this.prisma.staffRoomAssignment.upsert({
      where: { staffId_workshopId: { staffId: dto.staffId, workshopId: dto.workshopId } },
      update: { roomId: dto.roomId, startsAt, endsAt },
      create: {
        staffId: dto.staffId,
        workshopId: dto.workshopId,
        roomId: dto.roomId,
        startsAt,
        endsAt,
      },
    });

    void this.audit.log({
      actorId: actor.id,
      action: 'staff_assignment_upsert',
      resource: 'staff_room_assignment',
      resourceId: `${dto.staffId}:${dto.workshopId}`,
      metadata: { roomId: dto.roomId, startsAt, endsAt },
    });

    return result;
  }

  @Roles('ORGANIZER', 'SYS_ADMIN', 'CHECKIN_STAFF')
  @Get()
  async list(
    @Query('staffId') staffId?: string,
    @Query('workshopId') workshopId?: string,
  ) {
    return this.prisma.staffRoomAssignment.findMany({
      where: {
        ...(staffId ? { staffId } : {}),
        ...(workshopId ? { workshopId } : {}),
      },
      include: {
        staff: { select: { id: true, fullName: true, email: true } },
        workshop: { select: { id: true, title: true } },
        room: { select: { id: true, name: true, code: true } },
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Delete()
  async unassign(
    @Query('staffId') staffId: string,
    @Query('workshopId') workshopId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!staffId || !workshopId) {
      throw new BadRequestException('staffId_and_workshopId_required');
    }
    const result = await this.prisma.staffRoomAssignment.deleteMany({
      where: { staffId, workshopId },
    });
    void this.audit.log({
      actorId: actor.id,
      action: 'staff_assignment_delete',
      resource: 'staff_room_assignment',
      resourceId: `${staffId}:${workshopId}`,
    });
    return { deleted: result.count };
  }
}
