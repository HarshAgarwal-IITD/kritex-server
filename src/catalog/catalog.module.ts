import { Module } from '@nestjs/common';
import { AdminCatalogService } from './admin/admin-catalog.service';
import { AdminCategoriesController } from './admin/admin-categories.controller';
import { AdminProductsController } from './admin/admin-products.controller';
import { AdminUploadsController } from './admin/admin-uploads.controller';
import { AdminVariantsController } from './admin/admin-variants.controller';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [
    CatalogController,
    AdminProductsController,
    AdminVariantsController,
    AdminCategoriesController,
    AdminUploadsController,
  ],
  providers: [CatalogService, AdminCatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
