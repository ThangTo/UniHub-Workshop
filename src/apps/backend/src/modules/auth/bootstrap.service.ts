import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfigService } from '../../common/config/app-config.service';
import { ALL_ROLES } from '../../common/types/role.enum';

/**
 * BootstrapService theo auth.md §G:
 *
 * 1. Seed 4 roles nếu chưa có.
 * 2. Seed SYS_ADMIN đầu tiên từ env BOOTSTRAP_ADMIN_EMAIL/PASSWORD.
 * 3. Fail-fast nếu thiếu env bootstrap admin khi DB chưa có SYS_ADMIN.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedRoles();
    await this.seedAdmin();
  }

  private async seedRoles(): Promise<void> {
    for (const name of ALL_ROLES) {
      await this.prisma.role.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    }
    this.logger.log(`Roles seeded: ${ALL_ROLES.join(', ')}`);
  }

  private async seedAdmin(): Promise<void> {
    const adminRole = await this.prisma.role.findUnique({ where: { name: 'SYS_ADMIN' } });
    if (!adminRole) throw new Error('Role SYS_ADMIN missing after seedRoles');

    // Kiểm tra đã có SYS_ADMIN chưa
    const existingAdmin = await this.prisma.userRole.findFirst({
      where: { roleId: adminRole.id },
    });
    if (existingAdmin) {
      this.logger.log('SYS_ADMIN already exists; skip bootstrap');
      return;
    }

    const { bootstrapAdminEmail, bootstrapAdminPassword, bootstrapAdminName } = this.cfg.auth;

    if (!bootstrapAdminEmail || !bootstrapAdminPassword) {
      throw new Error(
        'No SYS_ADMIN in DB and BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set. Cannot start.',
      );
    }

    const passwordHash = await bcrypt.hash(bootstrapAdminPassword, this.cfg.auth.bcryptCost);

    const user = await this.prisma.user.upsert({
      where: { email: bootstrapAdminEmail },
      update: {},
      create: {
        email: bootstrapAdminEmail,
        passwordHash,
        fullName: bootstrapAdminName,
        roles: { create: { roleId: adminRole.id } },
      },
    });

    this.logger.log(`SYS_ADMIN bootstrapped: ${user.email} (id=${user.id})`);
  }
}
