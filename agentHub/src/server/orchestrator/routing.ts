import type { AgentDefinition, Conversation, MainBrainTurn, RoutingTaskBrief } from '@shared/contracts'

export type RoutingInput = {
  content: string
  conversation: Conversation
  agents: AgentDefinition[]
  targetAgentId?: string
}

/**
 * Chooses a target agent mentioned by id or display name in the user message.
 * Input: raw message text and available agents. Output: matched agent id or undefined.
 */
function findMentionedAgent(content: string, agents: AgentDefinition[]): string | undefined {
  const normalized = content.toLowerCase()
  return agents.find(agent => normalized.includes(`@${agent.id}`) || normalized.includes(`@${agent.name.toLowerCase()}`))
    ?.id
}

/**
 * Checks whether a user message describes implementation work.
 * Input: raw message text. Output: true when the task should involve engineering.
 */
function needsEngineering(content: string): boolean {
  return /实现|修改|修复|代码|页面|网页|预览|build|preview|diff|bug|frontend|backend|api/i.test(content)
}

/**
 * Checks whether a user message mainly asks for review or validation.
 * Input: raw message text. Output: true when the task should involve reviewer.
 */
function needsReview(content: string): boolean {
  return /检查|审查|验收|测试|review|validate|verify|qa/i.test(content)
}

/**
 * Builds a standard routing task brief for a child agent.
 * Input: target agent id, task text, and expected output. Output: task brief.
 */
function taskBrief(agentId: string, task: string, expectedOutput: string): RoutingTaskBrief {
  return {
    agentId,
    task,
    requiredContext: ['projectBrief', 'pinnedMessages', 'recentMessages', 'artifacts'],
    expectedOutput,
  }
}

/**
 * Produces a deterministic fallback main-brain turn for explicit routes and model failures.
 * Input: user message, conversation, agents, and optional explicit target. Output: main-brain turn.
 */
export function decideRouting(input: RoutingInput): MainBrainTurn {
  const mentionedAgentId = input.targetAgentId ?? findMentionedAgent(input.content, input.agents)
  if (mentionedAgentId) {
    return {
      kind: 'dispatch_agents',
      targetAgents: [mentionedAgentId],
      execution: 'serial',
      speakerAgentId: mentionedAgentId,
      finalizationMode: 'speaker_direct',
      dispatches: [
        taskBrief(
          mentionedAgentId,
          input.content,
          'Return a concise result for the selected direct agent task.',
        ),
      ],
    }
  }

  const directAgent = input.conversation.type === 'direct'
    ? input.conversation.participants.find(participant => participant !== 'user')
    : undefined
  if (directAgent) {
    return {
      kind: 'dispatch_agents',
      targetAgents: [directAgent],
      execution: 'serial',
      speakerAgentId: directAgent,
      finalizationMode: 'speaker_direct',
      dispatches: [
        taskBrief(directAgent, input.content, 'Return a direct agent reply with next-step detail.'),
      ],
    }
  }

  if (needsEngineering(input.content)) {
    const briefs = [
      taskBrief(
        'product-manager',
        `Clarify scope and acceptance criteria for: ${input.content}`,
        'Return feature scope, acceptance criteria, and risks.',
      ),
      taskBrief(
        'engineer',
        `Implement or outline the technical work for: ${input.content}`,
        'Return implementation summary, changed files, tests, and preview status.',
      ),
      taskBrief(
        'reviewer',
        `Review the result for: ${input.content}`,
        'Return PASS/PARTIAL/FAIL with concrete findings.',
      ),
    ]

    return {
      kind: 'dispatch_agents',
      targetAgents: briefs.map(brief => brief.agentId),
      execution: 'serial',
      speakerAgentId: 'orchestrator',
      finalizationMode: 'main_synthesis',
      dispatches: briefs,
    }
  }

  if (needsReview(input.content)) {
    return {
      kind: 'dispatch_agents',
      targetAgents: ['reviewer'],
      execution: 'serial',
      speakerAgentId: 'reviewer',
      finalizationMode: 'speaker_direct',
      dispatches: [taskBrief('reviewer', input.content, 'Return validation findings and a clear verdict.')],
    }
  }

  return {
    kind: 'direct_answer',
    targetAgents: [],
    execution: 'serial',
    speakerAgentId: 'orchestrator',
    finalizationMode: 'speaker_direct',
    dispatches: [],
    finalResponse:
      '主脑模型这次没有返回稳定结构，我已经记录这条消息。你可以换一种说法继续，或直接 @engineer / @reviewer 指定子 Agent。',
  }
}
