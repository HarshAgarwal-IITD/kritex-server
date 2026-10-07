import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { DashboardDto, DashboardQueryDto } from './dto/dashboard.dto';

@ApiTags('admin-dashboard')
@Roles('STAFF', 'ADMIN')
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({
    operationId: 'adminGetDashboard',
    summary: 'Revenue, orders by status, low stock, pending quotes/enquiries/B2B approvals',
  })
  @ZodResponse({ status: 200, type: DashboardDto, description: 'Dashboard tiles' })
  @ApiErrors(400)
  get(@Query() query: DashboardQueryDto) {
    return this.dashboard.get(new Date(), query.threshold);
  }
}
