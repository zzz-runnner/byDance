import { Injectable } from '@nestjs/common'
import { AgentHubClientService } from '../agent-hub/agent-hub.service'
import { CreateAgentDto, UpdateAgentDto } from './agents.dto'

@Injectable()
export class AgentsService {
  constructor(private readonly agentHub: AgentHubClientService) {}

  listAgents() {
    return this.agentHub.fetchAgents()
  }

  getAgent(agentId: string) {
    return this.agentHub.fetchAgent(agentId)
  }

  createAgent(input: CreateAgentDto) {
    return this.agentHub.createAgent(input)
  }

  updateAgent(agentId: string, input: UpdateAgentDto) {
    return this.agentHub.updateAgent(agentId, input)
  }

  deleteAgent(agentId: string) {
    return this.agentHub.deleteAgent(agentId)
  }
}
