import { z } from 'zod'

type WorkbenchRoom = {
  id: string
  title: string
  workspace: {
    id: string
    name: string
    projectId?: string
  }
  conversation: {
    id: string
    type: 'group' | 'direct'
  }
}

type WorkbenchOverview = {
  rooms: WorkbenchRoom[]
}

type Message = {
  id: string
  senderType: 'user' | 'agent' | 'system'
  senderId: string
  content: string
  createdAt: string
  replyTo?: {
    messageId: string
    senderId: string
    senderName?: string
    excerpt: string
  }
  artifacts: Array<{
    id: string
    type: string
    title: string
    url?: string
    metadata?: Record<string, unknown>
  }>
}

type ProjectStateEnvelope = {
  state: {
    messages: Message[]
  }
}

type WorkflowEvent = {
  type: string
  conversationId?: string
  workspaceId?: string
  speakerAgentId?: string
  senderId?: string
  senderName?: string
  messageId?: string
  status?: string
  agentId?: string
  taskStage?: string
  summary?: string
  changeSetId?: string
}

type ProjectFileNode = {
  path: string
  kind: 'directory' | 'file'
  isText: boolean
  children?: ProjectFileNode[]
}

type ProjectFileTree = {
  entries: ProjectFileNode[]
}

type ProjectFileContent = {
  path: string
  content: string
}

type PreviewTarget = {
  path: string
  url: string
}

type PreviewCapability = {
  mode: 'static' | 'module-shell' | 'build' | 'unsupported'
  targets: PreviewTarget[]
  defaultTargetPath?: string
}

type DeliveryAsset = {
  status: 'idle' | 'ready' | 'failed'
  summary: string
  versionId?: string
  url?: string
  createdAt?: string
  updatedAt?: string
}

type DeliverySummary = {
  projectId: string
  currentVersion?: {
    versionId: string
    createdAt: string
    updatedAt: string
  }
  sourceArchive: DeliveryAsset
  build: DeliveryAsset
  deployment: DeliveryAsset
}

type VersionRecord = {
  versionId: string
  sourceZipUrl: string
  buildPreviewUrl?: string
  buildStatus?: 'pending' | 'success' | 'failed'
  createdAt: string
  updatedAt: string
}

type DeploymentRecord = {
  deploymentId: string
  versionId: string
  deployUrl: string
  createdAt: string
}

type CodeSelectionReference = {
  filePath: string
  selectedText: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  language?: string
  beforeContext?: string
  afterContext?: string
}

type StepResult = {
  name: string
  passed: boolean
  detail: string
}

type VerificationContext = {
  backendBaseUrl: string
  runtimeBaseUrl: string
  frontendBaseUrl?: string
  workspaceQuery: string
  projectId?: string
}

type ProjectTarget = {
  projectId: string
  workspaceId: string
  conversationId: string
  roomTitle: string
}

const ArgsSchema = z.object({
  backendBaseUrl: z.string().url().default('http://127.0.0.1:8790'),
  runtimeBaseUrl: z.string().url().default('http://127.0.0.1:8787'),
  frontendBaseUrl: z.string().url().optional(),
  workspaceQuery: z.string().min(1).default('Mention Route Verify 20260529-1715'),
  projectId: z.string().min(1).optional(),
})

/**
 * Parses CLI flags for the existing-workspace verifier.
 * Input: raw process arguments. Output: validated verifier configuration.
 */
function parseArgs(argv: string[]): VerificationContext {
  const input: Partial<VerificationContext> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--backend-base-url=')) {
      input.backendBaseUrl = arg.slice('--backend-base-url='.length)
    } else if (arg === '--backend-base-url') {
      input.backendBaseUrl = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--runtime-base-url=')) {
      input.runtimeBaseUrl = arg.slice('--runtime-base-url='.length)
    } else if (arg === '--runtime-base-url') {
      input.runtimeBaseUrl = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--frontend-base-url=')) {
      input.frontendBaseUrl = arg.slice('--frontend-base-url='.length)
    } else if (arg === '--frontend-base-url') {
      input.frontendBaseUrl = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--workspace-query=')) {
      input.workspaceQuery = arg.slice('--workspace-query='.length)
    } else if (arg === '--workspace-query') {
      input.workspaceQuery = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--project-id=')) {
      input.projectId = arg.slice('--project-id='.length)
    } else if (arg === '--project-id') {
      input.projectId = argv[index + 1]
      index += 1
    }
  }

  return ArgsSchema.parse(input)
}

/**
 * Reads JSON from one backend endpoint with a clear error label.
 * Input: absolute URL, optional fetch init, and operation label. Output: parsed JSON payload.
 */
async function readJson<T>(url: string, init: RequestInit | undefined, label: string): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

/**
 * Asserts that one HTTP endpoint is reachable before the verifier runs.
 * Input: absolute URL and service label. Output: none.
 */
async function assertReachable(url: string, label: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${label} is not reachable: ${response.status} ${response.statusText}`)
  }
}

/**
 * Locates one existing workspace-backed project through the business workbench API.
 * Input: verifier config. Output: resolved project id, workspace id, and conversation id.
 */
async function resolveProjectTarget(context: VerificationContext): Promise<ProjectTarget> {
  if (context.projectId) {
    const room = await readJson<{ projectId?: string; workspaceId?: string; conversationId?: string; name?: string }>(
      `${context.backendBaseUrl}/api/projects/${encodeURIComponent(context.projectId)}`,
      undefined,
      'Load explicit project',
    )
    if (!room.projectId || !room.workspaceId || !room.conversationId) {
      throw new Error(`Project ${context.projectId} is missing workspace or conversation binding.`)
    }
    return {
      projectId: room.projectId,
      workspaceId: room.workspaceId,
      conversationId: room.conversationId,
      roomTitle: room.name ?? room.projectId,
    }
  }

  const query = new URLSearchParams({
    limit: '50',
    q: context.workspaceQuery,
  })
  const overview = await readJson<WorkbenchOverview>(
    `${context.backendBaseUrl}/api/workbench?${query.toString()}`,
    undefined,
    'Load workbench overview',
  )
  const exactMatches = overview.rooms.filter(room =>
    room.title === context.workspaceQuery || room.workspace.name === context.workspaceQuery,
  )

  if (exactMatches.length !== 1) {
    const titles = overview.rooms.map(room => `${room.title} [${room.workspace.projectId ?? 'no-project-id'}]`)
    throw new Error(
      `Expected exactly one workspace match for "${context.workspaceQuery}", found ${exactMatches.length}. Candidates: ${titles.join(', ') || 'none'}.`,
    )
  }

  const match = exactMatches[0]
  if (!match.workspace.projectId) {
    throw new Error(`Workspace ${match.workspace.name} is missing projectId in workbench overview.`)
  }

  return {
    projectId: match.workspace.projectId,
    workspaceId: match.workspace.id,
    conversationId: match.conversation.id,
    roomTitle: match.title,
  }
}

/**
 * Loads one full recent state page for the selected project conversation.
 * Input: backend base URL and project id. Output: recent project state envelope.
 */
async function fetchProjectState(backendBaseUrl: string, projectId: string): Promise<ProjectStateEnvelope> {
  const query = new URLSearchParams({
    messageLimit: '200',
  })
  return readJson<ProjectStateEnvelope>(
    `${backendBaseUrl}/api/projects/${encodeURIComponent(projectId)}/state?${query.toString()}`,
    undefined,
    'Load project state',
  )
}

/**
 * Loads the current browser-visible file tree for one project.
 * Input: backend base URL and project id. Output: nested file tree.
 */
async function fetchProjectFiles(backendBaseUrl: string, projectId: string): Promise<ProjectFileTree> {
  return readJson<ProjectFileTree>(
    `${backendBaseUrl}/api/projects/${encodeURIComponent(projectId)}/files`,
    undefined,
    'Load project files',
  )
}

/**
 * Loads one UTF-8 workspace file through the business backend.
 * Input: backend base URL, project id, and repo-relative path. Output: file content payload.
 */
async function fetchProjectFileContent(
  backendBaseUrl: string,
  projectId: string,
  filePath: string,
): Promise<ProjectFileContent> {
  const query = new URLSearchParams({ path: filePath })
  return readJson<ProjectFileContent>(
    `${backendBaseUrl}/api/projects/${encodeURIComponent(projectId)}/files/content?${query.toString()}`,
    undefined,
    'Load project file content',
  )
}

/**
 * Loads the current preview capability for one project workspace.
 * Input: backend base URL and project id. Output: preview capability snapshot.
 */
async function fetchPreviewCapability(backendBaseUrl: string, projectId: string): Promise<PreviewCapability> {
  return readJson<PreviewCapability>(
    `${backendBaseUrl}/api/projects/${encodeURIComponent(projectId)}/preview-capability`,
    undefined,
    'Load preview capability',
  )
}

/**
 * Loads the current source/build/deploy delivery summary for one project.
 * Input: backend base URL and project id. Output: delivery summary snapshot.
 */
async function fetchDeliverySummary(backendBaseUrl: string, projectId: string): Promise<DeliverySummary> {
  return readJson<DeliverySummary>(
    `${backendBaseUrl}/api/projects/${encodeURIComponent(projectId)}/delivery`,
    undefined,
    'Load delivery summary',
  )
}

/**
 * Sends one conversation message through the business backend SSE endpoint.
 * Input: backend base URL, target ids, and message payload. Output: ordered workflow events from this turn.
 */
async function streamProjectMessage(input: {
  backendBaseUrl: string
  projectId: string
  conversationId: string
  content: string
  replyTo?: Message['replyTo']
  codeSelection?: CodeSelectionReference
}): Promise<WorkflowEvent[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000)

  try {
    const response = await fetch(
      `${input.backendBaseUrl}/api/projects/${encodeURIComponent(input.projectId)}/messages/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: input.conversationId,
          content: input.content,
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          ...(input.codeSelection ? { codeSelection: input.codeSelection } : {}),
        }),
        signal: controller.signal,
      },
    )

    if (!response.ok || !response.body) {
      throw new Error(`Stream project message failed: ${response.status} ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const events: WorkflowEvent[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const dataLine = frame
          .split('\n')
          .find(line => line.startsWith('data: '))

        if (!dataLine) {
          continue
        }

        const parsed = JSON.parse(dataLine.slice('data: '.length)) as WorkflowEvent | { error: string }
        if ('error' in parsed) {
          throw new Error(parsed.error)
        }
        events.push(parsed)
      }
    }

    return events
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Creates one saved source version from the current workspace repo.
 * Input: backend base URL, project id, and save message. Output: created version record.
 */
async function createVersion(
  backendBaseUrl: string,
  projectId: string,
  message: string,
): Promise<VersionRecord> {
  return readJson<VersionRecord>(
    `${backendBaseUrl}/api/projects/${encodeURIComponent(projectId)}/versions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    },
    'Create source version',
  )
}

/**
 * Builds one saved source version into a local delivery artifact.
 * Input: backend base URL, project id, and version id. Output: updated version record.
 */
async function buildVersion(
  backendBaseUrl: string,
  projectId: string,
  versionId: string,
): Promise<VersionRecord> {
  return readJson<VersionRecord>(
    `${backendBaseUrl}/api/projects/${encodeURIComponent(projectId)}/builds`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ versionId }),
    },
    'Build source version',
  )
}

/**
 * Publishes one built delivery artifact into the local deploy route.
 * Input: backend base URL, project id, and version id. Output: deployment record.
 */
async function deployVersion(
  backendBaseUrl: string,
  projectId: string,
  versionId: string,
): Promise<DeploymentRecord> {
  return readJson<DeploymentRecord>(
    `${backendBaseUrl}/api/projects/${encodeURIComponent(projectId)}/deploy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ versionId }),
    },
    'Deploy built version',
  )
}

/**
 * Flattens a nested project file tree into one ordered file-path list.
 * Input: nested file entries. Output: repo-relative file paths.
 */
function flattenFiles(nodes: ProjectFileNode[]): string[] {
  const filePaths: string[] = []
  for (const node of nodes) {
    if (node.kind === 'file' && node.isText) {
      filePaths.push(node.path)
    }
    if (node.kind === 'directory' && node.children?.length) {
      filePaths.push(...flattenFiles(node.children))
    }
  }
  return filePaths
}

/**
 * Picks a stable HTML-like file for preview-oriented assertions.
 * Input: flattened workspace file list. Output: preferred file path.
 */
function pickPrimaryFile(filePaths: string[]): string {
  return (
    filePaths.find(filePath => /index\.html?$/i.test(filePath)) ??
    filePaths.find(filePath => /\.(html|css|js|ts|tsx|jsx|vue|svelte)$/i.test(filePath)) ??
    filePaths[0]
  )
}

/**
 * Builds one structured code selection from a file around a keyword or the first non-empty lines.
 * Input: file path, file content, and preferred search keywords. Output: quote-ready selection payload.
 */
function buildCodeSelection(
  filePath: string,
  content: string,
  keywords: string[],
): CodeSelectionReference {
  const lines = content.split(/\r?\n/)
  let startLineIndex = lines.findIndex(line => keywords.some(keyword => line.includes(keyword)))
  if (startLineIndex < 0) {
    startLineIndex = lines.findIndex(line => line.trim().length > 0)
  }
  if (startLineIndex < 0) {
    throw new Error(`Unable to build a code selection from empty file: ${filePath}`)
  }

  const selectedLines = lines.slice(startLineIndex, Math.min(startLineIndex + 3, lines.length))
  const selectedText = selectedLines.join('\n')
  const endLineIndex = startLineIndex + selectedLines.length - 1

  return {
    filePath,
    selectedText,
    startLine: startLineIndex + 1,
    startColumn: 1,
    endLine: endLineIndex + 1,
    endColumn: (lines[endLineIndex] ?? '').length + 1,
    beforeContext: startLineIndex > 0 ? lines.slice(Math.max(0, startLineIndex - 2), startLineIndex).join('\n') : undefined,
    afterContext: endLineIndex + 1 < lines.length ? lines.slice(endLineIndex + 1, Math.min(lines.length, endLineIndex + 3)).join('\n') : undefined,
  }
}

/**
 * Returns the last workflow event of one type from the current event slice.
 * Input: workflow events and target type. Output: matching event or undefined.
 */
function lastEventOfType(events: WorkflowEvent[], type: string): WorkflowEvent | undefined {
  return [...events].reverse().find(event => event.type === type)
}

/**
 * Picks the last assistant-speaker event from one streamed turn.
 * Input: workflow events. Output: assistant_message_started event or undefined.
 */
function lastAssistantStarted(events: WorkflowEvent[]): WorkflowEvent | undefined {
  return [...events].reverse().find(event => event.type === 'assistant_message_started')
}

/**
 * Finds the last agent reply that mentions one unique turn marker.
 * Input: project messages, current conversation id, and turn marker. Output: reply message or undefined.
 */
function findReplyForMarker(messages: Message[], marker: string): Message | undefined {
  const userMessage = [...messages].reverse().find(message =>
    message.senderType === 'user' && message.content.includes(marker),
  )
  if (!userMessage) {
    return undefined
  }

  return messages
    .filter(message =>
      message.senderType === 'agent' &&
      message.createdAt >= userMessage.createdAt,
    )
    .at(-1)
}

/**
 * Builds one short reply reference from an existing agent message.
 * Input: agent message. Output: reply reference payload for the next turn.
 */
function toReplyReference(message: Message): NonNullable<Message['replyTo']> {
  return {
    messageId: message.id,
    senderId: message.senderId,
    senderName: message.senderId,
    excerpt: compactText(message.content, 120),
  }
}

/**
 * Clips one long text fragment into a single compact line for logs.
 * Input: text and maximum length. Output: clipped one-line text.
 */
function compactText(content: string, maxLength = 180): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

/**
 * Throws when one condition fails during the verifier run.
 * Input: condition and failure message. Output: narrowed truthy condition or thrown error.
 */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * Runs one named verification step and records a concise pass/fail summary.
 * Input: result list, step label, and async operation. Output: operation result.
 */
async function runStep<T>(
  results: StepResult[],
  name: string,
  action: () => Promise<{ detail: string; value?: T }>,
): Promise<T | undefined> {
  try {
    const result = await action()
    results.push({
      name,
      passed: true,
      detail: result.detail,
    })
    console.log(`PASS ${name}: ${result.detail}`)
    return result.value
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({
      name,
      passed: false,
      detail,
    })
    console.error(`FAIL ${name}: ${detail}`)
    throw error
  }
}

/**
 * Fetches one browser-facing resource and optionally checks for HTML content.
 * Input: absolute or relative URL, backend base URL, and whether HTML is expected. Output: concise check summary.
 */
async function verifyResource(
  resourceUrl: string,
  backendBaseUrl: string,
  expectHtml: boolean,
): Promise<string> {
  const absoluteUrl = resourceUrl.startsWith('http') ? resourceUrl : new URL(resourceUrl, backendBaseUrl).toString()
  const response = await fetch(absoluteUrl)
  assert(response.ok, `Resource check failed for ${absoluteUrl}: ${response.status} ${response.statusText}`)

  if (!expectHtml) {
    const byteLength = Number(response.headers.get('content-length') ?? '0')
    return `reachable (${byteLength > 0 ? `${byteLength} bytes` : 'unknown size'})`
  }

  const body = await response.text()
  assert(/<!doctype html|<html|<body/i.test(body), `Expected HTML content from ${absoluteUrl}.`)
  return `reachable HTML at ${absoluteUrl}`
}

/**
 * Runs the existing-workspace local-closure verification against live local services.
 * Input: parsed CLI context. Output: process exit code through thrown errors.
 */
async function main(): Promise<void> {
  const context = parseArgs(process.argv.slice(2))
  const results: StepResult[] = []
  const runToken = `AUTO-CLOSURE-${new Date().toISOString().replace(/[:.]/g, '-')}`

  const target = await runStep(results, 'resolve existing workspace', async () => {
    await assertReachable(`${context.backendBaseUrl}/api/health`, 'business backend')
    await assertReachable(`${context.runtimeBaseUrl}/api/state`, 'agentHub runtime')
    if (context.frontendBaseUrl) {
      await assertReachable(context.frontendBaseUrl, 'frontend dev server')
    }

    const resolved = await resolveProjectTarget(context)
    return {
      detail: `${resolved.roomTitle} -> project=${resolved.projectId} workspace=${resolved.workspaceId}`,
      value: resolved,
    }
  })

  assert(target, 'Failed to resolve target project.')

  const initialState = await fetchProjectState(context.backendBaseUrl, target.projectId)
  const initialFiles = await fetchProjectFiles(context.backendBaseUrl, target.projectId)
  const filePaths = flattenFiles(initialFiles.entries)
  assert(filePaths.length > 0, `Workspace ${target.roomTitle} has no readable text files.`)

  const primaryFilePath = pickPrimaryFile(filePaths)
  const secondaryFilePath = filePaths.find(filePath => filePath !== primaryFilePath) ?? primaryFilePath
  const primaryFileBefore = await fetchProjectFileContent(context.backendBaseUrl, target.projectId, primaryFilePath)
  const secondaryFileBefore = await fetchProjectFileContent(context.backendBaseUrl, target.projectId, secondaryFilePath)

  await runStep(results, 'product-manager routing', async () => {
    const marker = `${runToken} PRODUCT`
    const events = await streamProjectMessage({
      backendBaseUrl: context.backendBaseUrl,
      projectId: target.projectId,
      conversationId: target.conversationId,
      content: `${marker} @product-manager 先不要写代码，只基于当前工作区给我 3 条需求拆解、3 条验收标准、1 条主要风险，保持简短。`,
    })

    const routing = lastEventOfType(events, 'routing_finished')
    const speaker = lastAssistantStarted(events)
    assert(routing?.speakerAgentId === 'product-manager' || speaker?.senderId === 'product-manager', `Expected product-manager to reply, got routing=${routing?.speakerAgentId ?? 'none'} speaker=${speaker?.senderId ?? 'none'}.`)

    return {
      detail: `speaker=${speaker?.senderId ?? routing?.speakerAgentId ?? 'unknown'} events=${events.length}`,
    }
  })

  const engineerReplyMessage = await runStep(results, 'engineer implementation turn', async () => {
    const marker = `${runToken} ENGINEER`
    const events = await streamProjectMessage({
      backendBaseUrl: context.backendBaseUrl,
      projectId: target.projectId,
      conversationId: target.conversationId,
      content: `${marker} @engineer 基于当前工作区现有页面做最小改动：在主标题下新增一行简短说明文字，并给主要按钮增加 hover 反馈。改完后直接结束。`,
    })

    const routing = lastEventOfType(events, 'routing_finished')
    const speaker = lastAssistantStarted(events)
    const changeSet = lastEventOfType(events, 'change_set_created')
    assert(routing?.speakerAgentId === 'engineer' || speaker?.senderId === 'engineer', `Expected engineer to reply, got routing=${routing?.speakerAgentId ?? 'none'} speaker=${speaker?.senderId ?? 'none'}.`)
    assert(Boolean(changeSet), 'Expected engineer turn to create a change set.')

    const state = await fetchProjectState(context.backendBaseUrl, target.projectId)
    const reply = findReplyForMarker(state.state.messages, marker)
    assert(reply?.senderId === 'engineer', 'Expected the persisted engineer reply to stay on engineer.')

    const primaryAfter = await fetchProjectFileContent(context.backendBaseUrl, target.projectId, primaryFilePath)
    const secondaryAfter = await fetchProjectFileContent(context.backendBaseUrl, target.projectId, secondaryFilePath)
    const preview = await fetchPreviewCapability(context.backendBaseUrl, target.projectId)
    assert(
      primaryAfter.content !== primaryFileBefore.content || secondaryAfter.content !== secondaryFileBefore.content,
      `Expected at least one workspace file to change after engineer turn (${primaryFilePath}, ${secondaryFilePath}).`,
    )
    assert(preview.mode !== 'unsupported' && preview.targets.length > 0, `Expected preview capability after engineer turn, got mode=${preview.mode}.`)

    return {
      detail: `speaker=engineer preview=${preview.mode} targets=${preview.targets.length}`,
      value: reply,
    }
  })

  assert(engineerReplyMessage, 'Expected engineer reply message for quote follow-up.')

  await runStep(results, 'reply quote continuity', async () => {
    const marker = `${runToken} QUOTE`
    const events = await streamProjectMessage({
      backendBaseUrl: context.backendBaseUrl,
      projectId: target.projectId,
      conversationId: target.conversationId,
      content: `${marker} 保留当前结构，只把你刚加的说明文案改得更口语一点。`,
      replyTo: toReplyReference(engineerReplyMessage),
    })

    const routing = lastEventOfType(events, 'routing_finished')
    const speaker = lastAssistantStarted(events)
    assert(routing?.speakerAgentId === 'engineer' || speaker?.senderId === 'engineer', `Expected quoted follow-up to stay with engineer, got routing=${routing?.speakerAgentId ?? 'none'} speaker=${speaker?.senderId ?? 'none'}.`)

    const state = await fetchProjectState(context.backendBaseUrl, target.projectId)
    const latestUser = [...state.state.messages].reverse().find(message => message.senderType === 'user' && message.content.includes(marker))
    const latestReply = findReplyForMarker(state.state.messages, marker)
    assert(latestUser?.replyTo?.senderId === 'engineer', 'Expected persisted replyTo senderId to stay on engineer.')
    assert(latestReply?.senderId === 'engineer', 'Expected persisted quoted reply to stay on engineer.')

    return {
      detail: `speaker=${latestReply?.senderId ?? speaker?.senderId ?? 'unknown'}`,
    }
  })

  await runStep(results, 'code selection routing', async () => {
    const marker = `${runToken} CODE`
    const primaryFile = await fetchProjectFileContent(context.backendBaseUrl, target.projectId, primaryFilePath)
    const selection = buildCodeSelection(primaryFile.path, primaryFile.content, ['button', '<button', 'cta', '说明', '<p'])
    const events = await streamProjectMessage({
      backendBaseUrl: context.backendBaseUrl,
      projectId: target.projectId,
      conversationId: target.conversationId,
      content: `${marker} 引用这段代码，只把这段按钮文案改短一点，不要改别的区域。`,
      codeSelection: selection,
    })

    const routing = lastEventOfType(events, 'routing_finished')
    const speaker = lastAssistantStarted(events)
    assert(routing?.speakerAgentId === 'engineer' || speaker?.senderId === 'engineer', `Expected code selection turn to route to engineer, got routing=${routing?.speakerAgentId ?? 'none'} speaker=${speaker?.senderId ?? 'none'}.`)

    return {
      detail: `selection=${selection.filePath}:${selection.startLine}-${selection.endLine} speaker=${speaker?.senderId ?? routing?.speakerAgentId ?? 'unknown'}`,
    }
  })

  await runStep(results, 'reviewer routing', async () => {
    const marker = `${runToken} REVIEW`
    const events = await streamProjectMessage({
      backendBaseUrl: context.backendBaseUrl,
      projectId: target.projectId,
      conversationId: target.conversationId,
      content: `${marker} @reviewer 只针对当前页面做一次简短验收，告诉我是否还有明显问题。`,
    })

    const routing = lastEventOfType(events, 'routing_finished')
    const speaker = lastAssistantStarted(events)
    assert(routing?.speakerAgentId === 'reviewer' || speaker?.senderId === 'reviewer', `Expected reviewer to reply, got routing=${routing?.speakerAgentId ?? 'none'} speaker=${speaker?.senderId ?? 'none'}.`)

    return {
      detail: `speaker=${speaker?.senderId ?? routing?.speakerAgentId ?? 'unknown'}`,
    }
  })

  const createdVersion = await runStep(results, 'source snapshot', async () => {
    const before = await fetchDeliverySummary(context.backendBaseUrl, target.projectId)
    const version = await createVersion(
      context.backendBaseUrl,
      target.projectId,
      `保存自动化本地闭环验证源码快照 ${runToken}`,
    )
    assert(version.versionId !== before.currentVersion?.versionId || version.updatedAt !== before.currentVersion?.updatedAt, 'Expected a fresh source version to be created.')
    const delivery = await fetchDeliverySummary(context.backendBaseUrl, target.projectId)
    assert(delivery.sourceArchive.status === 'ready', `Expected source archive ready after save, got ${delivery.sourceArchive.status}.`)
    assert(delivery.sourceArchive.versionId === version.versionId, `Expected source archive version ${version.versionId}, got ${delivery.sourceArchive.versionId ?? 'none'}.`)
    assert(delivery.sourceArchive.url, 'Expected source archive URL after save.')

    return {
      detail: `version=${version.versionId}`,
      value: version,
    }
  })

  assert(createdVersion, 'Expected created version record.')

  const builtVersion = await runStep(results, 'build delivery artifact', async () => {
    const version = await buildVersion(context.backendBaseUrl, target.projectId, createdVersion.versionId)
    assert(version.buildStatus === 'success', `Expected build success, got ${version.buildStatus ?? 'none'}.`)
    assert(version.buildPreviewUrl, 'Expected build preview URL after build success.')

    const delivery = await fetchDeliverySummary(context.backendBaseUrl, target.projectId)
    assert(delivery.build.status === 'ready', `Expected delivery build ready after build, got ${delivery.build.status}.`)
    assert(delivery.build.versionId === createdVersion.versionId, `Expected delivery build version ${createdVersion.versionId}, got ${delivery.build.versionId ?? 'none'}.`)
    const resourceDetail = await verifyResource(version.buildPreviewUrl, context.backendBaseUrl, true)

    return {
      detail: `version=${version.versionId} ${resourceDetail}`,
      value: version,
    }
  })

  assert(builtVersion, 'Expected built version record.')

  const deployment = await runStep(results, 'publish local deploy', async () => {
    const deploymentRecord = await deployVersion(context.backendBaseUrl, target.projectId, createdVersion.versionId)
    assert(deploymentRecord.deployUrl, 'Expected deploy URL after local deployment.')

    const delivery = await fetchDeliverySummary(context.backendBaseUrl, target.projectId)
    assert(delivery.deployment.status === 'ready', `Expected deployment ready after publish, got ${delivery.deployment.status}.`)
    assert(delivery.deployment.versionId === createdVersion.versionId, `Expected deployment version ${createdVersion.versionId}, got ${delivery.deployment.versionId ?? 'none'}.`)
    const resourceDetail = await verifyResource(deploymentRecord.deployUrl, context.backendBaseUrl, true)

    return {
      detail: `deployment=${deploymentRecord.deploymentId} ${resourceDetail}`,
      value: deploymentRecord,
    }
  })

  assert(deployment, 'Expected deployment record.')

  await runStep(results, 'persisted delivery artifacts in chat state', async () => {
    const state = await fetchProjectState(context.backendBaseUrl, target.projectId)
    const artifactIds = state.state.messages.flatMap(message => message.artifacts.map(artifact => artifact.id))
    assert(artifactIds.includes(`local-source-${createdVersion.versionId}`), `Expected local-source-${createdVersion.versionId} in state messages.`)
    assert(artifactIds.includes(`local-build-${createdVersion.versionId}`), `Expected local-build-${createdVersion.versionId} in state messages.`)
    assert(artifactIds.includes(`local-deploy-${deployment.deploymentId}`), `Expected local-deploy-${deployment.deploymentId} in state messages.`)

    const sourceResource = await verifyResource(`/api/projects/${encodeURIComponent(target.projectId)}/source.zip?versionId=${encodeURIComponent(createdVersion.versionId)}`, context.backendBaseUrl, false)

    return {
      detail: `delivery artifacts persisted; source ${sourceResource}`,
    }
  })

  console.log('')
  console.log('Verification Summary:')
  for (const result of results) {
    console.log(`- ${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
  }
}

void main().catch(error => {
  const detail = error instanceof Error ? error.message : String(error)
  console.error('')
  console.error(`Local closure verification FAILED: ${detail}`)
  process.exitCode = 1
})
