import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type { DashboardDto } from './dto/dashboard.dto';

@Injectable()
export class DashboardService {
  get(): Promise<DashboardDto> {
    return notImplemented('adminGetDashboard');
  }
}
