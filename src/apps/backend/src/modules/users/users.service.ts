import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';

/**
 * Admin user management theo auth.md §G.
 *
 * Chỉ SYS_ADMIN:
 * - Tạo tài khoản ORGANIZER / CHECKIN_STAFF.
 * - Gán/thay đổi roles.
 * - List users.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async createUser(dto: CreateUserDto, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException({ code: 'email_already_used', message: 'Email đã tồn tại.' });
    }

    const passwordHash = await bcrypt.hash(dto.password, this.cfg.auth.bcryptCost);

    const roleRecords = await this.prisma.role.findMany({
      where: { name: { in: dto.roles } },
    });
    if (roleRecords.length !== dto.roles.length) {
      throw new NotFoundException('Một hoặc nhiều role không hợp lệ.');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        phone: dto.phone ?? null,
        roles: {
          create: roleRecords.map((r) => ({ roleId: r.id })),
        },
      },
      include: { roles: { include: { role: true } } },
    });

    await this.audit.log({
      actorId,
      action: 'user_created',
      resource: 'user',
      resourceId: user.id,
      metadata: { email: dto.email, roles: dto.roles },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles.map((ur) => ur.role.name),
    };
  }

  async assignRoles(userId: string, dto: AssignRolesDto, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('user_not_found');

    const roleRecords = await this.prisma.role.findMany({
      where: { name: { in: dto.roles } },
    });
    if (roleRecords.length !== dto.roles.length) {
      throw new NotFoundException('Một hoặc nhiều role không hợp lệ.');
    }

    // Xoá roles cũ, gán mới
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      ...roleRecords.map((r) =>
        this.prisma.userRole.create({ data: { userId, roleId: r.id } }),
      ),
    ]);

    await this.audit.log({
      actorId,
      action: 'role_changed',
      resource: 'user',
      resourceId: userId,
      metadata: { newRoles: dto.roles },
    });

    return { userId, roles: dto.roles };
  }

  async listUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { roles: { include: { role: true } } },
      }),
      this.prisma.user.count(),
    ]);

    return {
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        studentCode: u.studentCode,
        isActive: u.isActive,
        roles: u.roles.map((ur) => ur.role.name),
        createdAt: u.createdAt,
      })),
      total,
      page,
      limit,
    };
  }
}
