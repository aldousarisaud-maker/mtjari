import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { AuditModule } from '../audit/audit.module';
import { STORAGE, createStorage } from '../storage/storage';
import { CatalogController } from './catalog.controller';
import { CsvService } from './csv.service';
import { InventoryService } from './inventory.service';
import { MediaService } from './media.service';
import { ProductsService } from './products.service';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [AuditModule],
  controllers: [CatalogController],
  providers: [
    { provide: STORAGE, inject: [ENV], useFactory: (env: Env) => createStorage(env) },
    TaxonomyService, ProductsService, InventoryService, MediaService, CsvService,
  ],
  exports: [InventoryService],
})
export class CatalogModule {}
