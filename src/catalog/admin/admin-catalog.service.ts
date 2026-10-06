import { Injectable } from '@nestjs/common';
import { notImplemented } from '../../common/exceptions/not-implemented';
import type {
  AdjustStockDto,
  AdminCategoryDto,
  AdminCategoryListDto,
  AdminProductDto,
  AdminProductListDto,
  AdminVariantDto,
  AdminVariantListDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateUploadDto,
  GenerateVariantsDto,
  ImportResultDto,
  InventoryListDto,
  ListAdminProductsQueryDto,
  ListInventoryQueryDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
  UploadTicketDto,
} from '../dto/admin-catalog.dto';

/** Admin catalog management (CAT-5, CAT-6). */
@Injectable()
export class AdminCatalogService {
  listProducts(_query: ListAdminProductsQueryDto): Promise<AdminProductListDto> {
    return notImplemented('adminListProducts');
  }
  createProduct(_input: CreateProductDto): Promise<AdminProductDto> {
    return notImplemented('adminCreateProduct');
  }
  getProduct(_id: string): Promise<AdminProductDto> {
    return notImplemented('adminGetProduct');
  }
  updateProduct(_id: string, _input: UpdateProductDto): Promise<AdminProductDto> {
    return notImplemented('adminUpdateProduct');
  }
  deleteProduct(_id: string): Promise<void> {
    return notImplemented('adminDeleteProduct');
  }
  importProducts(_csv: Buffer | undefined, _dryRun: boolean): Promise<ImportResultDto> {
    return notImplemented('adminImportProducts');
  }
  listVariants(_productId: string): Promise<AdminVariantListDto> {
    return notImplemented('adminListVariants');
  }
  generateVariants(_productId: string, _input: GenerateVariantsDto): Promise<AdminVariantListDto> {
    return notImplemented('adminGenerateVariants');
  }
  updateVariant(_id: string, _input: UpdateVariantDto): Promise<AdminVariantDto> {
    return notImplemented('adminUpdateVariant');
  }
  adjustStock(_id: string, _input: AdjustStockDto, _actorId?: string): Promise<AdminVariantDto> {
    return notImplemented('adminAdjustStock');
  }
  listInventory(_query: ListInventoryQueryDto): Promise<InventoryListDto> {
    return notImplemented('adminListInventory');
  }
  listCategories(): Promise<AdminCategoryListDto> {
    return notImplemented('adminListCategories');
  }
  createCategory(_input: CreateCategoryDto): Promise<AdminCategoryDto> {
    return notImplemented('adminCreateCategory');
  }
  updateCategory(_id: string, _input: UpdateCategoryDto): Promise<AdminCategoryDto> {
    return notImplemented('adminUpdateCategory');
  }
  deleteCategory(_id: string): Promise<void> {
    return notImplemented('adminDeleteCategory');
  }
  createUpload(_input: CreateUploadDto): Promise<UploadTicketDto> {
    return notImplemented('adminCreateUpload');
  }
}
