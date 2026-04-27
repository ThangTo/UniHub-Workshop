import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RegistrationModule } from '../registration/registration.module';
import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { StaffAssignmentController } from './staff-assignment.controller';

@Module({
  imports: [AuthModule, RegistrationModule],
  controllers: [CheckinController, StaffAssignmentController],
  providers: [CheckinService],
  exports: [CheckinService],
})
export class CheckinModule {}
