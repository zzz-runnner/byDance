import { BadRequestException, Injectable } from '@nestjs/common'
import { AgentHubClientService } from '../agent-hub/agent-hub.service'
import { CreateAgentDto, UpdateAgentDto } from './agents.dto'

@Injectable()
export class AgentsService {
  constructor(private readonly agentHub: AgentHubClientService) {}

  listAgents() {
    throw new BadRequestException('Global agents are not supported. Use /api/projects/:projectId/agents.')
  }

  getAgent(agentId: string) {
    throw new BadRequestException(`Global agent lookup is not supported: ${agentId}`)
  }

  createAgent(input: CreateAgentDto) {
    void input
    throw new BadRequestException('Use /api/projects/:projectId/agents to create group-workspace custom agents.')
  }

  updateAgent(agentId: string, input: UpdateAgentDto) {
    void input
    throw new BadRequestException(`Use /api/projects/:projectId/agents/${encodeURIComponent(agentId)} to update a project-scoped agent.`)
  }

  deleteAgent(agentId: string) {
    throw new BadRequestException(`Use /api/projects/:projectId/agents/${encodeURIComponent(agentId)} to delete a project-scoped custom agent.`)
  }
}
