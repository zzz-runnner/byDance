import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Controller('api')
export class AppController {
  constructor(private readonly config: ConfigService) {}

  @Get('health')
  health(): Record<string, unknown> {
    return {
      ok: true,
      service: 'agenthub-backend',
      agentHubBaseUrl: this.config.get<string>('AGENTHUB_BASE_URL'),
      storageRoot: this.config.get<string>('APP_STORAGE_ROOT'),
    }
  }
}
