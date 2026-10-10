import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../common/decorators/public.decorator';
import { AppConfigService } from '../config/app-config.service';
import { AuthOptionsDto } from './dto/auth-options.dto';

/** Which sign-in methods the storefront should offer (ADR-019). */
@ApiTags('auth')
@Public()
@Controller('auth-options')
export class AuthOptionsController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  @ApiOperation({ operationId: 'getAuthOptions', summary: 'Sign-in methods offered (public)' })
  @ZodResponse({ status: 200, type: AuthOptionsDto, description: 'Enabled sign-in methods' })
  get(): AuthOptionsDto {
    return { google: Boolean(this.config.get('GOOGLE_CLIENT_ID')) };
  }
}
