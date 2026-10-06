import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import {
  AdminProductDto,
  AdminProductListDto,
  AdminVariantListDto,
  CreateProductDto,
  GenerateVariantsDto,
  ImportProductsQueryDto,
  ImportResultDto,
  ListAdminProductsQueryDto,
  UpdateProductDto,
} from '../dto/admin-catalog.dto';
import { AdminCatalogService } from './admin-catalog.service';

@ApiTags('admin-catalog')
@Roles('STAFF', 'ADMIN')
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListProducts', summary: 'List products (all statuses)' })
  @ZodResponse({ status: 200, type: AdminProductListDto, description: 'Paginated products' })
  @ApiErrors(400)
  list(@Query() query: ListAdminProductsQueryDto) {
    return this.catalog.listProducts(query);
  }

  @Post()
  @ApiOperation({ operationId: 'adminCreateProduct', summary: 'Create a product' })
  @ZodResponse({ status: 201, type: AdminProductDto, description: 'Created' })
  @ApiErrors(400, [404, 'NOT_FOUND: category'], [409, 'CONFLICT: slug taken'])
  create(@Body() body: CreateProductDto) {
    return this.catalog.createProduct(body);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({
    operationId: 'adminImportProducts',
    summary: 'Bulk upsert products/variants from the product-data CSV template (by SKU)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary', description: 'CSV, max 5 MB' } },
    },
  })
  @ZodResponse({ status: 201, type: ImportResultDto, description: 'Import report' })
  @ApiErrors(400)
  import(
    @Query() query: ImportProductsQueryDto,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    return this.catalog.importProducts(file?.buffer, query.dryRun ?? false);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'adminGetProduct', summary: 'Product with variants (incl. stock)' })
  @ZodResponse({ status: 200, type: AdminProductDto, description: 'Product' })
  @ApiErrors(404)
  get(@Param() params: IdParamDto) {
    return this.catalog.getProduct(params.id);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'adminUpdateProduct', summary: 'Update a product (partial)' })
  @ZodResponse({ status: 200, type: AdminProductDto, description: 'Updated' })
  @ApiErrors(400, 404, [409, 'CONFLICT: slug taken'])
  update(@Param() params: IdParamDto, @Body() body: UpdateProductDto) {
    return this.catalog.updateProduct(params.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'adminDeleteProduct',
    summary: 'Delete a product (archives it instead if it has orders)',
  })
  @ApiResponse({ status: 204, description: 'Deleted or archived' })
  @ApiErrors(404)
  delete(@Param() params: IdParamDto) {
    return this.catalog.deleteProduct(params.id);
  }

  @Get(':id/variants')
  @ApiOperation({ operationId: 'adminListVariants', summary: "A product's variants (incl. stock)" })
  @ZodResponse({ status: 200, type: AdminVariantListDto, description: 'Variants' })
  @ApiErrors(404)
  listVariants(@Param() params: IdParamDto) {
    return this.catalog.listVariants(params.id);
  }

  @Post(':id/variants')
  @ApiOperation({
    operationId: 'adminGenerateVariants',
    summary: 'Bulk-generate variants from the product options (size × colour); idempotent',
  })
  @ZodResponse({
    status: 201,
    type: AdminVariantListDto,
    description: 'All variants after generation',
  })
  @ApiErrors(400, 404, [409, 'CONFLICT: SKU taken'])
  generateVariants(@Param() params: IdParamDto, @Body() body: GenerateVariantsDto) {
    return this.catalog.generateVariants(params.id, body);
  }
}
