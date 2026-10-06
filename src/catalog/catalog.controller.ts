import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import {
  CategoryListDto,
  ListProductsQueryDto,
  ProductDetailDto,
  ProductListDto,
  ProductSlugParamDto,
  SearchSuggestQueryDto,
  SearchSuggestResponseDto,
} from './dto/catalog.dto';

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @ApiOperation({ operationId: 'listCategories', summary: 'Active categories with product counts' })
  @ZodResponse({ status: 200, type: CategoryListDto, description: 'Categories by sortOrder' })
  listCategories() {
    return this.catalog.listCategories();
  }

  @Get('products')
  @ApiOperation({
    operationId: 'listProducts',
    summary: 'Product cards (ACTIVE only): filter, sort, paginate',
  })
  @ZodResponse({ status: 200, type: ProductListDto, description: 'Paginated product cards' })
  @ApiErrors(400)
  listProducts(@Query() query: ListProductsQueryDto) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:slug')
  @ApiOperation({
    operationId: 'getProductBySlug',
    summary: 'Product detail page data (priceTiers only for approved B2B users)',
  })
  @ZodResponse({ status: 200, type: ProductDetailDto, description: 'Product detail' })
  @ApiErrors(400, 404)
  getProductBySlug(
    @Param() params: ProductSlugParamDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.catalog.getProductBySlug(params.slug, user);
  }

  @Get('search/suggest')
  @ApiOperation({ operationId: 'searchSuggest', summary: 'Typeahead suggestions (pg_trgm)' })
  @ZodResponse({ status: 200, type: SearchSuggestResponseDto, description: 'Suggestions' })
  @ApiErrors(400)
  searchSuggest(@Query() query: SearchSuggestQueryDto) {
    return this.catalog.searchSuggest(query);
  }
}
