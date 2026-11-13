import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InvitationsController, MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({ imports: [AuditModule], controllers: [MembersController, InvitationsController], providers: [MembersService] })
export class MembersModule {}
