import { Module } from '@nestjs/common'
import { AgentHubClientService } from './agent-hub.service'

@Module({
  providers: [AgentHubClientService],
  exports: [AgentHubClientService],
})
export class AgentHubModule {}
