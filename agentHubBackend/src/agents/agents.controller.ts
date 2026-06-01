import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { CreateAgentDto, UpdateAgentDto } from './agents.dto'
import { AgentsService } from './agents.service'

@Controller('api/agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  listAgents() {
    return this.agents.listAgents()
  }

  @Get(':agentId')
  getAgent(@Param('agentId') agentId: string) {
    return this.agents.getAgent(agentId)
  }

  @Post()
  createAgent(@Body() input: CreateAgentDto) {
    return this.agents.createAgent(input)
  }

  @Patch(':agentId')
  updateAgent(
    @Param('agentId') agentId: string,
    @Body() input: UpdateAgentDto,
  ) {
    return this.agents.updateAgent(agentId, input)
  }

  @Delete(':agentId')
  deleteAgent(@Param('agentId') agentId: string) {
    return this.agents.deleteAgent(agentId)
  }
}
