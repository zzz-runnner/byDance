import type { AgentDefinition, MainBrainSynthesis, RoutingTaskBrief } from '@shared/contracts'
import { MainBrainSynthesisSchema } from '@shared/contracts'
import type { ServerEnv } from '../env'
import { createModelGateway } from '../model-gateway'

export type MainBrainSynthesisSource = 'model' | 'rule_fallback'

export type PlannedSynthesis = {
  synthesis: MainBrainSynthesis
  source: MainBrainSynthesisSource
  error?: string
  provider?: string
  model?: string
  contextTokenEstimate?: number
  modelElapsedMs?: number
}

type SynthesisInput = {
  env: ServerEnv
  contextPackage: string
  agents: AgentDefinition[]
  localSummaries: string[]
}

/**
 * Builds the model prompt for post-agent synthesis.
 * Input: none. Output: system prompt text.
 */
function buildSynthesisSystemPrompt(): string {
  return [
    'You are AgentHub Main Brain synthesizing completed child-agent work.',
    'Your job is to read worker results, judge whether the user goal is satisfied, and write the final user-facing delivery summary.',
    'For project tasks, prefer a project-manager delivery summary: what was done, which agents worked, artifacts/paths, validation result, risks, and next steps.',
    'If any childAgentResults item has status partial/failed, validation partial/fail, or review partial/fail, do not describe the overall work as fully completed.',
    'Reviewer verdicts are delivery gates: PASS can support success, PARTIAL must keep the final verdict partial unless later evidence fixes it, and FAIL must be reported as failed or blocked.',
    'You may output continue_dispatch with followUpDispatches if more child-agent work is needed, but this AgentHub version will NOT execute those follow-up dispatches automatically.',
    'Do not claim follow-up work has run. If more work is needed, explain it as a recommended next step.',
    'Never fabricate artifacts, files, tests, or reviewer verdicts. Use only supplied context.',
    'Return ONLY valid JSON. Do not wrap JSON in markdown. Do not include commentary outside JSON.',
    'Allowed kind values: final_answer, continue_dispatch, ask_clarification, report_failure.',
    'Allowed verdict values: success, partial, failed.',
    'Allowed execution values: serial, parallel.',
    'Required JSON shape:',
    JSON.stringify({
      kind: 'final_answer',
      verdict: 'success',
      finalResponse: 'user-facing synthesis in Chinese',
      execution: 'serial',
      followUpDispatches: [
        {
          agentId: 'agent-id',
          task: 'self-contained follow-up briefing, not executed in this version',
          requiredContext: ['agentResults', 'changeSets'],
          expectedOutput: 'clear expected output',
        },
      ],
      internalNote: 'optional private note',
    }),
    'For final_answer, ask_clarification, or report_failure, followUpDispatches should be [].',
    'For continue_dispatch, include followUpDispatches and also explain in finalResponse that follow-up dispatch is recommended but not executed automatically in this version.',
  ].join('\n')
}

/**
 * Builds the model user prompt for synthesis.
 * Input: serialized synthesis context. Output: user prompt text.
 */
function buildSynthesisUserPrompt(contextPackage: string): string {
  return ['Synthesize this AgentHub run into the final main-brain response.', 'Synthesis context:', contextPackage].join('\n\n')
}

/**
 * Estimates token count using the local char-to-token heuristic.
 * Input: serialized context text. Output: approximate token count.
 */
function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Extracts a JSON object from a model response.
 * Input: raw model content. Output: parsed payload.
 */
function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new Error('Synthesis model did not return a JSON object.')
    }
    return JSON.parse(content.slice(start, end + 1))
  }
}

/**
 * Unwraps common synthesis response envelopes.
 * Input: parsed model payload. Output: raw synthesis payload.
 */
function unwrapSynthesisPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload
  }
  const record = payload as Record<string, unknown>
  return record.synthesis ?? record.mainBrainSynthesis ?? record.result ?? record.decision ?? payload
}

/**
 * Validates follow-up dispatches against known agent ids.
 * Input: synthesis payload and available agents. Output: normalized synthesis.
 */
function validateSynthesis(synthesis: MainBrainSynthesis, agents: AgentDefinition[]): MainBrainSynthesis {
  const agentIds = new Set(agents.map(agent => agent.id))
  for (const brief of synthesis.followUpDispatches) {
    if (!agentIds.has(brief.agentId)) {
      throw new Error(`Synthesis referenced unknown follow-up agent: ${brief.agentId}`)
    }
  }
  if (synthesis.kind !== 'continue_dispatch' && synthesis.followUpDispatches.length > 0) {
    throw new Error('Synthesis returned follow-up dispatches without continue_dispatch.')
  }
  if (!synthesis.finalResponse?.trim()) {
    throw new Error('Synthesis returned no finalResponse.')
  }
  return {
    ...synthesis,
    execution: synthesis.kind === 'continue_dispatch' ? synthesis.execution : 'serial',
    followUpDispatches: synthesis.kind === 'continue_dispatch' ? synthesis.followUpDispatches : [],
  }
}

/**
 * Parses and validates model content into a synthesis decision.
 * Input: raw model content and agents. Output: validated synthesis.
 */
function parseSynthesis(content: string, agents: AgentDefinition[]): MainBrainSynthesis {
  const payload = unwrapSynthesisPayload(parseJsonObject(content))
  const synthesis = MainBrainSynthesisSchema.parse(payload)
  return validateSynthesis(synthesis, agents)
}

/**
 * Builds a deterministic fallback synthesis when the model fails.
 * Input: local child summaries and optional follow-up briefs. Output: fallback synthesis.
 */
function fallbackSynthesis(localSummaries: string[], followUpDispatches: RoutingTaskBrief[] = []): MainBrainSynthesis {
  return {
    kind: followUpDispatches.length ? 'continue_dispatch' : 'final_answer',
    verdict: 'partial',
    finalResponse: [
      '本轮已完成可用的子 Agent 工作，下面是当前汇总。',
      localSummaries.length ? `子 Agent 结果：${localSummaries.join(' | ')}` : '本轮没有可汇总的子 Agent 结果。',
      followUpDispatches.length ? '后续可继续派发子 Agent，但当前版本不会自动执行二次派发。' : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    execution: 'serial',
    followUpDispatches,
  }
}

/**
 * Builds a local non-error synthesis for simple single-agent requirement intake.
 * Input: local child-agent summaries. Output: synthesis metadata without a model call.
 */
export function synthesizeLocally(localSummaries: string[]): PlannedSynthesis {
  return {
    synthesis: {
      kind: 'final_answer',
      verdict: 'partial',
      finalResponse: [
        '本轮先完成了需求对接，没有进入工程实现。',
        localSummaries.length ? `产品经理结果：${localSummaries.join(' | ')}` : undefined,
        '如果方案方向确认，可以继续明确“按方案开始实现”。',
      ]
        .filter(Boolean)
        .join('\n'),
      execution: 'serial',
      followUpDispatches: [],
    },
    source: 'rule_fallback',
  }
}

/**
 * Runs model-backed synthesis with deterministic fallback.
 * Input: env, synthesis context, agents, and local summaries. Output: synthesis plus source metadata.
 */
export async function synthesizeWithMainBrain(input: SynthesisInput): Promise<PlannedSynthesis> {
  const contextTokenEstimate = estimateTokenCount(input.contextPackage)
  const modelStartedAt = Date.now()
  try {
    const gateway = createModelGateway(input.env)
    const response = await gateway.generate({
      systemPrompt: buildSynthesisSystemPrompt(),
      userPrompt: buildSynthesisUserPrompt(input.contextPackage),
      thinking: 'disabled',
      timeoutMs: Math.min(input.env.AGENTHUB_ORCHESTRATOR_TIMEOUT_MS, 30_000),
      maxTokens: Math.min(input.env.AGENTHUB_ORCHESTRATOR_MAX_TOKENS, 1_200),
      temperature: 0.1,
      responseFormat: 'json_object',
    })
    return {
      synthesis: parseSynthesis(response.content, input.agents),
      source: 'model',
      provider: response.provider,
      model: response.model,
      contextTokenEstimate,
      modelElapsedMs: Date.now() - modelStartedAt,
    }
  } catch (error) {
    return {
      synthesis: fallbackSynthesis(input.localSummaries),
      source: 'rule_fallback',
      error: error instanceof Error ? error.message : String(error),
      contextTokenEstimate,
      modelElapsedMs: Date.now() - modelStartedAt,
    }
  }
}
