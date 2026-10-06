import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import {
  AdjustStockDto,
  AdminVariantDto,
  InventoryListDto,
  ListInventoryQueryDto,
  UpdateVariantDto,
} from '../dto/admin-catalog.dto';
import { AdminCatalogService } from './admin-catalog.service';

@ApiTags('admin-catalog')
@Roles('STAFF', 'ADMIN')
@Controller('admin')
export class AdminVariantsController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Patch('variants/:id')
  @ApiOperation({ operationId: 'adminUpdateVariant', summary: 'Update SKU, title, price, active' })
  @ZodResponse({ status: 200, type: AdminVariantDto, description: 'Updated' })
  @ApiErrors(400, 404, [409, 'CONFLICT: SKU taken'])
  updateVariant(@Param() params: IdParamDto, @Body() body: UpdateVariantDto) {
    return this.catalog.updateVariant(params.id, body);
  }

  @Patch('variants/:id/stock')
  @ApiOperation({
    operationId: 'adminAdjustStock',
    summary: 'Adjust stock by a delta with a reason (writes an InventoryMovement)',
  })
  @ZodResponse({ status: 200, type: AdminVariantDto, description: 'Updated variant' })
  @ApiErrors(400, 404, [409, 'INSUFFICIENT_STOCK: stock would drop below reserved'])
  adjustStock(
    @Param() params: IdParamDto,
    @Body() body: AdjustStockDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.catalog.adjustStock(params.id, body, user?.id);
  }

  @Get('inventory')
  @ApiOperation({ operationId: 'adminListInventory', summary: 'Variant stock levels' })
  @ZodResponse({ status: 200, type: InventoryListDto, description: 'Paginated stock rows' })
  @ApiErrors(400)
  listInventory(@Query() query: ListInventoryQueryDto) {
    return this.catalog.listInventory(query);
  }
}
