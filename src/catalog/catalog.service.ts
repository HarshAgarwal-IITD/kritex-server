import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type {
  CategoryListDto,
  ListProductsQueryDto,
  ProductDetailDto,
  ProductListDto,
  SearchSuggestQueryDto,
  SearchSuggestResponseDto,
} from './dto/catalog.dto';
import type { SessionUser } from '../common/decorators/current-user.decorator';

/** Public catalog reads (CAT-1..4). */
@Injectable()
export class CatalogService {
  listCategories(): Promise<CategoryListDto> {
    return notImplemented('listCategories');
  }

  listProducts(_query: ListProductsQueryDto): Promise<ProductListDto> {
    return notImplemented('listProducts');
  }

  /** `user` decides `purchasable` and whether `priceTiers` are included (approved B2B only). */
  getProductBySlug(_slug: string, _user: SessionUser | undefined): Promise<ProductDetailDto> {
    return notImplemented('getProductBySlug');
  }

  searchSuggest(_query: SearchSuggestQueryDto): Promise<SearchSuggestResponseDto> {
    return notImplemented('searchSuggest');
  }
}
