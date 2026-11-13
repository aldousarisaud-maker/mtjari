import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({ imports: [AuditModule], controllers: [StoresController], providers: [StoresService] })
export class StoresModule {}
