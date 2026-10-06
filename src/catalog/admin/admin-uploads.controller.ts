import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateUploadDto, UploadTicketDto } from '../dto/admin-catalog.dto';
import { AdminCatalogService } from './admin-catalog.service';

@ApiTags('admin-catalog')
@Roles('STAFF', 'ADMIN')
@Controller('admin/uploads')
export class AdminUploadsController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Post()
  @ApiOperation({
    operationId: 'adminCreateUpload',
    summary: 'Presigned R2 upload URL (local-disk driver in dev)',
  })
  @ZodResponse({ status: 201, type: UploadTicketDto, description: 'Upload ticket' })
  @ApiErrors(400)
  create(@Body() body: CreateUploadDto) {
    return this.catalog.createUpload(body);
  }
}
