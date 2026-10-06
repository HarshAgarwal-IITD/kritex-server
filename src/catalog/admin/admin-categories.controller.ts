import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import {
  AdminCategoryDto,
  AdminCategoryListDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../dto/admin-catalog.dto';
import { AdminCatalogService } from './admin-catalog.service';

@ApiTags('admin-catalog')
@Roles('STAFF', 'ADMIN')
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListCategories', summary: 'All categories (incl. inactive)' })
  @ZodResponse({ status: 200, type: AdminCategoryListDto, description: 'Categories' })
  list() {
    return this.catalog.listCategories();
  }

  @Post()
  @ApiOperation({ operationId: 'adminCreateCategory', summary: 'Create a category' })
  @ZodResponse({ status: 201, type: AdminCategoryDto, description: 'Created' })
  @ApiErrors(400, [409, 'CONFLICT: slug taken'])
  create(@Body() body: CreateCategoryDto) {
    return this.catalog.createCategory(body);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'adminUpdateCategory', summary: 'Update a category (partial)' })
  @ZodResponse({ status: 200, type: AdminCategoryDto, description: 'Updated' })
  @ApiErrors(400, 404, [409, 'CONFLICT: slug taken'])
  update(@Param() params: IdParamDto, @Body() body: UpdateCategoryDto) {
    return this.catalog.updateCategory(params.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'adminDeleteCategory', summary: 'Delete an empty category' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiErrors(404, [409, 'CATEGORY_NOT_EMPTY'])
  delete(@Param() params: IdParamDto) {
    return this.catalog.deleteCategory(params.id);
  }
}
