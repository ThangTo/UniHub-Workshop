import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';

/**
 * Admin user endpoints theo auth.md §G.
 *
 * POST /admin/users             — tạo user (ORGANIZER/CHECKIN_STAFF)
 * POST /admin/users/:id/roles   — gán roles
 * GET  /admin/users             — list users
 */
@Controller('admin/users')
@Roles('SYS_ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.users.createUser(dto, user.id);
  }

  @Post(':id/roles')
  async assignRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.assignRoles(id, dto, user.id);
  }

  @Get()
  async list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.users.listUsers(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
