import type { ModelGateway, ModelGatewayRequest, ModelGatewayResponse, ModelGatewayStreamHandlers } from '../types'

/**
 * Splits deterministic mock text into small chunks for streaming tests.
 * Input: text content. Output: ordered text chunks.
 */
function chunkText(text: string): string[] {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += 12) {
    chunks.push(text.slice(index, index + 12))
  }
  return chunks
}

/**
 * Selects a plain-text mock response for final assistant messages.
 * Input: model gateway request. Output: deterministic final response text.
 */
function mockTextResponse(input: ModelGatewayRequest): string {
  if (input.systemPrompt.includes('AgentHub child-agent final responder')) {
    return 'Mock agent streamed a lightweight chat reply.'
  }
  if (input.systemPrompt.includes('AgentHub synthesis final responder')) {
    return 'Mock synthesis streamed the final delivery summary.'
  }
  return 'Mock main brain streamed a direct final reply.'
}

/**
 * Creates a deterministic orchestrator model gateway for parser and fallback checks.
 * Input: none. Output: model gateway implementation.
 */
export function createMockGateway(): ModelGateway {
  return {
    /**
     * Returns a schema-valid direct answer without calling an external model.
     * Input: model gateway request. Output: deterministic model gateway response.
     */
    async generate(input: ModelGatewayRequest): Promise<ModelGatewayResponse> {
      if (input.systemPrompt.includes('AgentHub Turn Router')) {
        const isApproved = /开始实现|可以执行|按.*做|\/run/i.test(input.userPrompt)
        return {
          provider: 'mock',
          model: input.model ?? 'mock-router',
          content: JSON.stringify({
            interactionMode: isApproved ? 'execution' : 'planning',
            toolPolicy: isApproved ? 'auto_safe' : 'read_only',
            size: 'small',
            risk: 'low',
            needsModel: true,
            needsThinking: false,
            needsCodebaseContext: isApproved,
            contextProfile: isApproved ? 'task' : 'short',
            modelProfile: isApproved ? 'orchestrator' : 'router',
            taskStage: isApproved ? 'execution' : 'requirements_intake',
            executionReadiness: isApproved ? 'user_confirmed' : 'unclear_requirements',
            needsUserConfirmation: !isApproved,
            confidence: 0.7,
            reason: 'Mock router default.',
          }),
          raw: null,
        }
      }
      if (input.systemPrompt.includes('AgentHub Main Brain') && input.systemPrompt.includes('"taskStage":"requirements_intake"')) {
        return {
          provider: 'mock',
          model: input.model ?? 'mock-orchestrator',
          content: JSON.stringify({
            kind: 'dispatch_agents',
            targetAgents: ['product-manager', 'engineer'],
            execution: 'serial',
            speakerAgentId: 'product-manager',
            finalizationMode: 'speaker_direct',
            dispatches: [
              {
                agentId: 'product-manager',
                task: 'Clarify the mini program requirements, scope, pages, acceptance criteria, and open questions before implementation.',
                requiredContext: ['projectBrief', 'recentMessages'],
                expectedOutput: 'Requirement summary, acceptance criteria, risks, and questions waiting for user confirmation.',
              },
              {
                agentId: 'engineer',
                task: 'Implement the mini program after requirements are confirmed.',
                requiredContext: ['projectBrief', 'recentMessages'],
                expectedOutput: 'Implementation summary and changed files.',
              },
            ],
            finalResponse: 'Mock planner attempted a full chain; task-stage guard should keep only product-manager.',
          }),
          raw: null,
        }
      }
      if (input.systemPrompt.includes('AgentHub Main Brain') && input.systemPrompt.includes('"taskStage":"execution"')) {
        return {
          provider: 'mock',
          model: input.model ?? 'mock-orchestrator',
          content: JSON.stringify({
            kind: 'dispatch_agents',
            targetAgents: ['engineer', 'reviewer'],
            execution: 'serial',
            speakerAgentId: 'orchestrator',
            finalizationMode: 'main_synthesis',
            dispatches: [
              {
                agentId: 'engineer',
                task: 'Implement the confirmed task in the workspace and report changed files and validation.',
                requiredContext: ['projectBrief', 'recentMessages', 'artifacts'],
                expectedOutput: 'Implementation summary, changed files, tests, and preview status.',
              },
              {
                agentId: 'reviewer',
                task: 'Review the implemented result against the confirmed requirements.',
                requiredContext: ['projectBrief', 'recentMessages', 'artifacts', 'changeSets'],
                expectedOutput: 'PASS/PARTIAL/FAIL verdict with findings.',
              },
            ],
            finalResponse: 'Mock planner approved implementation chain.',
          }),
          raw: null,
        }
      }
      if (input.systemPrompt.includes('AgentHub Main Brain synthesizing completed child-agent work')) {
        return {
          provider: 'mock',
          model: input.model ?? 'mock-synthesis',
          content: JSON.stringify({
            kind: 'final_answer',
            verdict: 'success',
            finalResponse: 'Mock synthesis produced a valid final summary.',
            execution: 'serial',
            followUpDispatches: [],
          }),
          raw: null,
        }
      }
      return {
        provider: 'mock',
        model: input.model ?? 'mock-orchestrator',
        content: JSON.stringify({
          kind: 'direct_answer',
          targetAgents: [],
          execution: 'serial',
          speakerAgentId: 'orchestrator',
          finalizationMode: 'speaker_direct',
          dispatches: [],
          finalResponse: 'Mock main brain produced a schema-valid direct answer.',
        }),
        raw: null,
      }
    },

    /**
     * Streams a deterministic plain-text response for CLI and SSE smoke tests.
     * Input: model gateway request and delta handler. Output: normalized full response.
     */
    async streamText(input: ModelGatewayRequest, handlers: ModelGatewayStreamHandlers): Promise<ModelGatewayResponse> {
      const content = mockTextResponse(input)
      for (const chunk of chunkText(content)) {
        await handlers.onDelta(chunk)
      }
      return {
        provider: 'mock',
        model: input.model ?? 'mock-stream',
        content,
        raw: null,
      }
    },
  }
}
