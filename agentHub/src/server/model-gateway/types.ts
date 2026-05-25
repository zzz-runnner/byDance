export type ModelGatewayRequest = {
  systemPrompt: string
  userPrompt: string
  model?: string
  thinking?: 'enabled' | 'disabled'
  temperature?: number
  timeoutMs: number
  maxTokens: number
  responseFormat?: 'json_object'
}

export type ModelGatewayResponse = {
  provider: string
  model: string
  content: string
  raw: unknown
}

export type ModelGatewayStreamHandlers = {
  onDelta: (delta: string) => void | Promise<void>
}

export type ModelGateway = {
  generate(input: ModelGatewayRequest): Promise<ModelGatewayResponse>
  streamText(input: ModelGatewayRequest, handlers: ModelGatewayStreamHandlers): Promise<ModelGatewayResponse>
}
