import { Module } from '@nestjs/common'
import { AgentHubModule } from '../agent-hub/agent-hub.module'
import { AgentsController } from './agents.controller'
import { AgentsService } from './agents.service'

@Module({
  imports: [AgentHubModule],
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
