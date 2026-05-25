import { z } from 'zod'
import type { ServerEnv } from '../../env'
import type { ModelGateway, ModelGatewayRequest, ModelGatewayResponse, ModelGatewayStreamHandlers } from '../types'

const DeepSeekMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})

const DeepSeekResponseSchema = z.object({
  id: z.string().optional(),
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable().optional(),
      }),
    }),
  ),
})

const DeepSeekStreamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z
        .object({
          content: z.string().nullable().optional(),
        })
        .passthrough()
        .optional(),
    }),
  ),
})

/**
 * Shortens provider error bodies before surfacing them to orchestration fallback.
 * Input: raw response text. Output: bounded diagnostic text without secrets.
 */
function truncateDiagnostic(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 500)
}

/**
 * Builds an abort signal for model calls with a bounded timeout.
 * Input: timeout in milliseconds. Output: abort controller and cleanup callback.
 */
function createTimeoutSignal(timeoutMs: number): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    controller,
    cleanup: () => clearTimeout(timer),
  }
}

/**
 * Resolves the configured DeepSeek model for one request.
 * Input: gateway request and server environment. Output: model name.
 */
function resolveModel(input: ModelGatewayRequest, env: ServerEnv): string {
  const model = input.model ?? env.AGENTHUB_ORCHESTRATOR_MODEL
  if (!model) {
    throw new Error('A DeepSeek model is required for this model gateway request.')
  }
  return model
}

/**
 * Builds an OpenAI-compatible DeepSeek request body.
 * Input: gateway request, model name, and stream flag. Output: JSON request body.
 */
function buildRequestBody(input: ModelGatewayRequest, model: string, stream: boolean): Record<string, unknown> {
  const messages = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ].map(message => DeepSeekMessageSchema.parse(message))

  return {
    model,
    messages,
    temperature: input.temperature ?? 0.1,
    max_tokens: input.maxTokens,
    stream,
    ...(input.thinking
      ? {
          thinking: {
            type: input.thinking,
          },
        }
      : {}),
    ...(input.responseFormat === 'json_object'
      ? { response_format: { type: 'json_object' } }
      : {}),
  }
}

/**
 * Sends one DeepSeek chat-completions request.
 * Input: environment, request body, and abort signal. Output: fetch response.
 */
async function postDeepSeek(env: ServerEnv, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  return fetch(`${env.DEEPSEEK_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
}

/**
 * Processes one Server-Sent Events data line from DeepSeek.
 * Input: raw data payload and delta handler. Output: extracted text delta.
 */
async function processStreamPayload(payload: string, handlers: ModelGatewayStreamHandlers): Promise<string> {
  if (!payload || payload === '[DONE]') {
    return ''
  }
  const parsed = DeepSeekStreamChunkSchema.parse(JSON.parse(payload))
  const delta = parsed.choices[0]?.delta?.content ?? ''
  if (delta) {
    await handlers.onDelta(delta)
  }
  return delta
}

/**
 * Reads DeepSeek SSE chunks and normalizes content deltas.
 * Input: streaming fetch response and delta handler. Output: full response text and raw chunks.
 */
async function readDeepSeekStream(
  response: Response,
  handlers: ModelGatewayStreamHandlers,
): Promise<{ content: string; raw: unknown[] }> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('DeepSeek streaming response did not include a readable body.')
  }

  const decoder = new TextDecoder()
  const raw: unknown[] = []
  let buffer = ''
  let content = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })

    let lineEnd = buffer.indexOf('\n')
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim()
      buffer = buffer.slice(lineEnd + 1)
      if (line.startsWith('data:')) {
        const payload = line.slice('data:'.length).trim()
        raw.push(payload)
        content += await processStreamPayload(payload, handlers)
      }
      lineEnd = buffer.indexOf('\n')
    }

    if (done) {
      break
    }
  }

  const tail = buffer.trim()
  if (tail.startsWith('data:')) {
    const payload = tail.slice('data:'.length).trim()
    raw.push(payload)
    content += await processStreamPayload(payload, handlers)
  }

  return {
    content: content.trim(),
    raw,
  }
}

/**
 * Creates a DeepSeek-backed model gateway using OpenAI-compatible chat completions.
 * Input: validated server environment. Output: model gateway implementation.
 */
export function createDeepSeekGateway(env: ServerEnv): ModelGateway {
  return {
    /**
     * Sends one structured planning prompt to DeepSeek chat completions.
     * Input: model gateway request. Output: normalized model gateway response.
     */
    async generate(input: ModelGatewayRequest): Promise<ModelGatewayResponse> {
      if (!env.DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY is required for the DeepSeek orchestrator provider.')
      }
      const model = resolveModel(input, env)
      const { controller, cleanup } = createTimeoutSignal(input.timeoutMs)

      try {
        const response = await postDeepSeek(env, buildRequestBody(input, model, false), controller.signal)
        const rawText = await response.text()
        if (!response.ok) {
          throw new Error(`DeepSeek request failed with ${response.status}: ${truncateDiagnostic(rawText)}`)
        }

        const parsed = DeepSeekResponseSchema.parse(JSON.parse(rawText))
        const content = parsed.choices[0]?.message.content?.trim()
        if (!content) {
          throw new Error('DeepSeek returned an empty orchestrator response.')
        }

        return {
          provider: 'deepseek',
          model,
          content,
          raw: parsed,
        }
      } finally {
        cleanup()
      }
    },

    /**
     * Streams one final text response from DeepSeek chat completions.
     * Input: model gateway request and delta handler. Output: normalized full response.
     */
    async streamText(input: ModelGatewayRequest, handlers: ModelGatewayStreamHandlers): Promise<ModelGatewayResponse> {
      if (!env.DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY is required for the DeepSeek orchestrator provider.')
      }
      const model = resolveModel(input, env)
      const { controller, cleanup } = createTimeoutSignal(input.timeoutMs)

      try {
        const response = await postDeepSeek(env, buildRequestBody(input, model, true), controller.signal)
        if (!response.ok) {
          const rawText = await response.text()
          throw new Error(`DeepSeek stream failed with ${response.status}: ${truncateDiagnostic(rawText)}`)
        }

        const streamed = await readDeepSeekStream(response, handlers)
        if (!streamed.content) {
          throw new Error('DeepSeek returned an empty streamed response.')
        }

        return {
          provider: 'deepseek',
          model,
          content: streamed.content,
          raw: streamed.raw,
        }
      } finally {
        cleanup()
      }
    },
  }
}
