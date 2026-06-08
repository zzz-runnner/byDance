import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import Markdown from 'react-native-markdown-display'
import { StatusBar } from 'expo-status-bar'
import { LinearGradient } from 'expo-linear-gradient'
import * as Clipboard from 'expo-clipboard'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import Fuse from 'fuse.js'
import { AgentGlyph } from './src/components/AgentGlyph'
import { GlassCard } from './src/components/GlassCard'
import { Pill } from './src/components/Pill'
import { createMobileScale, type LayoutTier } from './src/styles/mobileScale'
import { normalizeAiMarkdown } from './src/utils/normalizeAiMarkdown'
import {
  BUSINESS_API_BASE_URL,
  absoluteBackendUrl,
  applyProjectChangeSet,
  archiveWorkspace,
  buildProjectVersion,
  createBusinessWorkspace,
  createProjectAgent,
  createProjectVersion,
  deleteProjectAgent,
  deployProjectVersion,
  fetchBusinessHealth,
  fetchProjectDeliverySummary,
  fetchProjectPreviewCapability,
  fetchProjectAgents,
  fetchProjectState,
  fetchWorkbenchOverview,
  pinWorkspace,
  streamProjectMessage,
  triggerProjectPreviewBuild,
  unarchiveWorkspace,
  unpinWorkspace,
  updateProjectAgent,
  updateWorkspaceMetadata,
  PROJECT_WORKFLOW_STREAM_EVENT_NAMES,
  type BusinessProject,
  type CreateProjectAgentInput,
  type CreateWorkspaceInput,
  type ProjectArtifact,
  type ProjectAgent,
  type ProjectChangeSet,
  type ProjectChangedFile,
  type ProjectDeliverySummary,
  type ProjectMessage,
  type ProjectMessageStream,
  type ProjectPreviewCapability,
  type ProjectStateEnvelope,
  type ProjectStreamEvent,
  type ProjectWorkflowEvent,
  type ProjectWorkflowStreamEvent,
  type StreamProjectMessageInput,
  type SortDirection,
  type UpdateProjectAgentInput,
  type WorkbenchOverview,
  type WorkbenchRoom,
  type WorkspaceListStatus,
  type WorkspaceSortField,
} from './src/api/businessBackend'
import {
  agents,
  artifacts,
  codeFiles,
  messages,
  workspaces,
  type Agent,
  type Artifact,
  type ChatMessage,
  type IconName,
  type Workspace,
} from './src/data/mockData'

const background = require('./assets/background/mainBackground.png')
const homeIcon = require('./assets/home/icon.png')

type TabKey = 'workbench' | 'chat' | 'agents'
type AgentEntryMode = 'global' | 'workspace'
type MobileScale = ReturnType<typeof createMobileScale>
type BackendStatus = 'checking' | 'ready' | 'unavailable'
type WorkbenchPageState = {
  hasMore: boolean
  nextCursor?: string
  total: number
}
type WorkbenchFilterState = {
  status: WorkspaceListStatus
  sortBy: WorkspaceSortField
  sortDirection: SortDirection
}
type WorkspaceActionState = {
  workspaceId: string
  action: 'pin' | 'archive'
} | null
type AgentActionState = {
  type: 'create' | 'save' | 'delete'
  agentId?: string
} | null
type BackendRetryDialogState = {
  visible: boolean
  title: string
  message: string
  detail?: string
  retrying?: boolean
  onRetry: () => void
}
type ChatProcessStep = {
  id: string
  icon: IconName
  title: string
  summary: string
  time: string
  tone: 'done' | 'running' | 'waiting' | 'failed'
}
type ChatReplyReference = NonNullable<StreamProjectMessageInput['replyTo']>
type ChatMessageView = ChatMessage & {
  createdAt?: string
  turnId?: string
  replyTo?: ChatReplyReference
}
type AgentView = Agent & {
  source?: ProjectAgent['source']
  workspaceId?: string
  conversationId?: string
  model?: string
  description?: string
  whenToUse?: string
  systemPrompt?: string
  permissionMode?: ProjectAgent['permissionMode']
  runtimePolicy?: ProjectAgent['runtimePolicy']
  raw: ProjectAgent
}
type ChatProcessGroup = {
  id: string
  turnId: string
  steps: ChatProcessStep[]
  startedAt?: string
  updatedAt?: string
  status: 'done' | 'running' | 'waiting' | 'failed'
  local?: boolean
}
type ChatTimelineItem =
  | { type: 'message'; id: string; message: ChatMessageView }
  | { type: 'process'; id: string; group: ChatProcessGroup }
type ChatStateView = {
  messages: ChatMessageView[]
  processGroups: ChatProcessGroup[]
  timelineItems: ChatTimelineItem[]
  artifacts: ArtifactView[]
  agents: ProjectAgent[]
  conversationId?: string
  messagePage?: ProjectStateEnvelope['messagePage']
}
type FailedChatSend = {
  content: string
  agentId?: string
  replyTo?: ChatReplyReference
}
type ChatProjectSession = {
  chatState: ChatStateView
  loading: boolean
  error: string
  streaming: boolean
  loaded: boolean
  lastTouchedAt: number
  lastFailedMessage: FailedChatSend | null
}
type SendProjectChatMessageInput = {
  projectId: string
  content: string
  agentId?: string
  conversationId?: string
  replyTo?: ChatReplyReference
}
type ChatMessageActionTarget = {
  message: ChatMessageView
  senderName: string
}
const PROCESS_PREVIEW_STEP_COUNT = 3
const STREAM_WORKFLOW_EVENT_NAME_SET = new Set<string>(PROJECT_WORKFLOW_STREAM_EVENT_NAMES)
const IOS_KEYBOARD_COMPOSER_GAP = 8
const ANDROID_KEYBOARD_COMPOSER_GAP = 10
const CHAT_COMPOSER_VERTICAL_PADDING = 6
const CHAT_COMPOSER_INPUT_MAX_LINES = 4
const CHAT_COMPOSER_INPUT_LINE_HEIGHT = 20
const CHAT_COMPOSER_INPUT_VERTICAL_PADDING = 10
const CHAT_COMPOSER_INPUT_CONTENT_MAX_HEIGHT = CHAT_COMPOSER_INPUT_LINE_HEIGHT * CHAT_COMPOSER_INPUT_MAX_LINES
const CHAT_COMPOSER_INPUT_MIN_HEIGHT = 40
const CHAT_COMPOSER_INPUT_MAX_HEIGHT = CHAT_COMPOSER_INPUT_CONTENT_MAX_HEIGHT + CHAT_COMPOSER_INPUT_VERTICAL_PADDING * 2
const CHAT_SCROLL_TO_BOTTOM_THRESHOLD = 140
const CHAT_SESSION_CACHE_LIMIT = 8

const tabs: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'workbench', label: '工作台', icon: 'view-dashboard-outline' },
  { key: 'chat', label: '对话', icon: 'message-processing-outline' },
  { key: 'agents', label: 'Agent', icon: 'account' },
]

const WORKBENCH_PAGE_SIZE = 10
const DEFAULT_GROUP_AGENT_IDS = ['orchestrator', 'product-manager', 'engineer', 'reviewer'] as const
const DEFAULT_WORKSPACE_CREATE_AGENT_IDS = ['orchestrator', 'engineer'] as const
type DirectWorkspaceAgentId = 'claude-code-direct' | 'codex-direct'
type DirectWorkspaceAgentOption = {
  id: DirectWorkspaceAgentId
  name: string
  provider: 'claude' | 'codex'
}
const DIRECT_WORKSPACE_AGENT_OPTIONS: DirectWorkspaceAgentOption[] = [
  {
    id: 'claude-code-direct',
    name: 'Claude Code Agent',
    provider: 'claude',
  },
  {
    id: 'codex-direct',
    name: 'Codex Agent',
    provider: 'codex',
  },
]
const DEFAULT_GROUP_PROJECT_AGENTS: ProjectAgent[] = [
  {
    id: 'orchestrator',
    name: '项目经理 Agent',
    role: '负责理解用户请求、拆任务、调度子 Agent 并汇总结论。',
    description: 'AgentHub 主脑，负责工作区内多 Agent 协作和结果汇总。',
    whenToUse: '群聊任务、跨 Agent 协作、任务拆解和结果汇总时调用。',
    modelProvider: 'claude',
    model: 'default',
    skills: ['routing', 'context-building', 'summarization'],
    source: 'built-in',
  },
  {
    id: 'product-manager',
    name: '产品经理 Agent',
    role: '负责澄清需求、定义范围和验收标准。',
    description: '把用户输入整理成可执行的产品任务包。',
    whenToUse: '需求模糊、需要拆功能、需要验收标准时调用。',
    modelProvider: 'claude',
    model: 'default',
    skills: ['requirements', 'acceptance-criteria'],
    source: 'built-in',
  },
  {
    id: 'engineer',
    name: '工程师 Agent',
    role: '负责实现代码、生成 Diff 和产物预览。',
    description: '默认由 Codex 执行工程任务，后续可切换 Claude Code 或其他执行器。',
    whenToUse: '需要实现、修改、修复、生成代码或构建预览时调用。',
    modelProvider: 'codex',
    model: 'default',
    skills: ['typescript', 'runtime', 'diff'],
    source: 'built-in',
  },
  {
    id: 'reviewer',
    name: '测试审查 Agent',
    role: '负责质量检查、风险发现和验收结论。',
    description: '默认由 Claude Code 执行审查任务，输出 PASS / FAIL / PARTIAL。',
    whenToUse: '实现完成后、需要检查质量或验收时调用。',
    modelProvider: 'claude',
    model: 'default',
    skills: ['review', 'testing'],
    source: 'built-in',
  },
]
const DEFAULT_WORKBENCH_FILTERS: WorkbenchFilterState = {
  status: 'active',
  sortBy: 'updatedAt',
  sortDirection: 'desc',
}

function formatActivityTime(value?: string): string {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (diff < 48 * 60 * 60 * 1000) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatMessageTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatChatMessageTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function compactText(value?: string, fallback = '暂无内容'): string {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text) return fallback
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function compactLongText(value?: string, maxLength = 240, fallback = '暂无内容'): string {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text) return fallback
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function normalizeReplyReference(replyTo?: ProjectMessage['replyTo'] | null): ChatReplyReference | undefined {
  const messageId = replyTo?.messageId?.trim()
  const senderId = replyTo?.senderId?.trim()
  const excerpt = compactLongText(replyTo?.excerpt, 120, '')
  if (!messageId || !senderId || !excerpt) return undefined
  return {
    messageId,
    senderId,
    senderName: replyTo?.senderName?.trim() || undefined,
    excerpt,
  }
}

function getReplySenderLabel(replyTo?: ChatReplyReference): string {
  if (!replyTo) return ''
  const senderName = replyTo.senderName?.trim()
  if (senderName) return senderName
  if (replyTo.senderId === 'user') return '用户'
  return replyTo.senderId || 'Agent'
}

function createReplyReferenceFromMessage(message: ChatMessageView, senderName: string): ChatReplyReference | undefined {
  const excerpt = compactLongText(message.text, 120, '')
  if (!message.id || !excerpt || isLocalChatDraftMessage(message)) return undefined
  return {
    messageId: message.id,
    senderId: message.sender === 'user' ? 'user' : message.agentId ?? 'agent',
    senderName: senderName.trim() || undefined,
    excerpt,
  }
}

function artifactKindFromType(type?: string): ArtifactKind {
  if (type === 'web-preview' || type === 'preview') return 'preview'
  if (type === 'zip') return 'zip'
  if (type === 'deploy-status' || type === 'deploy') return 'deploy'
  if (type === 'diff') return 'diff'
  if (type === 'text') return 'text'
  return 'artifact'
}

function artifactIconForKind(kind: ArtifactKind): IconName {
  if (kind === 'preview') return 'cellphone-screenshot'
  if (kind === 'diff') return 'source-branch'
  if (kind === 'review') return 'shield-check-outline'
  if (kind === 'zip') return 'folder-zip-outline'
  if (kind === 'deploy') return 'cloud-upload-outline'
  if (kind === 'text') return 'text-box-outline'
  return 'file-document-outline'
}

function artifactMetricForKind(kind: ArtifactKind, artifact?: Pick<ArtifactView, 'fileCount' | 'verdict' | 'url'>): string {
  if (kind === 'preview') return artifact?.url ? 'preview ready' : 'preview'
  if (kind === 'diff') return 'code diff'
  if (kind === 'review') return artifact?.verdict ?? 'review'
  if (kind === 'zip') return artifact?.fileCount !== undefined ? `${artifact.fileCount} files` : 'source zip'
  if (kind === 'deploy') return artifact?.url ? 'deployment ready' : 'deploy'
  if (kind === 'text') return 'summary'
  return 'artifact'
}

function isDeliveryPreviewArtifact(artifact: ArtifactView): boolean {
  return artifact.deliverySurface === 'build' || artifact.deliverySurface === 'deployment'
}

function artifactStatusForKind(kind: ArtifactKind): Pick<ArtifactView, 'status' | 'statusLabel'> {
  if (kind === 'zip') return { status: 'ready', statusLabel: '可下载' }
  return { status: 'ready', statusLabel: '可查看' }
}

function absoluteArtifactUrl(url?: string): string | undefined {
  return url ? absoluteBackendUrl(url) : undefined
}

function readMetadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readDeliverySurface(metadata: Record<string, unknown> | undefined): DeliverySurface | undefined {
  const kind = metadata?.kind
  return kind === 'build' || kind === 'deployment' ? kind : undefined
}

function normalizeIssueList(value: unknown[] | undefined): string[] {
  return (value ?? [])
    .map(issue => {
      if (typeof issue === 'string') return issue
      if (issue && typeof issue === 'object') {
        const record = issue as Record<string, unknown>
        const path = typeof record.path === 'string' ? record.path : undefined
        const message = typeof record.message === 'string' ? record.message : JSON.stringify(record)
        return path ? `${path}: ${message}` : message
      }
      return String(issue)
    })
    .filter(item => item.trim().length > 0)
}

function normalizeChangedFiles(value: unknown[] | ProjectChangedFile[] | undefined): ProjectChangedFile[] {
  const files: ProjectChangedFile[] = []
  for (const file of value ?? []) {
    if (!file || typeof file !== 'object') continue
    const record = file as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path : undefined
    if (!path) continue
    files.push({
      path,
      status: typeof record.status === 'string' ? record.status : 'modified',
      additions: typeof record.additions === 'number' ? record.additions : 0,
      deletions: typeof record.deletions === 'number' ? record.deletions : 0,
      patch: typeof record.patch === 'string' ? record.patch : undefined,
    })
  }
  return files
}

function mapRuntimeStatus(status?: string): Workspace['status'] {
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'running' || status === 'busy') return 'running'
  return 'ready'
}

function getWorkspaceKey(workspace: Workspace): string {
  return workspace.projectId || workspace.id
}

function workspaceMatchesQuery(workspace: Workspace, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  return [workspace.name, workspace.goal, workspace.type, workspace.kind, workspace.latestEventLabel]
    .some(value => value.toLowerCase().includes(normalizedQuery))
}

function mapWorkbenchRoomToWorkspace(room: WorkbenchRoom): Workspace {
  const projectId = room.workspace.projectId
  return {
    id: projectId || room.workspace.id || room.id,
    projectId,
    runtimeWorkspaceId: room.workspace.id,
    conversationId: room.conversationId ?? room.id,
    name: room.workspace.name || room.title || '未命名工作区',
    goal: room.workspace.goal || room.subtitle || '暂无目标描述',
    kind: room.kind,
    type: room.workspace.workspaceType ?? (room.kind === 'direct' ? 'chat' : 'dev'),
    status: mapRuntimeStatus(room.workspace.runtimeStatus),
    pinned: Boolean(room.workspace.pinnedAt),
    archived: Boolean(room.workspace.archivedAt),
    agents: room.participantAgentIds ?? [],
    runningAgents: room.signal?.runningAgents ?? 0,
    artifactCount: room.signal?.artifactCount ?? 0,
    messageCount: room.signal?.messageCount ?? 0,
    latestEventLabel: room.signal?.latestEventLabel ?? '暂无新事件',
    updatedAt: formatActivityTime(room.lastActivityAt ?? room.workspace.updatedAt),
  }
}

function mapProjectMessageToChatMessage(message: ProjectMessage): ChatMessageView {
  return {
    id: message.id,
    sender: message.senderType === 'user' ? 'user' : 'agent',
    agentId: message.senderType === 'user' ? undefined : message.senderId ?? 'orchestrator',
    text: message.content ?? '',
    time: formatChatMessageTime(message.createdAt),
    createdAt: message.createdAt,
    turnId: message.turnId,
    replyTo: normalizeReplyReference(message.replyTo),
  }
}

function mapProjectArtifactToArtifactView(artifact: ProjectArtifact): ArtifactView {
  const type = artifactKindFromType(artifact.type)
  const fileCount = readMetadataNumber(artifact.metadata, 'fileCount')
  const byteLength = readMetadataNumber(artifact.metadata, 'byteLength')
  const deliverySurface = readDeliverySurface(artifact.metadata)
  const url = absoluteArtifactUrl(artifact.url)
  const base = {
    fileCount,
    byteLength,
    url,
  }
  return {
    id: artifact.id,
    type,
    title: artifact.title ?? '未命名产物',
    summary: compactLongText(artifact.summary ?? artifact.content, 240, '暂无摘要'),
    metric: artifactMetricForKind(type, base),
    icon: artifactIconForKind(type),
    ...artifactStatusForKind(type),
    createdAt: artifact.createdAt,
    agentId: artifact.createdByAgentId,
    url,
    deliverySurface,
    detailText: artifact.type === 'text' ? artifact.content : undefined,
    fileCount,
    byteLength,
    source: 'artifact',
  }
}

function mapChangeSetToArtifactView(changeSet: ProjectChangeSet): ArtifactView {
  const files = normalizeChangedFiles(changeSet.files)
  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  return {
    id: changeSet.id,
    type: 'diff',
    title: '代码 Diff',
    summary: compactLongText(changeSet.summary, 260, '已生成代码变更。'),
    metric: files.length ? `${files.length} files · +${additions}/-${deletions}` : 'code diff',
    icon: artifactIconForKind('diff'),
    status: 'ready',
    statusLabel: '可查看',
    createdAt: changeSet.createdAt,
    patch: changeSet.patch,
    files,
    changeSetId: changeSet.id,
    source: 'changeSet',
  }
}

function mapReviewEventToArtifactView(event: ProjectWorkflowEvent): ArtifactView | undefined {
  const detail = event.event
  if (!detail || (detail.type !== 'review_verdict' && detail.type !== 'delivery_validation_finished')) {
    return undefined
  }

  const verdict = detail.type === 'review_verdict' ? detail.verdict : detail.status
  return {
    id: `${detail.type}-${detail.runId ?? event.id}`,
    type: 'review',
    title: detail.type === 'review_verdict' ? '审查结论' : '交付校验',
    summary: compactLongText(detail.summary, 280, '暂无审查摘要。'),
    metric: verdict ? verdict.toUpperCase() : 'review',
    icon: artifactIconForKind('review'),
    status: verdict === 'fail' || verdict === 'failed' ? 'failed' : 'ready',
    statusLabel: '可查看',
    createdAt: event.createdAt,
    turnId: detail.turnId,
    agentId: detail.agentId,
    verdict: verdict ? verdict.toUpperCase() : undefined,
    issues: normalizeIssueList(detail.issues),
    source: 'review',
  }
}

function pushUniqueArtifactView(artifacts: ArtifactView[], artifact: ArtifactView): void {
  const index = artifacts.findIndex(item => item.id === artifact.id)
  if (index >= 0) {
    artifacts[index] = {
      ...artifacts[index],
      ...artifact,
    }
    return
  }
  artifacts.push(artifact)
}

function latestArtifact(artifacts: ArtifactView[], predicate: (artifact: ArtifactView) => boolean): ArtifactView | undefined {
  return artifacts
    .filter(predicate)
    .sort((left, right) => getTimeMs(left.createdAt) - getTimeMs(right.createdAt))
    .at(-1)
}

function sortArtifactViews(artifacts: ArtifactView[]): ArtifactView[] {
  const weight: Record<ArtifactKind, number> = {
    preview: 0,
    diff: 1,
    review: 2,
    zip: 3,
    deploy: 4,
    text: 5,
    artifact: 6,
  }
  return artifacts.slice().sort((left, right) => {
    const kindGap = weight[left.type] - weight[right.type]
    if (kindGap !== 0) return kindGap
    return getTimeMs(left.createdAt) - getTimeMs(right.createdAt)
  })
}

function summarizeLatestArtifacts(artifacts: ArtifactView[]): ArtifactView[] {
  const latest = [
    latestArtifact(artifacts, artifact => artifact.type === 'preview' && Boolean(artifact.url)),
    latestArtifact(artifacts, artifact => artifact.type === 'diff'),
    latestArtifact(artifacts, artifact => artifact.type === 'review'),
    latestArtifact(artifacts, artifact => artifact.type === 'zip'),
    latestArtifact(artifacts, artifact => artifact.type === 'deploy'),
    latestArtifact(artifacts, artifact => artifact.type === 'text'),
    latestArtifact(artifacts, artifact => artifact.type === 'artifact'),
  ].filter((artifact): artifact is ArtifactView => Boolean(artifact))

  return sortArtifactViews(latest.filter((artifact, index, list) => list.findIndex(item => item.id === artifact.id) === index))
}

function buildArtifactViewsFromProjectState(envelope: ProjectStateEnvelope): ArtifactView[] {
  const artifactsById = new Map((envelope.state.artifacts ?? []).map(artifact => [artifact.id, artifact]))
  const changeSetsById = new Map((envelope.state.changeSets ?? []).map(changeSet => [changeSet.id, changeSet]))
  const result: ArtifactView[] = []
  const eventTypes = new Set(['artifact_created', 'preview_ready', 'zip_ready', 'change_set_created', 'review_verdict', 'delivery_validation_finished'])

  for (const event of envelope.state.workflowEvents ?? []) {
    const detail = event.event
    if (!detail?.type || !eventTypes.has(detail.type)) continue

    if ((detail.type === 'artifact_created' || detail.type === 'preview_ready' || detail.type === 'zip_ready') && detail.artifactId) {
      const artifact = artifactsById.get(detail.artifactId)
      if (artifact) {
        pushUniqueArtifactView(result, {
          ...mapProjectArtifactToArtifactView(artifact),
          turnId: detail.turnId,
          createdAt: artifact.createdAt ?? event.createdAt,
        })
      } else if (detail.type === 'preview_ready' && detail.previewUrl) {
        pushUniqueArtifactView(result, {
          id: detail.artifactId,
          type: 'preview',
          title: '本地预览',
          summary: compactLongText(detail.previewUrl, 220, '预览已生成。'),
          metric: 'preview ready',
          icon: artifactIconForKind('preview'),
          status: 'ready',
          statusLabel: '可查看',
          createdAt: event.createdAt,
          turnId: detail.turnId,
          agentId: detail.agentId,
          url: absoluteArtifactUrl(detail.previewUrl),
          source: 'artifact',
        })
      }
      continue
    }

    if (detail.type === 'change_set_created' && detail.changeSetId) {
      const changeSet = changeSetsById.get(detail.changeSetId)
      if (changeSet) {
        pushUniqueArtifactView(result, {
          ...mapChangeSetToArtifactView(changeSet),
          turnId: detail.turnId,
          createdAt: changeSet.createdAt ?? event.createdAt,
        })
      } else {
        pushUniqueArtifactView(result, {
          id: detail.changeSetId,
          type: 'diff',
          title: '代码 Diff',
          summary: compactLongText(detail.summary, 260, '已生成代码 Diff。'),
          metric: detail.files?.length ? `${detail.files.length} files` : 'code diff',
          icon: artifactIconForKind('diff'),
          status: 'ready',
          statusLabel: '可查看',
          createdAt: event.createdAt,
          turnId: detail.turnId,
          files: normalizeChangedFiles(detail.files),
          changeSetId: detail.changeSetId,
          source: 'changeSet',
        })
      }
      continue
    }

    const reviewArtifact = mapReviewEventToArtifactView(event)
    if (reviewArtifact) {
      pushUniqueArtifactView(result, reviewArtifact)
    }
  }

  for (const message of envelope.state.messages ?? []) {
    for (const artifact of message.artifacts ?? []) {
      pushUniqueArtifactView(result, {
        ...mapProjectArtifactToArtifactView(artifact),
        turnId: message.turnId,
        createdAt: artifact.createdAt ?? message.createdAt,
      })
    }
  }

  for (const artifact of envelope.state.artifacts ?? []) {
    pushUniqueArtifactView(result, mapProjectArtifactToArtifactView(artifact))
  }

  return summarizeLatestArtifacts(result)
}

function getProjectAgentColor(agent?: ProjectAgent): string | undefined {
  if (agent?.modelProvider === 'codex') return '#10b981'
  if (agent?.modelProvider === 'claude') return '#7c3aed'
  return undefined
}

function isBuiltInAgentView(agent: Pick<ProjectAgent, 'model' | 'source'> | Pick<AgentView, 'model' | 'source'>): boolean {
  if (agent.source === 'workspace') return false
  return (agent.model ?? 'default') === 'default'
}

function getDefaultGroupProjectAgents(): ProjectAgent[] {
  const byId = new Map(DEFAULT_GROUP_PROJECT_AGENTS.map(agent => [agent.id, agent]))
  return DEFAULT_GROUP_AGENT_IDS.flatMap(agentId => {
    const agent = byId.get(agentId)
    return agent ? [{ ...agent }] : []
  })
}

function isDirectWorkspaceAgentId(agentId: string): agentId is DirectWorkspaceAgentId {
  return DIRECT_WORKSPACE_AGENT_OPTIONS.some(option => option.id === agentId)
}

function mapProjectAgentToAgentView(agent: ProjectAgent, index: number): AgentView {
  const fallback = agents.find(item => item.id === agent.id)
  const provider = agent.modelProvider === 'codex' || agent.modelProvider === 'claude'
    ? agent.modelProvider
    : fallback?.provider ?? 'claude'
  const model = agent.model ?? 'default'
  const color = getProjectAgentColor(agent) ?? fallback?.color ?? ['#7c3aed', '#2563eb', '#10b981', '#f59e0b'][index % 4]
  return {
    id: agent.id,
    name: agent.name ?? fallback?.name ?? agent.id,
    role: agent.role ?? agent.description ?? agent.whenToUse ?? fallback?.role ?? '当前工作区 Agent',
    provider,
    status: fallback?.status ?? 'idle',
    color,
    skills: agent.skills?.length ? agent.skills : [isBuiltInAgentView(agent) ? '内置' : '自定义', provider],
    source: agent.source,
    workspaceId: agent.workspaceId,
    conversationId: agent.conversationId,
    model,
    description: agent.description,
    whenToUse: agent.whenToUse,
    systemPrompt: agent.systemPrompt,
    permissionMode: agent.permissionMode,
    runtimePolicy: agent.runtimePolicy,
    raw: agent,
  }
}

function findProjectAgent(agentList: ProjectAgent[], agentId?: string): ProjectAgent | undefined {
  if (!agentId) return undefined
  return agentList.find(agent => agent.id === agentId)
}

function isNonEmptyString(value?: string): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function getProjectAgentInstanceKey(agent: ProjectAgent, index?: number): string {
  const scopedKey = [agent.workspaceId, agent.conversationId, agent.id].filter(isNonEmptyString).join(':')
  const stableKey = (agent.rowId ?? agent.row_id ?? scopedKey) || agent.id
  return index === undefined ? stableKey : `${stableKey}-${index}`
}

function getUniqueProjectAgents(agentList: ProjectAgent[]): ProjectAgent[] {
  const seen = new Set<string>()

  return agentList.filter(agent => {
    const key = getProjectAgentInstanceKey(agent)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeProjectAgents(...agentLists: ProjectAgent[][]): ProjectAgent[] {
  return getUniqueProjectAgents(agentLists.flat())
}

async function fetchAgentsForWorkspaces(workspaceItems: Workspace[]): Promise<ProjectAgent[]> {
  const projectIds = Array.from(new Set(workspaceItems.map(workspace => workspace.projectId ?? workspace.id).filter(isNonEmptyString)))
  if (projectIds.length === 0) return []

  const results = await Promise.allSettled(projectIds.map(projectId => fetchProjectAgents(projectId)))
  return mergeProjectAgents(...results.map(result => result.status === 'fulfilled' ? result.value : []))
}

function projectAgentMatchesWorkspace(agent: ProjectAgent, workspace: Workspace, conversationId?: string): boolean {
  const workspaceIds = new Set([workspace.runtimeWorkspaceId, workspace.id, workspace.projectId].filter(isNonEmptyString))
  const conversationIds = new Set([conversationId, workspace.conversationId].filter(isNonEmptyString))

  if (agent.workspaceId && workspaceIds.has(agent.workspaceId)) return true
  if (agent.conversationId && conversationIds.has(agent.conversationId)) return true

  return false
}

function getVisibleChatAgents(workspace: Workspace, agentList: ProjectAgent[], conversationId?: string): ProjectAgent[] {
  if (agentList.length === 0) {
    return getUniqueProjectAgents(workspace.agents.map(id => ({ id })))
  }

  const scopedAgents = agentList.filter(agent => projectAgentMatchesWorkspace(agent, workspace, conversationId))
  if (scopedAgents.length > 0) {
    return getUniqueProjectAgents(scopedAgents)
  }

  const participantIds = new Set(workspace.agents)
  const matchingAgents = agentList.filter(agent => participantIds.size === 0 || participantIds.has(agent.id))

  return getUniqueProjectAgents(matchingAgents.length > 0 ? matchingAgents : agentList)
}

function getAgentMentionHandle(agent: ProjectAgent): string {
  return agent.id.trim()
}

function findActiveMentionToken(text: string, cursor: number): { start: number; end: number; query: string } | null {
  const boundedCursor = Math.max(0, Math.min(cursor, text.length))
  const beforeCursor = text.slice(0, boundedCursor)
  const match = /(^|\s)@([A-Za-z0-9._-]*)$/.exec(beforeCursor)
  if (!match) return null

  return {
    start: beforeCursor.length - match[0].length + match[1].length,
    end: boundedCursor,
    query: match[2].toLowerCase(),
  }
}

function projectAgentMatchesMentionQuery(agent: ProjectAgent, query: string): boolean {
  if (!query) return true
  return [agent.id, agent.name, agent.role, agent.description, agent.whenToUse, agent.modelProvider]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some(value => value.toLowerCase().includes(query))
}

function findMentionedProjectAgentId(content: string, agentList: ProjectAgent[]): string | undefined {
  const mentionTokens = content
    .split(/\s+/)
    .map(token => token.replace(/^[([{]+|[)\]},.!?;:]+$/g, '').toLowerCase())

  return agentList.find(agent => mentionTokens.includes(`@${getAgentMentionHandle(agent).toLowerCase()}`))?.id
}

function mapWorkflowEventToStep(event: ProjectWorkflowEvent): ChatProcessStep | null {
  const detail = event.event
  if (!detail?.type) return null

  const type = detail.type
  const status = detail.status
  const failed = status === 'failed' || status === 'error' || type === 'assistant_message_error' || type === 'model_call_failed'
  const warning = status === 'partial' || detail.verdict === 'partial'
  const completed =
    status === 'completed' ||
    status === 'success' ||
    type === 'workflow_finished' ||
    type === 'agent_finished' ||
    type === 'assistant_message_finished' ||
    type === 'model_call_finished' ||
    type === 'context_finished' ||
    type === 'agent_output_finished' ||
    type === 'artifact_created' ||
    type === 'change_set_created' ||
    type === 'preview_ready' ||
    type === 'zip_ready' ||
    type === 'synthesis_finished'
  const agentName = detail.agentName ?? detail.agentId ?? 'Agent'
  const provider = detail.provider ?? '模型'
  const titleByType: Record<string, string> = {
    turn_started: '本轮开始',
    workflow_received: '已接收本轮消息',
    routing_started: '主脑正在判断由谁处理',
    routing_finished: '路由判断完成',
    task_stage_updated: `当前阶段：${detail.taskStage ?? '执行中'}`,
    context_started: '正在整理上下文',
    context_finished: '上下文整理完成',
    model_call_started: `${detail.agentName ?? 'Agent'} 正在调用 ${provider}`,
    model_call_finished: `模型调用完成：${provider}`,
    model_call_failed: `模型调用失败：${provider}`,
    handoff_created: '任务已分配',
    handoff_updated: `${agentName} 状态更新`,
    agent_task_dispatched: `已派发给 ${agentName}`,
    agent_started: `${agentName} 已开始执行`,
    agent_progress: `${agentName} 执行进展`,
    agent_output_started: `${agentName} 开始输出`,
    agent_stdout_delta: `${agentName} 执行输出`,
    agent_stderr_delta: `${agentName} 异常输出`,
    agent_output_finished: `${agentName} 输出结束`,
    agent_finished: `${agentName}${status === 'failed' ? '执行失败' : status === 'partial' ? '部分完成' : '执行完成'}`,
    delivery_validation_finished: `交付校验：${status ?? '完成'}`,
    review_verdict: `审查结论：${detail.verdict ?? '完成'}`,
    artifact_created: `已生成产物：${detail.title ?? detail.artifactType ?? '产物'}`,
    change_set_created: '已生成代码 Diff',
    preview_ready: '已生成本地预览',
    zip_ready: '已打包源码',
    agent_session_started: `${agentName} 会话开始`,
    agent_session_finished: `${agentName} 会话完成`,
    assistant_message_started: `${detail.senderName ?? detail.senderId ?? 'Agent'} 正在输出结果`,
    assistant_message_finished: '结果输出完成',
    assistant_message_error: '结果输出失败',
    synthesis_started: '主脑正在汇总多 Agent 结果',
    synthesis_finished: '主脑已完成结果汇总',
    workflow_finished: '本轮已完成',
  }
  const detailParts = [
    detail.scope ? `范围：${detail.scope}` : undefined,
    detail.tokenEstimate ? `约 ${detail.tokenEstimate} tokens` : undefined,
    detail.contextTokens ? `上下文：${detail.contextTokens} tokens` : undefined,
    detail.elapsedMs ? `${Math.round(detail.elapsedMs)}ms` : undefined,
    detail.contentLength ? `内容长度：${detail.contentLength} chars` : undefined,
    detail.fileCount ? `${detail.fileCount} files` : undefined,
  ]
  const summary =
    detail.summary ??
    detail.task ??
    detail.reason ??
    detail.message ??
    detail.error ??
    detail.previewUrl ??
    detail.zipUrl ??
    detailParts.filter(Boolean).join(' | ') ??
    status ??
    detail.verdict

  const stepId =
    detail.messageId && (type === 'assistant_message_started' || type === 'assistant_message_finished' || type === 'assistant_message_error')
      ? `reply-${detail.messageId}`
      : detail.runId && (type.startsWith('agent_') || type === 'delivery_validation_finished' || type === 'review_verdict')
        ? `${type.includes('stdout') || type.includes('stderr') || type === 'agent_output_finished' ? 'agent-log' : 'agent-run'}-${detail.runId}`
        : type.startsWith('model_call_')
          ? `model-call-${detail.scope ?? 'main'}-${detail.provider ?? detail.agentId ?? 'model'}`
          : detail.handoffId
            ? `handoff-${detail.handoffId}`
            : detail.artifactId
              ? `artifact-${detail.artifactId}-${type}`
              : type === 'synthesis_started' || type === 'synthesis_finished'
                ? 'synthesis-state'
                : type === 'workflow_finished'
                  ? 'workflow-finished'
                  : event.id

  return {
    id: stepId,
    icon: failed ? 'close-circle-outline' : completed ? 'check-circle-outline' : warning ? 'alert-circle-outline' : 'progress-clock',
    title: titleByType[type] ?? `过程更新：${type.replace(/_/g, ' ')}`,
    summary: compactText(summary, '已记录过程更新'),
    time: formatMessageTime(event.createdAt),
    tone: failed ? 'failed' : completed || warning ? 'done' : 'running',
  }
}

function getTimeMs(value?: string): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function summarizeProcessGroupStatus(steps: ChatProcessStep[]): ChatProcessGroup['status'] {
  const lastStep = steps[steps.length - 1]
  if (lastStep?.title === '本轮已完成') return 'done'
  if (steps.some(step => step.tone === 'failed')) return 'failed'
  if (steps.some(step => step.tone === 'running')) return 'running'
  if (steps.some(step => step.tone === 'waiting')) return 'waiting'
  return 'done'
}

function isFinalAgentMessage(message: ChatMessageView): boolean {
  return message.sender === 'agent' && !message.id.startsWith('streaming-') && !message.id.startsWith('local-')
}

function hasFinalAgentMessageForGroup(group: ChatProcessGroup, messages: ChatMessageView[], targetMessage: ChatMessageView): boolean {
  const matchingTurnMessage = messages.some(message => isFinalAgentMessage(message) && !!message.turnId && message.turnId === group.turnId)
  if (matchingTurnMessage) return true

  const targetTime = getTimeMs(targetMessage.createdAt)
  const groupTime = getTimeMs(group.startedAt ?? group.updatedAt)
  const nextUserMessage = messages.find(message => {
    const messageTime = getTimeMs(message.createdAt)
    return message.sender === 'user' && messageTime > targetTime
  })
  const nextUserTime = getTimeMs(nextUserMessage?.createdAt)
  const lowerBound = groupTime > 0 ? groupTime : targetTime

  return messages.some(message => {
    if (!isFinalAgentMessage(message)) return false
    const messageTime = getTimeMs(message.createdAt)
    if (messageTime === 0) return false
    if (lowerBound > 0 && messageTime < lowerBound) return false
    if (nextUserTime > 0 && messageTime >= nextUserTime) return false
    return true
  })
}

function resolveProcessGroupForTimeline(group: ChatProcessGroup, messages: ChatMessageView[], targetMessage: ChatMessageView): ChatProcessGroup {
  if (group.status !== 'running') return group
  if (!hasFinalAgentMessageForGroup(group, messages, targetMessage)) return group

  return {
    ...group,
    status: 'done',
  }
}

function buildProcessGroups(events: ProjectWorkflowEvent[]): ChatProcessGroup[] {
  const groupMap = new Map<string, ChatProcessGroup>()

  events.forEach(event => {
    const step = mapWorkflowEventToStep(event)
    if (!step) return

    const turnId = event.event?.turnId ?? `event-${event.id}`
    const previous = groupMap.get(turnId)
    const eventTime = getTimeMs(event.createdAt)
    const previousStartedAt = getTimeMs(previous?.startedAt)
    const previousUpdatedAt = getTimeMs(previous?.updatedAt)
    const steps = previous ? [...previous.steps.filter(item => item.id !== step.id), step] : [step]

    groupMap.set(turnId, {
      id: `process-${turnId}`,
      turnId,
      steps,
      startedAt: !previous || (eventTime > 0 && (previousStartedAt === 0 || eventTime < previousStartedAt)) ? event.createdAt : previous.startedAt,
      updatedAt: !previous || eventTime >= previousUpdatedAt ? event.createdAt : previous.updatedAt,
      status: summarizeProcessGroupStatus(steps),
    })
  })

  return [...groupMap.values()].sort((left, right) => getTimeMs(left.startedAt ?? left.updatedAt) - getTimeMs(right.startedAt ?? right.updatedAt))
}

function buildChatTimeline(messages: ChatMessageView[], processGroups: ChatProcessGroup[]): ChatTimelineItem[] {
  const sortedMessages = [...messages].sort((left, right) => getTimeMs(left.createdAt) - getTimeMs(right.createdAt))
  const sortedGroups = [...processGroups].sort((left, right) => getTimeMs(left.startedAt ?? left.updatedAt) - getTimeMs(right.startedAt ?? right.updatedAt))
  const groupsAfterMessage = new Map<string, ChatProcessGroup[]>()
  const leadingGroups: ChatProcessGroup[] = []

  sortedGroups.forEach(group => {
    const groupTime = getTimeMs(group.startedAt ?? group.updatedAt)
    let targetMessage: ChatMessageView | undefined

    for (const message of sortedMessages) {
      const messageTime = getTimeMs(message.createdAt)
      if (message.sender === 'user' && groupTime > 0 && messageTime > 0 && messageTime <= groupTime) {
        targetMessage = message
      }
    }

    if (!targetMessage && sortedMessages.length > 0) {
      targetMessage = sortedMessages.find(message => message.sender === 'user') ?? sortedMessages[0]
    }

    if (!targetMessage) {
      leadingGroups.push(group)
      return
    }

    const previous = groupsAfterMessage.get(targetMessage.id) ?? []
    groupsAfterMessage.set(targetMessage.id, [...previous, resolveProcessGroupForTimeline(group, sortedMessages, targetMessage)])
  })

  const timeline: ChatTimelineItem[] = leadingGroups.map(group => ({
    type: 'process',
    id: group.id,
    group,
  }))

  sortedMessages.forEach(message => {
    timeline.push({ type: 'message', id: message.id, message })
    const attachedGroups = groupsAfterMessage.get(message.id) ?? []
    attachedGroups.forEach(group => {
      timeline.push({ type: 'process', id: group.id, group })
    })
  })

  return timeline
}

function createChatStateView(input: Omit<ChatStateView, 'timelineItems'>): ChatStateView {
  return {
    ...input,
    timelineItems: buildChatTimeline(input.messages, input.processGroups),
  }
}

function createEmptyChatState(): ChatStateView {
  return createChatStateView({
    messages: [],
    processGroups: [],
    artifacts: [],
    agents: [],
  })
}

function createEmptyChatSession(): ChatProjectSession {
  return {
    chatState: createEmptyChatState(),
    loading: false,
    error: '',
    streaming: false,
    loaded: false,
    lastTouchedAt: Date.now(),
    lastFailedMessage: null,
  }
}

function hasLocalPendingChatState(chatState: ChatStateView): boolean {
  return chatState.messages.some(message => isLocalChatDraftMessage(message)) ||
    chatState.processGroups.some(group => group.local || group.status === 'running')
}

function isLocalChatDraftMessage(message: ChatMessageView): boolean {
  return message.id.startsWith('streaming-') || message.id.startsWith('local-chat-')
}

function hasCommittedReplacement(localMessage: ChatMessageView, committedMessages: ChatMessageView[]): boolean {
  if (!isLocalChatDraftMessage(localMessage)) return false
  if (localMessage.turnId && committedMessages.some(message => message.turnId === localMessage.turnId && message.sender === localMessage.sender)) return true
  if (localMessage.sender === 'agent' && localMessage.id.startsWith('streaming-')) {
    const committedMessageId = localMessage.id.slice('streaming-'.length)
    return committedMessages.some(message => message.sender === 'agent' && message.id === committedMessageId)
  }
  if (localMessage.sender === 'agent') {
    const localText = localMessage.text.trim()
    const localTime = getTimeMs(localMessage.createdAt)
    return committedMessages.some(message => {
      if (message.sender !== 'agent') return false
      if (localMessage.agentId && message.agentId !== localMessage.agentId) return false
      const committedTime = getTimeMs(message.createdAt)
      if (localTime > 0 && committedTime > 0 && Math.abs(committedTime - localTime) > 10 * 60 * 1000) return false
      return !localText || message.text.includes(localText)
    })
  }

  const localTime = getTimeMs(localMessage.createdAt)
  return committedMessages.some(message => {
    if (message.sender !== localMessage.sender) return false
    if (localMessage.sender === 'user' && message.text.trim() !== localMessage.text.trim()) return false
    if (localMessage.sender === 'agent' && localMessage.agentId && message.agentId !== localMessage.agentId) return false

    const committedTime = getTimeMs(message.createdAt)
    if (localTime === 0 || committedTime === 0) return true
    return Math.abs(committedTime - localTime) < 5 * 60 * 1000
  })
}

function mergeChatStateWithLocalDrafts(remote: ChatStateView, local: ChatStateView, keepLocalDrafts: boolean): ChatStateView {
  if (!keepLocalDrafts) return remote

  const localMessages = local.messages.filter(message =>
    isLocalChatDraftMessage(message) &&
    !hasCommittedReplacement(message, remote.messages),
  )
  const remoteGroupIds = new Set(remote.processGroups.map(group => group.turnId))
  const localProcessGroups = local.processGroups.filter(group =>
    localMessages.length > 0 &&
    !remoteGroupIds.has(group.turnId) &&
    (group.local || group.status === 'running'),
  )

  if (localMessages.length === 0 && localProcessGroups.length === 0) return remote

  return createChatStateView({
    ...remote,
    messages: [...remote.messages, ...localMessages],
    processGroups: [...remote.processGroups, ...localProcessGroups],
  })
}

function trimChatSessionCache(sessions: Record<string, ChatProjectSession>, keepProjectId: string): Record<string, ChatProjectSession> {
  const entries = Object.entries(sessions)
  if (entries.length <= CHAT_SESSION_CACHE_LIMIT) return sessions

  const protectedEntries = entries.filter(([projectId, session]) =>
    projectId === keepProjectId ||
    session.streaming ||
    hasLocalPendingChatState(session.chatState),
  )
  const protectedIds = new Set(protectedEntries.map(([projectId]) => projectId))
  const disposableEntries = entries
    .filter(([projectId]) => !protectedIds.has(projectId))
    .sort(([, left], [, right]) => right.lastTouchedAt - left.lastTouchedAt)

  return Object.fromEntries([
    ...protectedEntries,
    ...disposableEntries.slice(0, Math.max(0, CHAT_SESSION_CACHE_LIMIT - protectedEntries.length)),
  ])
}

function parseStreamPayload(rawData: string | null, fallbackType: ProjectStreamEvent): ProjectWorkflowEvent['event'] | undefined {
  if (!rawData) return fallbackType === 'message' ? undefined : { type: fallbackType }

  try {
    const payload = JSON.parse(rawData) as Record<string, unknown>
    const detailPayload = (payload.event && typeof payload.event === 'object' ? payload.event : payload) as Record<string, unknown>
    const type = typeof detailPayload.type === 'string' ? detailPayload.type : fallbackType === 'message' ? undefined : fallbackType
    if (!type) return undefined
    return {
      ...detailPayload,
      type,
    } as ProjectWorkflowEvent['event']
  } catch {
    return fallbackType === 'assistant_delta'
      ? { type: 'assistant_delta', message: rawData }
      : fallbackType === 'message'
        ? undefined
        : { type: fallbackType, summary: rawData }
  }
}

function streamingMessageId(messageId?: string): string {
  return `streaming-${messageId ?? 'local-streaming-message'}`
}

function upsertStreamingAssistantMessage(messages: ChatMessageView[], input: { messageId?: string; agentId?: string; turnId?: string; delta?: string; createdAt: string }): ChatMessageView[] {
  const id = streamingMessageId(input.messageId)
  const previous = messages.find(message => message.id === id)
  const nextMessage: ChatMessageView = {
    id,
    sender: 'agent',
    agentId: input.agentId ?? previous?.agentId ?? 'orchestrator',
    text: `${previous?.text ?? ''}${input.delta ?? ''}`,
    time: previous?.time ?? formatChatMessageTime(input.createdAt),
    createdAt: previous?.createdAt ?? input.createdAt,
    turnId: input.turnId ?? previous?.turnId,
  }

  if (previous) {
    return messages.map(message => message.id === id ? nextMessage : message)
  }

  return [...messages, nextMessage]
}

function useKeyboardBottomSpacing(bottomInset: number): number {
  const [keyboardSpacing, setKeyboardSpacing] = useState(0)

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      setKeyboardSpacing(0)
      return
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const composerGap = Platform.OS === 'ios' ? IOS_KEYBOARD_COMPOSER_GAP : ANDROID_KEYBOARD_COMPOSER_GAP
    const keyboardFrameSubscription = Keyboard.addListener(showEvent, event => {
      setKeyboardSpacing(Math.max(0, event.endCoordinates.height - bottomInset + composerGap))
    })
    const keyboardHideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardSpacing(0)
    })

    return () => {
      keyboardFrameSubscription.remove()
      keyboardHideSubscription.remove()
    }
  }, [bottomInset])

  return keyboardSpacing
}

function appendProcessStepToGroups(groups: ChatProcessGroup[], turnId: string, step: ChatProcessStep, options?: { local?: boolean; createdAt?: string }): ChatProcessGroup[] {
  const groupId = `process-${turnId}`
  const previous = groups.find(group => group.turnId === turnId)
  const createdAt = options?.createdAt ?? new Date().toISOString()

  if (!previous) {
    return [
      ...groups,
      {
        id: groupId,
        turnId,
        steps: [step],
        startedAt: createdAt,
        updatedAt: createdAt,
        status: step.tone,
        local: options?.local,
      },
    ]
  }

  const nextSteps = [...previous.steps.filter(item => item.id !== step.id), step]
  return groups.map(group =>
    group.turnId === turnId
      ? {
          ...group,
          steps: nextSteps,
          updatedAt: createdAt,
          status: summarizeProcessGroupStatus(nextSteps),
          local: group.local || options?.local,
        }
      : group,
  )
}

function buildChatStateView(envelope: ProjectStateEnvelope): ChatStateView {
  const messages = (envelope.state.messages ?? []).map(mapProjectMessageToChatMessage)
  const processGroups = buildProcessGroups(envelope.state.workflowEvents ?? [])
  const artifacts = buildArtifactViewsFromProjectState(envelope)

  return createChatStateView({
    messages,
    processGroups,
    artifacts,
    agents: envelope.state.agents ?? [],
    conversationId: envelope.state.conversations?.[0]?.id,
    messagePage: envelope.messagePage,
  })
}

function AnimatedHomeIcon({ size }: { size: number }) {
  const floatValue = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatValue, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(floatValue, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    )

    loop.start()
    return () => loop.stop()
  }, [floatValue])

  const translateY = floatValue.interpolate({
    inputRange: [0, 1],
    outputRange: [3, -5],
  })
  const scale = floatValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.04],
  })

  return (
    <Animated.Image
      source={homeIcon}
      resizeMode="contain"
      style={[
        styles.animatedHomeIcon,
        {
          width: size,
          height: size * 0.98,
          transform: [{ translateY }, { scale }],
        },
      ]}
    />
  )
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking')
  const [backendErrorMessage, setBackendErrorMessage] = useState('')
  const [backendRetryDialog, setBackendRetryDialog] = useState<BackendRetryDialogState>({
    visible: false,
    title: '',
    message: '',
    onRetry: () => undefined,
  })
  const [retryCount, setRetryCount] = useState(0)
  const [activeTab, setActiveTab] = useState<TabKey>('workbench')
  const [agentEntryMode, setAgentEntryMode] = useState<AgentEntryMode>('global')
  const [appMenuOpen, setAppMenuOpen] = useState(false)
  const [workspaceList, setWorkspaceList] = useState<Workspace[]>(workspaces)
  const [workbenchAgentList, setWorkbenchAgentList] = useState<ProjectAgent[]>([])
  const [workspaceAgentRegistry, setWorkspaceAgentRegistry] = useState<ProjectAgent[]>([])
  const [agentRegistryWorkspaceId, setAgentRegistryWorkspaceId] = useState('')
  const [agentRegistryLoading, setAgentRegistryLoading] = useState(false)
  const [workbenchLoading, setWorkbenchLoading] = useState(false)
  const [loadingMoreWorkspaces, setLoadingMoreWorkspaces] = useState(false)
  const [workbenchRefreshing, setWorkbenchRefreshing] = useState(false)
  const [workspaceActionState, setWorkspaceActionState] = useState<WorkspaceActionState>(null)
  const [workbenchPage, setWorkbenchPage] = useState<WorkbenchPageState>({
    hasMore: false,
    total: workspaces.length,
  })
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const [workbenchFilters, setWorkbenchFilters] = useState<WorkbenchFilterState>(DEFAULT_WORKBENCH_FILTERS)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [activityOpen, setActivityOpen] = useState(false)
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false)
  const [workspacePanelMode, setWorkspacePanelMode] = useState<'switch' | 'create'>('switch')
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [agentCreateSignal, setAgentCreateSignal] = useState(0)
  const [chatSessionsByProject, setChatSessionsByProject] = useState<Record<string, ChatProjectSession>>({})
  const streamRefsByProject = useRef<Record<string, ProjectMessageStream | undefined>>({})
  const chatLoadRequestIdsRef = useRef<Record<string, number>>({})
  const chatSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({})
  const chatSessionsByProjectRef = useRef(chatSessionsByProject)
  const workbenchLoadRequestIdRef = useRef(0)
  const { width } = useWindowDimensions()
  const layoutTier: LayoutTier = width < 380 ? 'compact' : width < 430 ? 'standard' : 'wide'
  const mobileScale = useMemo(() => createMobileScale(layoutTier, width), [layoutTier, width])
  const tightChatHeader = activeTab === 'chat' && layoutTier !== 'wide'
  const activeWorkspace = workspaceList.find(workspace => workspace.id === activeWorkspaceId) ?? workspaceList[0] ?? workspaces[0]
  const defaultAgentRegistry = useMemo(() => getDefaultGroupProjectAgents(), [])
  const isWorkspaceAgentPage = activeTab === 'agents' && agentEntryMode === 'workspace'
  const canCreateAgent = isWorkspaceAgentPage && activeWorkspace.kind === 'group'
  const currentAgentProjectId = activeWorkspace.projectId ?? activeWorkspace.id
  const agentRegistryTitle = isWorkspaceAgentPage ? activeWorkspace.name : 'Agent Registry'
  const agentScreenProjectAgents = isWorkspaceAgentPage && agentRegistryWorkspaceId === currentAgentProjectId
    ? workspaceAgentRegistry
    : defaultAgentRegistry
  const activeChatSession = useMemo(
    () => chatSessionsByProject[currentAgentProjectId] ?? createEmptyChatSession(),
    [chatSessionsByProject, currentAgentProjectId],
  )
  const title = useMemo(() => {
    if (activeTab === 'workbench') return '工作台'
    if (activeTab === 'chat') return '对话'
    if (agentEntryMode === 'workspace') return activeWorkspace.name
    return '我的 Agent'
  }, [activeTab, activeWorkspace.name, agentEntryMode])
  const retryBackendHealth = () => setRetryCount(count => count + 1)

  function showBackendRetryDialog(input: Omit<BackendRetryDialogState, 'visible'>) {
    setBackendRetryDialog({
      ...input,
      visible: true,
    })
  }

  function hideBackendRetryDialog() {
    setBackendRetryDialog(previous => ({
      ...previous,
      visible: false,
    }))
  }

  async function loadWorkbenchPage(input?: {
    cursor?: string
    append?: boolean
    query?: string
    filters?: WorkbenchFilterState
    silent?: boolean
  }) {
    const append = input?.append ?? false
    const requestId = ++workbenchLoadRequestIdRef.current
    if (!input?.silent) {
      if (append) {
        setLoadingMoreWorkspaces(true)
      } else {
        setWorkbenchLoading(true)
      }
    }

    const requestFilters = input?.filters ?? workbenchFilters
    const request = {
      pageSize: WORKBENCH_PAGE_SIZE,
      cursor: input?.cursor,
      query: input?.query ?? workspaceQuery,
      status: requestFilters.status,
      sortBy: requestFilters.sortBy,
      sortDirection: requestFilters.sortDirection,
    }

    try {
      const overview = await fetchWorkbenchOverview(request)
      if (workbenchLoadRequestIdRef.current !== requestId) return
      const nextWorkspaces = overview.rooms.map(mapWorkbenchRoomToWorkspace)
      setWorkbenchAgentList(current => mergeProjectAgents(current, overview.agents ?? []))
      setWorkspaceList(current => {
        if (!append) return nextWorkspaces
        const existingIds = new Set(current.map(getWorkspaceKey))
        return [...current, ...nextWorkspaces.filter(item => !existingIds.has(getWorkspaceKey(item)))]
      })
      setWorkbenchPage({
        hasMore: overview.page.hasMore,
        nextCursor: overview.page.nextCursor,
        total: overview.page.total,
      })
      if (!append) {
        setActiveWorkspaceId(current => nextWorkspaces.some(item => item.id === current) ? current : nextWorkspaces[0]?.id ?? '')
      }
      if (!input?.silent) {
        setWorkbenchLoading(false)
        setLoadingMoreWorkspaces(false)
      }
      const scopedAgents = await fetchAgentsForWorkspaces(nextWorkspaces)
      if (workbenchLoadRequestIdRef.current !== requestId) return
      setWorkbenchAgentList(current => mergeProjectAgents(current, overview.agents ?? [], scopedAgents))
    } catch (error) {
      if (workbenchLoadRequestIdRef.current !== requestId) return
      const message = error instanceof Error ? error.message : '工作区列表加载失败。'
      showBackendRetryDialog({
        title: '工作区加载失败',
        message: '后端暂时无法返回工作区列表，请点击重试。',
        detail: message,
        onRetry: () => {
          void loadWorkbenchPage(input)
        },
      })
    } finally {
      if (workbenchLoadRequestIdRef.current === requestId && !input?.silent) {
        setWorkbenchLoading(false)
        setLoadingMoreWorkspaces(false)
      }
    }
  }

  function applyWorkbenchFilters(next: {
    status?: WorkspaceListStatus
    sortBy?: WorkspaceSortField
    sortDirection?: SortDirection
  }) {
    const nextFilters: WorkbenchFilterState = {
      status: next.status ?? workbenchFilters.status,
      sortBy: next.sortBy ?? workbenchFilters.sortBy,
      sortDirection: next.sortDirection ?? workbenchFilters.sortDirection,
    }

    setWorkbenchFilters(nextFilters)
  }

  async function handleCreateWorkspace(input: CreateWorkspaceInput) {
    setCreatingWorkspace(true)

    try {
      const project = await createBusinessWorkspace(input)
      await loadWorkbenchPage()
      setActiveWorkspaceId(project.projectId || project.workspaceId)
      setWorkspacePanelOpen(false)
      setActiveTab('chat')
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建工作区失败。'
      showBackendRetryDialog({
        title: '创建工作区失败',
        message: '后端暂时没有成功创建工作区，请检查内容后重试。',
        detail: message,
        onRetry: () => {
          void handleCreateWorkspace(input)
        },
      })
    } finally {
      setCreatingWorkspace(false)
    }
  }

  function updateChatSession(projectId: string, updater: (session: ChatProjectSession) => ChatProjectSession) {
    setChatSessionsByProject(current => {
      const nextSession = {
        ...updater(current[projectId] ?? createEmptyChatSession()),
        lastTouchedAt: Date.now(),
      }
      const nextSessions = trimChatSessionCache({
        ...current,
        [projectId]: nextSession,
      }, projectId)
      chatSessionsByProjectRef.current = nextSessions
      return nextSessions
    })
  }

  async function loadProjectChatState(projectId: string, options?: { preserveLocal?: boolean; silent?: boolean }) {
    const requestId = (chatLoadRequestIdsRef.current[projectId] ?? 0) + 1
    chatLoadRequestIdsRef.current[projectId] = requestId

    if (!options?.silent) {
      updateChatSession(projectId, session => ({
        ...session,
        loading: true,
        error: '',
      }))
    }

    try {
      const envelope = await fetchProjectState(projectId, { messageLimit: 40 })
      if (chatLoadRequestIdsRef.current[projectId] !== requestId) return

      updateChatSession(projectId, session => {
        const remoteState = buildChatStateView(envelope)
        const keepLocalDrafts = options?.preserveLocal ?? session.streaming
        return {
          ...session,
          chatState: mergeChatStateWithLocalDrafts(remoteState, session.chatState, keepLocalDrafts),
          loading: false,
          error: '',
          loaded: true,
        }
      })
    } catch (error) {
      if (chatLoadRequestIdsRef.current[projectId] !== requestId) return
      updateChatSession(projectId, session => ({
        ...session,
        loading: false,
        error: error instanceof Error ? error.message : '对话加载失败。',
      }))
    }
  }

  function scheduleProjectChatSync(projectId: string) {
    const previousTimers = chatSyncTimersRef.current[projectId] ?? []
    previousTimers.forEach(timer => clearTimeout(timer))
    chatSyncTimersRef.current[projectId] = [1600, 4200, 8600].map(delay =>
      setTimeout(() => {
        void loadProjectChatState(projectId, { preserveLocal: true, silent: true })
      }, delay),
    )
  }

  function appendStreamingMessage(projectId: string, detail: ProjectWorkflowEvent['event'], createdAt: string) {
    if (!detail) return
    const delta = detail.type === 'assistant_delta'
      ? detail.delta ?? detail.content ?? detail.text ?? detail.message ?? ''
      : ''
    if (detail.type === 'assistant_delta' && !delta) return

    updateChatSession(projectId, session => {
      const nextMessages = upsertStreamingAssistantMessage(session.chatState.messages, {
        messageId: detail.messageId,
        agentId: detail.senderId ?? detail.agentId,
        turnId: detail.turnId,
        delta,
        createdAt,
      })
      return {
        ...session,
        chatState: createChatStateView({ ...session.chatState, messages: nextMessages }),
      }
    })
  }

  function appendWorkflowEventToTimeline(projectId: string, eventType: ProjectWorkflowStreamEvent, rawData: string | null, parsedDetail?: ProjectWorkflowEvent['event']) {
    const createdAt = new Date().toISOString()
    let payload: Record<string, unknown> = {}

    if (rawData) {
      try {
        payload = JSON.parse(rawData) as Record<string, unknown>
      } catch {
        payload = { summary: rawData }
      }
    }

    const detailPayload = (payload.event && typeof payload.event === 'object' ? payload.event : payload) as Record<string, unknown>
    const eventDetail = {
      ...detailPayload,
      type: typeof detailPayload.type === 'string' ? detailPayload.type : eventType === 'workflow_event' ? undefined : eventType,
    } as ProjectWorkflowEvent['event']

    const detail = parsedDetail ?? eventDetail

    if (!detail?.type || detail.type === 'assistant_delta') return

    updateChatSession(projectId, session => {
      const workflowEvent: ProjectWorkflowEvent = {
        id: typeof payload.id === 'string' ? payload.id : `stream-event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined,
        conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : session.chatState.conversationId,
        event: detail,
        createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : createdAt,
      }
      const step = mapWorkflowEventToStep(workflowEvent)
      if (!step) return session

      const nextGroups = appendProcessStepToGroups(session.chatState.processGroups, detail.turnId ?? 'local-streaming-turn', step, {
        createdAt: workflowEvent.createdAt,
      })
      return {
        ...session,
        chatState: createChatStateView({ ...session.chatState, processGroups: nextGroups }),
      }
    })
  }

  function handleProjectChatStreamEvent(projectId: string, eventType: ProjectStreamEvent, rawData: string | null, onWorkflowFinished?: () => void) {
    const detail = parseStreamPayload(rawData, eventType)
    if (!detail?.type) return

    if (detail.type === 'assistant_message_started' || detail.type === 'assistant_delta') {
      appendStreamingMessage(projectId, detail, new Date().toISOString())
    }

    if (STREAM_WORKFLOW_EVENT_NAME_SET.has(detail.type)) {
      appendWorkflowEventToTimeline(projectId, detail.type as ProjectWorkflowStreamEvent, rawData, detail)
    }

    if (detail.type === 'workflow_finished') {
      onWorkflowFinished?.()
    }
  }

  function finishProjectChatStream(projectId: string) {
    streamRefsByProject.current[projectId]?.close()
    streamRefsByProject.current[projectId] = undefined
    updateChatSession(projectId, session => ({
      ...session,
      streaming: false,
    }))
    void loadProjectChatState(projectId, { preserveLocal: true, silent: true })
    scheduleProjectChatSync(projectId)
  }

  function sendProjectChatMessage(input: SendProjectChatMessageInput) {
    const projectId = input.projectId
    const content = input.content.trim()
    if (!content) return
    if (streamRefsByProject.current[projectId]) return

    const now = new Date().toISOString()
    const optimisticMessage: ChatMessageView = {
      id: `local-chat-${Date.now()}`,
      sender: 'user',
      text: content,
      time: formatChatMessageTime(now),
      createdAt: now,
      replyTo: input.replyTo,
    }
    const sentProcessStep: ChatProcessStep = {
      id: `local-process-${Date.now()}`,
      icon: 'progress-clock',
      title: '消息已发送',
      summary: '正在等待后端流式响应',
      time: formatMessageTime(now),
      tone: 'running',
    }

    updateChatSession(projectId, session => {
      const nextMessages = [...session.chatState.messages, optimisticMessage]
      const nextGroups = appendProcessStepToGroups(session.chatState.processGroups, 'local-streaming-turn', sentProcessStep, {
        local: true,
        createdAt: now,
      })
      return {
        ...session,
        chatState: createChatStateView({ ...session.chatState, messages: nextMessages, processGroups: nextGroups }),
        streaming: true,
        error: '',
        lastFailedMessage: null,
      }
    })

    const body: StreamProjectMessageInput = {
      conversationId: input.conversationId,
      content,
      agentId: input.agentId,
      replyTo: input.replyTo,
    }

    let finalized = false
    const finishStream = () => {
      if (finalized) return
      finalized = true
      finishProjectChatStream(projectId)
    }

    streamRefsByProject.current[projectId] = streamProjectMessage(projectId, body, {
      onEvent: ({ eventType, rawData }) => {
        handleProjectChatStreamEvent(projectId, eventType, rawData, finishStream)
      },
      onError: error => {
        updateChatSession(projectId, session => ({
          ...session,
          error: error.message,
          lastFailedMessage: { content, agentId: input.agentId, replyTo: input.replyTo },
        }))
        finishStream()
      },
      onClose: () => {
        finishStream()
      },
    })
  }

  async function openActiveWorkspaceAgents() {
    const projectId = activeWorkspace.projectId ?? activeWorkspace.id
    setAgentEntryMode('workspace')
    setActiveTab('agents')
    setAgentRegistryLoading(true)
    setAgentRegistryWorkspaceId(projectId)
    setWorkspaceAgentRegistry([])

    try {
      const nextAgents = await fetchProjectAgents(projectId)
      setWorkspaceAgentRegistry(nextAgents)
    } catch (error) {
      const message = error instanceof Error ? error.message : '当前工作区 Agent 加载失败。'
      showBackendRetryDialog({
        title: 'Agent 加载失败',
        message: '无法从当前工作区接口读取 Agent，请稍后重试。',
        detail: message,
        onRetry: () => {
          void openActiveWorkspaceAgents()
        },
      })
    } finally {
      setAgentRegistryLoading(false)
    }
  }

  async function handleUpdateWorkspaceMetadata(workspace: Workspace, input: { pinned?: boolean; archived?: boolean }) {
    const projectId = workspace.projectId ?? workspace.id

    try {
      await updateWorkspaceMetadata(projectId, input)
      await loadWorkbenchPage()
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新工作区状态失败。'
      showBackendRetryDialog({
        title: '工作区状态更新失败',
        message: '后端暂时没有成功更新，请点击重试。',
        detail: message,
        onRetry: () => {
          void handleUpdateWorkspaceMetadata(workspace, input)
        },
      })
    }
  }

  function refreshWorkbenchInBackground() {
    void loadWorkbenchPage({
      query: workspaceQuery,
      filters: workbenchFilters,
      silent: true,
    })
  }

  async function refreshWorkbenchNow() {
    if (workbenchRefreshing) return
    setWorkbenchRefreshing(true)
    try {
      await loadWorkbenchPage({
        query: workspaceQuery,
        filters: workbenchFilters,
        silent: true,
      })
    } finally {
      setWorkbenchRefreshing(false)
    }
  }

  async function handleToggleWorkspacePin(workspace: Workspace) {
    const projectId = workspace.projectId ?? workspace.id
    const workspaceId = getWorkspaceKey(workspace)
    const nextPinned = !workspace.pinned

    if (workspaceActionState) return
    setWorkspaceActionState({ workspaceId, action: 'pin' })

    try {
      await (workspace.pinned ? unpinWorkspace(projectId) : pinWorkspace(projectId))
      setWorkspaceList(current => {
        const nextList = current.map(item => getWorkspaceKey(item) === workspaceId ? { ...item, pinned: nextPinned } : item)
        return nextPinned
          ? [
              ...nextList.filter(item => getWorkspaceKey(item) === workspaceId),
              ...nextList.filter(item => getWorkspaceKey(item) !== workspaceId),
            ]
          : nextList
      })
      setWorkspaceActionState(null)
      refreshWorkbenchInBackground()
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新工作区置顶状态失败。'
      showBackendRetryDialog({
        title: '工作区置顶状态更新失败',
        message: '后端暂时没有成功更新置顶状态，请点击重试。',
        detail: message,
        onRetry: () => {
          void handleToggleWorkspacePin(workspace)
        },
      })
    } finally {
      setWorkspaceActionState(null)
    }
  }

  async function handleToggleWorkspaceArchive(workspace: Workspace) {
    const projectId = workspace.projectId ?? workspace.id
    const workspaceId = getWorkspaceKey(workspace)
    const nextArchived = !workspace.archived

    if (workspaceActionState) return
    setWorkspaceActionState({ workspaceId, action: 'archive' })

    try {
      await (workspace.archived ? unarchiveWorkspace(projectId) : archiveWorkspace(projectId))
      setWorkspaceList(current => current.flatMap(item => {
        if (getWorkspaceKey(item) !== workspaceId) return [item]
        const nextWorkspace = { ...item, archived: nextArchived }
        if (workbenchFilters.status === 'active' && nextArchived) return []
        if (workbenchFilters.status === 'archived' && !nextArchived) return []
        return [nextWorkspace]
      }))
      setWorkspaceActionState(null)
      refreshWorkbenchInBackground()
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新工作区归档状态失败。'
      showBackendRetryDialog({
        title: '工作区归档状态更新失败',
        message: '后端暂时没有成功更新归档状态，请点击重试。',
        detail: message,
        onRetry: () => {
          void handleToggleWorkspaceArchive(workspace)
        },
      })
    } finally {
      setWorkspaceActionState(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function checkBackend() {
      setBackendStatus('checking')
      setBackendErrorMessage('')

      try {
        const health = await fetchBusinessHealth()
        if (cancelled) {
          return
        }

        if (health.ok) {
          setBackendStatus('ready')
          return
        }

        setBackendStatus('unavailable')
        setBackendErrorMessage('后端暂时没有返回可用状态。')
        showBackendRetryDialog({
          title: '工作台暂时不可用',
          message: '后端已经响应，但当前没有返回可用状态。请稍后重试。',
          detail: BUSINESS_API_BASE_URL,
          onRetry: retryBackendHealth,
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        setBackendStatus('unavailable')
        const message = error instanceof Error ? error.message : '无法连接业务后端。'
        setBackendErrorMessage(message)
        showBackendRetryDialog({
          title: '连接后端失败',
          message: '可能是网络波动或服务正在启动。请稍后重试。',
          detail: message,
          onRetry: retryBackendHealth,
        })
      }
    }

    void checkBackend()

    return () => {
      cancelled = true
    }
  }, [retryCount])

  useEffect(() => {
    if (backendStatus !== 'ready') return
    const timeoutId = setTimeout(() => {
      void loadWorkbenchPage({
        query: workspaceQuery,
        filters: workbenchFilters,
      })
    }, 260)

    return () => clearTimeout(timeoutId)
  }, [backendStatus, workspaceQuery, workbenchFilters])

  useEffect(() => {
    chatSessionsByProjectRef.current = chatSessionsByProject
  }, [chatSessionsByProject])

  useEffect(() => {
    if (backendStatus !== 'ready') return
    const session = chatSessionsByProject[currentAgentProjectId]
    if (session?.loaded || session?.loading) return
    void loadProjectChatState(currentAgentProjectId)
  }, [backendStatus, currentAgentProjectId])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') return

      Object.entries(chatSessionsByProjectRef.current).forEach(([projectId, session]) => {
        if (session.streaming || hasLocalPendingChatState(session.chatState)) {
          void loadProjectChatState(projectId, { preserveLocal: true, silent: true })
        }
      })
    })

    return () => {
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    return () => {
      Object.values(streamRefsByProject.current).forEach(stream => stream?.close())
      Object.values(chatSyncTimersRef.current).forEach(timers => timers.forEach(timer => clearTimeout(timer)))
    }
  }, [])

  return (
    <SafeAreaProvider>
      <ImageBackground source={background} style={styles.shell} resizeMode="cover">
        <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.08)', 'rgba(241,245,249,0.26)']} style={styles.overlay} />
        <SafeAreaView style={styles.safe}>
          <StatusBar style="dark" />
          {backendStatus !== 'ready' ? (
            <BackendGate
              status={backendStatus}
              errorMessage={backendErrorMessage}
              layoutTier={layoutTier}
              mobileScale={mobileScale}
              onRetry={retryBackendHealth}
            />
          ) : (
            <>
          <View style={[styles.header, activeTab === 'agents' && styles.agentHeader, activeTab === 'chat' && styles.codeHeader]}>
            <View style={[styles.headerLeft, activeTab === 'agents' && styles.agentHeaderLeft, activeTab === 'chat' && styles.codeHeaderLeft, tightChatHeader && styles.chatHeaderLeftTight]}>
              <Pressable
                style={[styles.headerAvatarButton, isWorkspaceAgentPage && styles.headerBackButton]}
                onPress={() => {
                  if (isWorkspaceAgentPage) {
                    setActiveTab('chat')
                    return
                  }
                  setAppMenuOpen(true)
                }}
              >
                {isWorkspaceAgentPage ? (
                  <MaterialCommunityIcons name="chevron-left" size={mobileScale.headerIcon + 6} color="#0f172a" />
                ) : (
                  <AgentGlyph agentId="orchestrator" size={mobileScale.headerAvatar} />
                )}
              </Pressable>
              <View style={styles.headerCopy}>
                {activeTab === 'chat' || isWorkspaceAgentPage ? null : <Text style={styles.eyebrow}>AGENTHUB</Text>}
                <Text style={[styles.headerTitle, { fontSize: mobileScale.pageTitle }, activeTab === 'chat' && styles.chatHeaderTitle, activeTab === 'chat' && { fontSize: mobileScale.chatTitle }]} numberOfLines={1}>
                  {activeTab === 'chat' ? activeWorkspace.name : title}
                </Text>
                {activeTab === 'chat' ? (
                  <View style={styles.chatSubtitleRow}>
                    <View style={styles.chatLiveDot} />
                    <Text style={styles.codeSubtitle} numberOfLines={1}>群聊 · 3 个 Agent 协作中</Text>
                  </View>
                ) : null}
                {activeTab === 'chat' && tightChatHeader ? (
                  <View style={styles.chatStreamingRow}>
                    <GlassCard compact style={styles.streamingPill}>
                      <MaterialCommunityIcons name="chart-timeline-variant-shimmer" size={14} color="#10b981" />
                      <Text style={[styles.streamingText, { fontSize: mobileScale.labelText }]}>streaming</Text>
                    </GlassCard>
                  </View>
                ) : null}
              </View>
            </View>
            {activeTab === 'chat' ? (
              <View style={styles.chatHeaderActions}>
                <GlassCard compact style={[styles.codeHeaderButton, styles.chatAgentManageButton]}>
                  <Pressable style={styles.headerButtonPressable} onPress={() => void openActiveWorkspaceAgents()}>
                    <MaterialCommunityIcons name="robot-outline" size={mobileScale.headerIcon - 2} color="#2563eb" />
                  </Pressable>
                </GlassCard>
              </View>
            ) : activeTab === 'workbench' ? (
              <View style={styles.workspaceHeaderActions}>
                <GlassCard compact style={styles.headerIconButton}>
                  <Pressable
                    style={styles.headerButtonPressable}
                    onPress={() => {
                      setWorkspacePanelMode('create')
                      setWorkspacePanelOpen(true)
                    }}
                  >
                    <MaterialCommunityIcons name="plus" size={mobileScale.headerIcon} color="#0f172a" />
                  </Pressable>
                </GlassCard>
              </View>
            ) : activeTab === 'agents' && canCreateAgent ? (
              <View style={styles.agentHeaderActions}>
                <GlassCard compact style={[styles.agentCreateButton, layoutTier === 'compact' && styles.agentCreateButtonCompact]}>
                  <Pressable style={styles.agentCreatePressable} onPress={() => setAgentCreateSignal(signal => signal + 1)}>
                    <MaterialCommunityIcons name="plus" size={mobileScale.headerIcon - 3} color="#0f172a" />
                    <Text style={styles.agentCreateText}>新建</Text>
                  </Pressable>
                </GlassCard>
              </View>
            ) : activeTab === 'agents' ? null : (
              <GlassCard compact style={styles.headerAction}>
                <View style={styles.bellWrap}>
                  <MaterialCommunityIcons name="bell-outline" size={20} color="#1f2937" />
                  <View style={styles.bellDot} />
                </View>
              </GlassCard>
            )}
          </View>

          {activeTab === 'chat' ? (
            <View style={styles.contentFill}>
              <ChatScreen
                workspace={activeWorkspace}
                layoutTier={layoutTier}
                mobileScale={mobileScale}
                chatSession={activeChatSession}
                onRefresh={() => void loadProjectChatState(currentAgentProjectId, { preserveLocal: true })}
                onSend={sendProjectChatMessage}
                onOpenWorkspacePanel={() => {
                  setWorkspacePanelMode('switch')
                  setWorkspacePanelOpen(true)
                }}
              />
            </View>
          ) : (
            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentInner}
              showsVerticalScrollIndicator={false}
              refreshControl={activeTab === 'workbench' ? (
                <RefreshControl
                  refreshing={workbenchRefreshing}
                  onRefresh={() => {
                    void refreshWorkbenchNow()
                  }}
                  tintColor="#2563eb"
                  colors={['#2563eb']}
                />
              ) : undefined}
            >
              {activeTab === 'workbench' ? (
                <WorkbenchScreen
                  workspaceList={workspaceList}
                  page={workbenchPage}
                  loading={workbenchLoading}
                  loadingMore={loadingMoreWorkspaces}
                  workspaceActionState={workspaceActionState}
                  agentList={workbenchAgentList}
                  workspace={activeWorkspace}
                  query={workspaceQuery}
                  statusFilter={workbenchFilters.status}
                  sortBy={workbenchFilters.sortBy}
                  sortDirection={workbenchFilters.sortDirection}
                  layoutTier={layoutTier}
                  mobileScale={mobileScale}
                  onQueryChange={setWorkspaceQuery}
                  onStatusFilterChange={status => {
                    applyWorkbenchFilters({ status })
                  }}
                  onSortByChange={nextSortBy => {
                    applyWorkbenchFilters({ sortBy: nextSortBy })
                  }}
                  onSortDirectionChange={direction => {
                    applyWorkbenchFilters({ sortDirection: direction })
                  }}
                  onLoadMore={() => {
                    if (!loadingMoreWorkspaces && workbenchPage.hasMore && workbenchPage.nextCursor) {
                      void loadWorkbenchPage({ cursor: workbenchPage.nextCursor, append: true, filters: workbenchFilters })
                    }
                  }}
                  onOpenWorkspace={nextWorkspace => {
                    setActiveWorkspaceId(nextWorkspace.id)
                    setActiveTab('chat')
                  }}
                  onToggleWorkspacePin={workspace => {
                    void handleToggleWorkspacePin(workspace)
                  }}
                  onToggleWorkspaceArchive={workspace => {
                    void handleToggleWorkspaceArchive(workspace)
                  }}
                />
              ) : null}
              {activeTab === 'agents' ? (
                <AgentScreen
                  layoutTier={layoutTier}
                  mobileScale={mobileScale}
                  createSignal={agentCreateSignal}
                  registryTitle={agentRegistryTitle}
                  canCreate={canCreateAgent}
                  workspace={activeWorkspace}
                  projectAgents={agentScreenProjectAgents}
                  loading={isWorkspaceAgentPage && agentRegistryLoading}
                  onShowError={showBackendRetryDialog}
                />
              ) : null}
            </ScrollView>
          )}

          <AppMenuDrawer
            visible={appMenuOpen}
            activeTab={activeTab}
            mobileScale={mobileScale}
            onClose={() => setAppMenuOpen(false)}
            onChange={nextTab => {
              if (nextTab === 'agents') {
                setAgentEntryMode('global')
              }
              setActiveTab(nextTab)
              setAppMenuOpen(false)
            }}
          />
          <WorkspacePanelModal
            visible={workspacePanelOpen}
            mode={workspacePanelMode}
            workspaceList={workspaceList}
            activeWorkspaceId={activeWorkspace.id}
            layoutTier={layoutTier}
            creating={creatingWorkspace}
            onClose={() => setWorkspacePanelOpen(false)}
            onSwitch={nextWorkspace => {
              setActiveWorkspaceId(nextWorkspace.id)
              setWorkspacePanelOpen(false)
              setActiveTab('chat')
            }}
            onCreate={input => void handleCreateWorkspace(input)}
          />
          <ActivityCenterModal visible={activityOpen} onClose={() => setActivityOpen(false)} />
            </>
          )}
          <BackendRetryDialog
            visible={backendRetryDialog.visible}
            title={backendRetryDialog.title}
            message={backendRetryDialog.message}
            detail={backendRetryDialog.detail}
            retrying={backendStatus === 'checking' || backendRetryDialog.retrying}
            onRetry={() => {
              hideBackendRetryDialog()
              backendRetryDialog.onRetry()
            }}
            onClose={hideBackendRetryDialog}
          />
        </SafeAreaView>
      </ImageBackground>
    </SafeAreaProvider>
  )
}

type WorkspaceFilter = 'active' | 'updated' | 'pinned' | 'archived'
type WorkbenchFocus = 'workspaces' | 'running' | 'artifacts'
type WorkspaceDropdownKey = 'status' | 'sortBy' | 'sortDirection'
type AgentFilter = 'all' | 'running' | 'reviewing' | 'idle' | 'builtin'
type ArtifactStatus = 'generating' | 'partial' | 'ready' | 'failed'
type ArtifactKind = 'preview' | 'diff' | 'review' | 'zip' | 'deploy' | 'text' | 'artifact'
type DeliverySurface = 'build' | 'deployment'

type ArtifactView = Omit<Artifact, 'type' | 'icon'> & {
  type: ArtifactKind
  icon: IconName
  status: ArtifactStatus
  statusLabel: string
  createdAt?: string
  turnId?: string
  agentId?: string
  url?: string
  deliverySurface?: DeliverySurface
  verdict?: string
  issues?: string[]
  detailText?: string
  patch?: string
  files?: ProjectChangedFile[]
  fileCount?: number
  byteLength?: number
  changeSetId?: string
  source?: 'artifact' | 'changeSet' | 'review' | 'delivery'
}

function BackendGate({
  status,
  errorMessage,
  layoutTier,
  mobileScale,
  onRetry,
}: {
  status: BackendStatus
  errorMessage: string
  layoutTier: LayoutTier
  mobileScale: MobileScale
  onRetry: () => void
}) {
  const checking = status === 'checking'
  const isCompact = layoutTier === 'compact'

  return (
    <View style={[styles.backendGate, isCompact && styles.backendGateCompact]}>
      <GlassCard style={[styles.backendGateCard, isCompact && styles.backendGateCardCompact]}>
        <View style={styles.backendGateIconWrap}>
          <MaterialCommunityIcons
            name={checking ? 'cloud-sync-outline' : 'cloud-alert-outline'}
            size={isCompact ? 34 : 42}
            color={checking ? '#2563eb' : '#dc2626'}
          />
        </View>
        <Text style={[styles.backendGateTitle, { fontSize: mobileScale.heroTitle }]}>
          {checking ? '正在连接工作台' : '暂时连接不上工作台'}
        </Text>
        <Text style={[styles.backendGateBody, { fontSize: mobileScale.bodyText, lineHeight: mobileScale.bodyLineHeight }]}>
          {checking
            ? '我们正在确认业务后端是否可用，马上就好。'
            : '可能是网络波动或服务正在启动。请稍后重试，已有内容不会丢失。'}
        </Text>
        <View style={styles.backendEndpointPill}>
          <MaterialCommunityIcons name="server-network" size={16} color="#2563eb" />
          <Text style={styles.backendEndpointText} numberOfLines={1}>{BUSINESS_API_BASE_URL}</Text>
        </View>
        {!checking ? (
          <>
            {errorMessage ? <Text style={styles.backendGateError} numberOfLines={2}>{errorMessage}</Text> : null}
            <Pressable style={styles.backendRetryButton} onPress={onRetry}>
              <MaterialCommunityIcons name="refresh" size={20} color="#fff" />
              <Text style={styles.backendRetryText}>重试连接</Text>
            </Pressable>
          </>
        ) : null}
      </GlassCard>
    </View>
  )
}

function BackendRetryDialog({
  visible,
  title,
  message,
  detail,
  retrying = false,
  onRetry,
  onClose,
}: {
  visible: boolean
  title: string
  message: string
  detail?: string
  retrying?: boolean
  onRetry: () => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backendDialogBackdrop}>
        <Pressable style={styles.backendDialogScrim} onPress={onClose} />
        <GlassCard style={styles.backendDialogCard}>
          <View style={styles.backendDialogIconWrap}>
            <MaterialCommunityIcons name="server-network-off" size={30} color="#dc2626" />
          </View>
          <Text style={styles.backendDialogTitle}>{title}</Text>
          <Text style={styles.backendDialogBody}>{message}</Text>
          {detail ? <Text style={styles.backendDialogDetail} numberOfLines={3}>{detail}</Text> : null}
          <View style={styles.backendDialogActions}>
            <Pressable style={styles.backendDialogSecondaryButton} onPress={onClose}>
              <Text style={styles.backendDialogSecondaryText}>稍后再说</Text>
            </Pressable>
            <Pressable style={[styles.backendDialogPrimaryButton, retrying && styles.backendDialogPrimaryButtonDisabled]} onPress={onRetry} disabled={retrying}>
              <MaterialCommunityIcons name="refresh" size={18} color="#fff" />
              <Text style={styles.backendDialogPrimaryText}>{retrying ? '重试中' : '重试'}</Text>
            </Pressable>
          </View>
        </GlassCard>
      </View>
    </Modal>
  )
}

function WorkspaceFilterDropdown<T extends string>({
  label,
  open,
  options,
  onToggle,
  onSelect,
}: {
  label: string
  open: boolean
  options: { value: T; label: string }[]
  onToggle: () => void
  onSelect: (value: T) => void
}) {
  return (
    <View style={styles.workspaceDropdownWrap}>
      <Pressable style={[styles.workspaceDropdownButton, open && styles.workspaceDropdownButtonOpen]} onPress={onToggle}>
        <Text style={styles.workspaceDropdownText} numberOfLines={1}>{label}</Text>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={17} color="#475569" />
      </Pressable>
      {open ? (
        <GlassCard style={styles.workspaceDropdownMenu}>
          {options.map(option => (
            <Pressable key={option.value} style={styles.workspaceDropdownOption} onPress={() => onSelect(option.value)}>
              <Text style={styles.workspaceDropdownOptionText}>{option.label}</Text>
            </Pressable>
          ))}
        </GlassCard>
      ) : null}
    </View>
  )
}

function WorkbenchScreen({
  workspaceList,
  page,
  loading,
  loadingMore,
  workspaceActionState,
  agentList,
  workspace,
  query,
  statusFilter,
  sortBy,
  sortDirection,
  layoutTier,
  mobileScale,
  onQueryChange,
  onStatusFilterChange,
  onSortByChange,
  onSortDirectionChange,
  onLoadMore,
  onOpenWorkspace,
  onToggleWorkspacePin,
  onToggleWorkspaceArchive,
}: {
  workspaceList: Workspace[]
  page: WorkbenchPageState
  loading: boolean
  loadingMore: boolean
  workspaceActionState: WorkspaceActionState
  agentList: ProjectAgent[]
  workspace: Workspace
  query: string
  statusFilter: WorkspaceListStatus
  sortBy: WorkspaceSortField
  sortDirection: SortDirection
  layoutTier: LayoutTier
  mobileScale: MobileScale
  onQueryChange: (query: string) => void
  onStatusFilterChange: (status: WorkspaceListStatus) => void
  onSortByChange: (sortBy: WorkspaceSortField) => void
  onSortDirectionChange: (direction: SortDirection) => void
  onLoadMore: () => void
  onOpenWorkspace: (workspace: Workspace) => void
  onToggleWorkspacePin: (workspace: Workspace) => void
  onToggleWorkspaceArchive: (workspace: Workspace) => void
}) {
  const isCompact = layoutTier === 'compact'
  const [focus, setFocus] = useState<WorkbenchFocus>('workspaces')
  const [openDropdown, setOpenDropdown] = useState<WorkspaceDropdownKey | null>(null)
  const activeWorkspaceAgents = getVisibleChatAgents(workspace, agentList)
  const anyWorkspaceActionBusy = Boolean(workspaceActionState)
  const locallyMatchedWorkspaces = workspaceList.filter(item => workspaceMatchesQuery(item, query))
  const runningAgents = workspaceList.reduce((sum, item) => sum + item.runningAgents, 0)
  const focusedWorkspaces = locallyMatchedWorkspaces.filter(item => {
    if (focus === 'running') return item.runningAgents > 0 || item.status === 'running'
    if (focus === 'artifacts') return item.artifactCount > 0
    return true
  })
  const loadedWorkspaceCount = new Set(workspaceList.map(getWorkspaceKey)).size
  const focusTitle = focus === 'workspaces' ? '工作区' : focus === 'running' ? '进行中的项目' : '产物相关项目'
  const listTitle =
    focus === 'running'
      ? '进行中的工作区'
      : focus === 'artifacts'
        ? '有产物的工作区'
        : statusFilter === 'archived'
          ? '归档工作区'
          : '工作区'
  const sortText = `${sortBy === 'updatedAt' ? '更新' : sortBy === 'createdAt' ? '创建' : '名称'} ${sortDirection === 'desc' ? '降序' : '升序'}`
  const statusOptions: { value: WorkspaceListStatus; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archived' },
    { value: 'all', label: 'All' },
  ]
  const sortByOptions: { value: WorkspaceSortField; label: string }[] = [
    { value: 'updatedAt', label: 'Updated' },
    { value: 'createdAt', label: 'Created' },
    { value: 'name', label: 'Name' },
  ]
  const sortDirectionOptions: { value: SortDirection; label: string }[] = [
    { value: 'desc', label: 'Desc' },
    { value: 'asc', label: 'Asc' },
  ]

  return (
    <View style={[styles.workbenchScreen, isCompact && styles.workspaceScreenCompact]}>
      <Pressable onPress={() => onOpenWorkspace(workspace)}>
        <GlassCard style={styles.homeWorkspaceCard}>
        <View style={styles.homeWorkspaceHead}>
          <View style={styles.workbenchActiveCopy}>
            <Text style={styles.homeWorkspaceEyebrow}>ACTIVE WORKSPACE</Text>
            <Text style={[styles.homeWorkspaceTitle, { fontSize: mobileScale.heroTitle }]} numberOfLines={1}>{workspace.name}</Text>
          </View>
          <View style={styles.workbenchIconWrap}>
            <AnimatedHomeIcon size={mobileScale.workspaceHeroIcon} />
          </View>
        </View>
        <Text style={[styles.homeWorkspaceDesc, { fontSize: mobileScale.bodyText, lineHeight: mobileScale.bodyLineHeight }]} numberOfLines={2}>{workspace.goal}</Text>
        <View style={styles.homeWorkspaceMetaRow}>
          <View style={styles.homeStatusPill}>
            <MaterialCommunityIcons name="waveform" size={16} color="#2563eb" />
            <Text style={styles.homeStatusText}>running</Text>
          </View>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextBlue}>{workspace.kind === 'group' ? '群聊工作区' : '单聊工作区'}</Text>
          </View>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextGreen}>{workspace.artifactCount} 产物</Text>
          </View>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextGray}>{workspace.messageCount} 消息</Text>
          </View>
        </View>
        <View style={styles.homeAvatarRow}>
          {activeWorkspaceAgents.slice(0, 4).map((agent, index) => (
            <View key={getProjectAgentInstanceKey(agent, index)} style={{ marginLeft: index === 0 ? 0 : -10 }}>
              <AgentGlyph agentId={agent.id} label={agent.name} provider={agent.modelProvider} color={getProjectAgentColor(agent)} size={mobileScale.workspaceAgentAvatar} />
            </View>
          ))}
          <Text style={styles.homeAvatarText}>{workspace.latestEventLabel}</Text>
        </View>
          <View style={styles.activeWorkspaceEnterRow}>
            <Text style={styles.activeWorkspaceEnterText}>进入对应对话</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#2563eb" />
          </View>
        </GlassCard>
      </Pressable>

      <Pressable
        style={[styles.workspaceSummaryRow, focus === 'workspaces' && styles.workspaceSummaryRowActive]}
        onPress={() => {
          setFocus('workspaces')
        }}
      >
        <View style={styles.workspaceSummaryIcon}>
          <MaterialCommunityIcons name="view-grid-outline" size={21} color="#2563eb" />
        </View>
        <Text style={styles.workspaceSummaryTitle}>工作区</Text>
        <Text style={styles.workspaceSummaryCount}>{page.total}</Text>
      </Pressable>

      <GlassCard style={styles.searchCard}>
        <MaterialCommunityIcons name="magnify" size={24} color="#64748b" />
        <TextInput
          placeholder="搜索工作区"
          placeholderTextColor="#94a3b8"
          value={query}
          onChangeText={onQueryChange}
          style={styles.searchInput}
        />
      </GlassCard>
      <View style={styles.workspaceDropdownLine}>
        <WorkspaceFilterDropdown
          label={statusOptions.find(item => item.value === statusFilter)?.label ?? 'Active'}
          open={openDropdown === 'status'}
          options={statusOptions}
          onToggle={() => setOpenDropdown(current => current === 'status' ? null : 'status')}
          onSelect={value => {
            onStatusFilterChange(value)
            setOpenDropdown(null)
          }}
        />
        <WorkspaceFilterDropdown
          label={sortByOptions.find(item => item.value === sortBy)?.label ?? 'Updated'}
          open={openDropdown === 'sortBy'}
          options={sortByOptions}
          onToggle={() => setOpenDropdown(current => current === 'sortBy' ? null : 'sortBy')}
          onSelect={value => {
            onSortByChange(value)
            setOpenDropdown(null)
          }}
        />
        <WorkspaceFilterDropdown
          label={sortDirectionOptions.find(item => item.value === sortDirection)?.label ?? 'Desc'}
          open={openDropdown === 'sortDirection'}
          options={sortDirectionOptions}
          onToggle={() => setOpenDropdown(current => current === 'sortDirection' ? null : 'sortDirection')}
          onSelect={value => {
            onSortDirectionChange(value)
            setOpenDropdown(null)
          }}
        />
      </View>
      {loading ? (
        <GlassCard style={styles.workbenchListLoadingCard}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.workbenchListLoadingTitle}>正在加载工作区</Text>
          <Text style={styles.workbenchListLoadingText}>筛选结果准备好后再显示列表</Text>
        </GlassCard>
      ) : (
        <>

      <View style={styles.workbenchSectionHead}>
        <Text style={[styles.homeSectionTitle, { fontSize: mobileScale.sectionTitle }]}>{listTitle}</Text>
        <Text style={styles.workbenchSectionMeta}>{sortText}</Text>
      </View>
      {focusedWorkspaces.map((item, index) => (
        <WorkspaceCard
          key={`${getWorkspaceKey(item)}-${index}`}
          workspace={item}
          agentList={agentList}
          layoutTier={layoutTier}
          mobileScale={mobileScale}
          pinBusy={workspaceActionState?.workspaceId === getWorkspaceKey(item) && workspaceActionState.action === 'pin'}
          archiveBusy={workspaceActionState?.workspaceId === getWorkspaceKey(item) && workspaceActionState.action === 'archive'}
          actionsDisabled={anyWorkspaceActionBusy}
          onPress={() => onOpenWorkspace(item)}
          onTogglePin={() => onToggleWorkspacePin(item)}
          onToggleArchive={() => onToggleWorkspaceArchive(item)}
        />
      ))}

      {!loading && focusedWorkspaces.length === 0 ? (
        <GlassCard style={styles.emptyStateCard}>
          <MaterialCommunityIcons name="database-search-outline" size={28} color="#64748b" />
          <Text style={styles.cardTitle}>没有匹配的工作区</Text>
          <Text style={styles.bodyText}>换一个关键词或筛选条件试试。</Text>
        </GlassCard>
      ) : null}

      <Pressable style={[styles.loadMoreButton, (!page.hasMore || loadingMore) && styles.loadMoreButtonDisabled]} onPress={onLoadMore} disabled={!page.hasMore || loadingMore}>
        <Text style={styles.loadMoreText}>{loadingMore ? '加载中' : page.hasMore ? `已显示 ${loadedWorkspaceCount} / ${page.total} 个，查看更多` : `已显示全部 ${page.total} 个工作区`}</Text>
        <MaterialCommunityIcons name={loadingMore ? 'progress-clock' : 'chevron-down'} size={18} color="#64748b" />
      </Pressable>
        </>
      )}
    </View>
  )

  return (
    <View style={[styles.homeScreen, isCompact && styles.homeScreenCompact]}>
      <View style={styles.homeGreetingRow}>
        <View style={styles.homeGreetingText}>
          <Text style={styles.homeGreeting}>Hi, Susanna</Text>
          <Text style={styles.homeGreetingSub}>很高兴为您服务</Text>
        </View>
        <View style={styles.homeHeroOrb}>
          <AnimatedHomeIcon size={isCompact ? 112 : layoutTier === 'standard' ? 132 : 146} />
        </View>
      </View>

      <View style={styles.homeStatGrid}>
        <StatCard label="工作区" value={String(workspaces.length)} icon="view-grid-outline" tone="#2563eb" />
        <StatCard label="运行中" value={String(runningAgents)} icon="lightning-bolt-outline" tone="#db2777" />
        <StatCard label="产物" value={String(artifacts.length)} icon="package-variant-closed" tone="#059669" />
      </View>

      <Text style={styles.homeSectionTitle}>全部功能</Text>
      <View style={styles.homeFeatureGrid}>
        <Feature icon="message-processing-outline" label="群聊协作" />
        <Feature icon="robot-outline" label="Agent 管理" />
        <Feature icon="code-braces" label="代码文件" />
        <Feature icon="cellphone-screenshot" label="预览产物" />
        <Feature icon="source-branch" label="Diff 摘要" />
        <Feature icon="shield-check-outline" label="审查结论" />
      </View>

      <GlassCard style={styles.homeWorkspaceCard}>
        <View style={styles.homeWorkspaceHead}>
          <View>
            <Text style={styles.homeWorkspaceEyebrow}>ACTIVE WORKSPACE</Text>
            <Text style={[styles.homeWorkspaceTitle, { fontSize: mobileScale.heroTitle }]} numberOfLines={1}>{workspace.name}</Text>
          </View>
          <View style={styles.homeStatusPill}>
            <MaterialCommunityIcons name="waveform" size={16} color="#2563eb" />
            <Text style={styles.homeStatusText}>running</Text>
          </View>
        </View>
        <Text style={[styles.homeWorkspaceDesc, { fontSize: mobileScale.bodyText, lineHeight: mobileScale.bodyLineHeight }]} numberOfLines={2}>{workspace.goal}</Text>
        <View style={styles.homeWorkspaceMetaRow}>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextBlue}>{workspace.type}</Text>
          </View>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextGreen}>{workspace.artifactCount} 产物</Text>
          </View>
          <View style={styles.homeMetaChip}>
            <Text style={styles.homeMetaTextGray}>{workspace.messageCount} 消息</Text>
          </View>
        </View>
        <View style={styles.homeAvatarRow}>
          {workspace.agents.slice(0, 4).map((agentId, index) => (
            <View key={agentId} style={{ marginLeft: index === 0 ? 0 : -10 }}>
              <AgentGlyph agentId={agentId} size={36} />
            </View>
          ))}
          <Text style={styles.homeAvatarText}>{workspace.latestEventLabel}</Text>
        </View>
      </GlassCard>
    </View>
  )
}

function WorkspaceScreen({ layoutTier }: { layoutTier: LayoutTier }) {
  const isCompact = layoutTier === 'compact'
  const { width } = useWindowDimensions()
  const mobileScale = useMemo(() => createMobileScale(layoutTier, width), [layoutTier, width])
  return (
    <View style={[styles.workspaceScreen, isCompact && styles.workspaceScreenCompact]}>
      <GlassCard style={styles.searchCard}>
        <MaterialCommunityIcons name="magnify" size={24} color="#64748b" />
        <TextInput placeholder="搜索工作区" placeholderTextColor="#94a3b8" style={styles.searchInput} />
      </GlassCard>
      <View style={styles.workspaceFilterLine}>
        <Pill label="Active" tone="blue" icon="check-circle-outline" />
        <Pill label="Updated" tone="muted" icon="sort-clock-descending-outline" />
        <Pill label="Pinned first" tone="amber" icon="pin-outline" />
        <Pill label="归档" tone="muted" icon="archive-outline" />
      </View>
      {workspaces.slice(0, 3).map(workspace => (
        <WorkspaceCard key={workspace.id} workspace={workspace} layoutTier={layoutTier} mobileScale={mobileScale} />
      ))}
      <Pressable style={styles.loadMoreButton}>
        <Text style={styles.loadMoreText}>加载更多工作区</Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
      </Pressable>
    </View>
  )
}

function ChatScreen({
  workspace,
  layoutTier,
  mobileScale,
  chatSession,
  onRefresh,
  onSend,
  onOpenWorkspacePanel,
}: {
  workspace: Workspace
  layoutTier: LayoutTier
  mobileScale: MobileScale
  chatSession: ChatProjectSession
  onRefresh: () => void
  onSend: (input: SendProjectChatMessageInput) => void
  onOpenWorkspacePanel: () => void
}) {
  const isCompact = layoutTier === 'compact'
  const isStandard = layoutTier === 'standard'
  const isWide = layoutTier === 'wide'
  const insets = useSafeAreaInsets()
  const keyboardBottomSpacing = useKeyboardBottomSpacing(insets.bottom)
  const keyboardOffset = 0
  const composerBottomSpacing = Platform.OS === 'ios' ? keyboardBottomSpacing : 0
  const composerSafePadding = Platform.OS === 'ios' ? Math.max(insets.bottom, 10) : Platform.OS === 'android' ? Math.max(insets.bottom, 8) : 0
  const projectId = workspace.projectId ?? workspace.id
  const chatState = chatSession.chatState
  const chatLoading = chatSession.loading
  const chatError = chatSession.error
  const streaming = chatSession.streaming
  const lastFailedMessage = chatSession.lastFailedMessage
  const [draftMessage, setDraftMessage] = useState('')
  const [replyTarget, setReplyTarget] = useState<ChatReplyReference | undefined>()
  const [messageActionTarget, setMessageActionTarget] = useState<ChatMessageActionTarget | null>(null)
  const [copyToastText, setCopyToastText] = useState('')
  const [composerInputHeight, setComposerInputHeight] = useState(CHAT_COMPOSER_INPUT_MIN_HEIGHT)
  const [composerInputScrollable, setComposerInputScrollable] = useState(false)
  const scrollToBottomButtonBottom = composerSafePadding + Math.max(56, composerInputHeight + CHAT_COMPOSER_VERTICAL_PADDING * 2) + (replyTarget ? 58 : 0) + 12
  const [expandedProcessIds, setExpandedProcessIds] = useState<Set<string>>(() => new Set())
  const [draftSelection, setDraftSelection] = useState({ start: 0, end: 0 })
  const [selectedMentionAgentId, setSelectedMentionAgentId] = useState<string | undefined>()
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactView | null>(null)
  const chatScrollRef = useRef<ScrollView | null>(null)
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleChatAgents = getVisibleChatAgents(workspace, chatState.agents, chatState.conversationId)
  const activeMentionToken = workspace.kind === 'group' ? findActiveMentionToken(draftMessage, draftSelection.start) : null
  const mentionCandidates = useMemo(() => {
    if (workspace.kind !== 'group' || !activeMentionToken) return []
    return visibleChatAgents
      .filter(agent => projectAgentMatchesMentionQuery(agent, activeMentionToken.query))
      .slice(0, 8)
  }, [activeMentionToken?.query, visibleChatAgents, workspace.kind])
  const composerDisabled = streaming || chatLoading
  const sendButtonDisabled = !draftMessage.trim() || composerDisabled
  const showMentionMenu = workspace.kind === 'group' && !composerDisabled && !!activeMentionToken && mentionCandidates.length > 0

  function handleDraftMessageChange(nextText: string) {
    setDraftMessage(nextText)
    if (!nextText) {
      setComposerInputHeight(CHAT_COMPOSER_INPUT_MIN_HEIGHT)
      setComposerInputScrollable(false)
    }
    if (selectedMentionAgentId && findMentionedProjectAgentId(nextText, visibleChatAgents) !== selectedMentionAgentId) {
      setSelectedMentionAgentId(undefined)
    }
    if (draftSelection.start === draftMessage.length && draftSelection.end === draftMessage.length) {
      setDraftSelection({ start: nextText.length, end: nextText.length })
    }
  }

  function insertMentionAgent(agent: ProjectAgent) {
    const token = activeMentionToken ?? { start: draftSelection.start, end: draftSelection.end, query: '' }
    const mentionText = `@${getAgentMentionHandle(agent)} `
    const nextMessage = `${draftMessage.slice(0, token.start)}${mentionText}${draftMessage.slice(token.end)}`
    const nextCursor = token.start + mentionText.length

    setDraftMessage(nextMessage)
    setSelectedMentionAgentId(agent.id)
    setDraftSelection({ start: nextCursor, end: nextCursor })
  }

  function scrollChatToBottom(animated = true) {
    chatScrollRef.current?.scrollToEnd({ animated })
    setShowScrollToBottom(false)
  }

  function handleChatScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y
    const shouldShow = distanceFromBottom > CHAT_SCROLL_TO_BOTTOM_THRESHOLD
    setShowScrollToBottom(current => (current === shouldShow ? current : shouldShow))
  }

  function showCopyToast(label: string) {
    if (copyToastTimerRef.current) {
      clearTimeout(copyToastTimerRef.current)
    }
    setCopyToastText(label)
    copyToastTimerRef.current = setTimeout(() => {
      setCopyToastText('')
      copyToastTimerRef.current = null
    }, 1400)
  }

  function openMessageActions(target: ChatMessageActionTarget) {
    Keyboard.dismiss()
    setMessageActionTarget(target)
  }

  function copyMessage(target: ChatMessageActionTarget) {
    const text = target.message.text.trim()
    setMessageActionTarget(null)
    if (!text) return
    void Clipboard.setStringAsync(text)
      .then(() => showCopyToast('已复制'))
      .catch(() => showCopyToast('复制失败'))
  }

  function quoteMessage(target: ChatMessageActionTarget) {
    const nextReplyTarget = createReplyReferenceFromMessage(target.message, target.senderName)
    setMessageActionTarget(null)
    if (!nextReplyTarget) return
    setReplyTarget(nextReplyTarget)
  }

  useEffect(() => () => {
    if (copyToastTimerRef.current) {
      clearTimeout(copyToastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setExpandedProcessIds(new Set())
    setDraftMessage('')
    setReplyTarget(undefined)
    setMessageActionTarget(null)
    setCopyToastText('')
    setComposerInputHeight(CHAT_COMPOSER_INPUT_MIN_HEIGHT)
    setComposerInputScrollable(false)
    setDraftSelection({ start: 0, end: 0 })
    setSelectedMentionAgentId(undefined)
    setShowScrollToBottom(false)
  }, [projectId])

  function sendMessage(retryPayload?: FailedChatSend) {
    const content = (retryPayload?.content ?? draftMessage).trim()
    if (!content || composerDisabled) return
    const activeReplyTarget = retryPayload?.replyTo ?? replyTarget
    const targetAgentId =
      workspace.kind === 'direct'
        ? workspace.agents[0]
        : retryPayload?.agentId ?? selectedMentionAgentId ?? findMentionedProjectAgentId(content, visibleChatAgents)

    if (!retryPayload) {
      setDraftMessage('')
      setComposerInputHeight(CHAT_COMPOSER_INPUT_MIN_HEIGHT)
      setComposerInputScrollable(false)
      setDraftSelection({ start: 0, end: 0 })
      setSelectedMentionAgentId(undefined)
      setReplyTarget(undefined)
    }
    onSend({
      projectId,
      conversationId: chatState.conversationId,
      content,
      agentId: targetAgentId,
      replyTo: activeReplyTarget,
    })
  }

  const messageCountText = chatState.messagePage ? `第 ${chatState.messagePage.page ?? 1} 页 · ${chatState.messagePage.total} 条消息` : `${chatState.messages.length} 条消息`

  return (
    <KeyboardAvoidingView style={[styles.chatScreen, { paddingBottom: composerBottomSpacing }]} keyboardVerticalOffset={keyboardOffset}>
      <ScrollView
        ref={chatScrollRef}
        style={styles.chatScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={handleChatScroll}
        onContentSizeChange={() => {
          if (!showScrollToBottom) {
            requestAnimationFrame(() => scrollChatToBottom(false))
          }
        }}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.chatScrollInner,
          isCompact && styles.chatScrollInnerCompact,
          isStandard && styles.chatScrollInnerStandard,
          isWide && styles.chatScrollInnerWide,
          { paddingBottom: 24 + composerSafePadding },
        ]}
      >
        <GlassCard style={[styles.chatWorkspaceCard, isCompact && styles.chatWorkspaceCardCompact, isStandard && styles.chatWorkspaceCardStandard]}>
          <View style={styles.chatWorkspaceTop}>
            <View style={styles.chatWorkspaceCopy}>
              <Text style={styles.homeWorkspaceEyebrow}>{workspace.kind === 'group' ? 'GROUP WORKSPACE' : 'DIRECT WORKSPACE'}</Text>
              <Text style={styles.chatWorkspaceTitle}>{workspace.name}</Text>
            </View>
            <Pill label={streaming ? 'streaming' : 'ready'} tone="blue" icon={streaming ? 'chart-timeline-variant-shimmer' : 'waveform'} />
          </View>
          <Text style={styles.homeWorkspaceDesc} numberOfLines={2}>{workspace.goal}</Text>
          <Pressable style={styles.chatWorkspaceSwitchInline} onPress={onOpenWorkspacePanel}>
            <MaterialCommunityIcons name="swap-horizontal" size={18} color="#2563eb" />
            <Text style={styles.chatWorkspaceSwitchText}>打开工作区切换面板</Text>
          </Pressable>
          <View style={styles.chatAgentOverview}>
            {visibleChatAgents.slice(0, isCompact ? 3 : 4).map((agent, index) => (
              <View key={getProjectAgentInstanceKey(agent, index)} style={{ marginLeft: index === 0 ? 0 : -8 }}>
                <AgentGlyph agentId={agent.id} label={agent.name} provider={agent.modelProvider} color={getProjectAgentColor(agent)} size={mobileScale.chatMiniAvatar} />
              </View>
            ))}
            <Text style={styles.chatAgentOverviewText}>{messageCountText}</Text>
          </View>
        </GlassCard>

        {chatError ? (
          <GlassCard style={styles.emptyStateCard}>
            <MaterialCommunityIcons name="alert-circle-outline" size={26} color="#dc2626" />
            <Text style={styles.cardTitle}>{lastFailedMessage ? '发送失败' : '对话加载失败'}</Text>
            <Text style={styles.bodyText}>{chatError}</Text>
            <Pressable style={styles.pinnedExpandButton} onPress={() => {
              if (lastFailedMessage) {
                sendMessage(lastFailedMessage)
              } else {
                onRefresh()
              }
            }}>
              <Text style={styles.pinnedExpandText}>重试</Text>
              <MaterialCommunityIcons name="refresh" size={18} color="#64748b" />
            </Pressable>
          </GlassCard>
        ) : null}

        {chatLoading && chatState.messages.length === 0 ? (
          <GlassCard style={styles.emptyStateCard}>
            <MaterialCommunityIcons name="progress-clock" size={26} color="#2563eb" />
            <Text style={styles.cardTitle}>正在加载对话</Text>
          </GlassCard>
        ) : null}

        {chatState.timelineItems.map(item =>
          item.type === 'message' ? (
            <ChatMessageBubble
              key={`message-${item.id}`}
              message={item.message}
              mobileScale={mobileScale}
              agentList={chatState.agents}
              onLongPress={openMessageActions}
            />
          ) : (
            <ChatProcessPanel
              key={`process-${item.id}`}
              group={item.group}
              mobileScale={mobileScale}
              streaming={streaming && item.group.status === 'running'}
              expanded={expandedProcessIds.has(item.group.id)}
              onToggleExpanded={() => {
                setExpandedProcessIds(previous => {
                  const next = new Set(previous)
                  if (next.has(item.group.id)) {
                    next.delete(item.group.id)
                  } else {
                    next.add(item.group.id)
                  }
                  return next
                })
              }}
            />
          ),
        )}

        {chatState.artifacts.length > 0 ? (
          <GlassCard style={styles.currentArtifactsPanel}>
            <View style={styles.currentArtifactsHead}>
              <Text style={styles.currentArtifactsTitle}>最新产物</Text>
              <Text style={styles.currentArtifactsSubtitle}>来自本工作区交付记录</Text>
            </View>
            <View style={styles.currentArtifactGrid}>
              {chatState.artifacts.map(item => (
                <CurrentArtifactCard key={`${item.type}-${item.id}`} artifact={item} mobileScale={mobileScale} onPress={() => setSelectedArtifact(item)} />
              ))}
            </View>
          </GlassCard>
        ) : null}
      </ScrollView>

      <ArtifactDetailModal
        artifact={selectedArtifact}
        projectId={projectId}
        onClose={() => setSelectedArtifact(null)}
        onRefresh={onRefresh}
      />

      {showScrollToBottom && !showMentionMenu ? (
        <Pressable
          accessibilityLabel="回到底部"
          accessibilityRole="button"
          hitSlop={8}
          style={[styles.chatScrollToBottomButton, { bottom: scrollToBottomButtonBottom }]}
          onPress={() => scrollChatToBottom()}
        >
          <MaterialCommunityIcons name="chevron-down" size={24} color="#2563eb" />
        </Pressable>
      ) : null}

      <View style={[styles.chatComposerDock, { paddingBottom: composerSafePadding }]}>
        {showMentionMenu ? (
          <GlassCard style={styles.mentionAgentMenu}>
            <ScrollView style={styles.mentionAgentList} keyboardShouldPersistTaps="always" nestedScrollEnabled showsVerticalScrollIndicator={mentionCandidates.length > 3}>
              {mentionCandidates.map((agent, index) => (
                <Pressable key={getProjectAgentInstanceKey(agent, index)} style={styles.mentionAgentRow} onPress={() => insertMentionAgent(agent)}>
                  <AgentGlyph agentId={agent.id} label={agent.name} provider={agent.modelProvider} color={getProjectAgentColor(agent)} size={34} />
                  <View style={styles.mentionAgentCopy}>
                    <View style={styles.mentionAgentNameRow}>
                      <Text style={styles.mentionAgentName} numberOfLines={1}>{agent.name ?? agent.id}</Text>
                      <Text style={styles.mentionAgentHandle} numberOfLines={1}>@{getAgentMentionHandle(agent)}</Text>
                    </View>
                    {agent.role || agent.description ? <Text style={styles.mentionAgentRole} numberOfLines={1}>{agent.role ?? agent.description}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </GlassCard>
        ) : null}
        {replyTarget ? (
          <GlassCard style={styles.chatReplyComposerBar}>
            <MaterialCommunityIcons name="message-reply-text-outline" size={18} color="#2563eb" />
            <View style={styles.chatReplyComposerCopy}>
              <Text style={styles.chatReplyComposerTitle} numberOfLines={1}>引用 {getReplySenderLabel(replyTarget)}</Text>
              <Text style={styles.chatReplyComposerExcerpt} numberOfLines={1}>{replyTarget.excerpt}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="取消引用" hitSlop={8} style={styles.chatReplyComposerClose} onPress={() => setReplyTarget(undefined)}>
              <MaterialCommunityIcons name="close" size={18} color="#64748b" />
            </Pressable>
          </GlassCard>
        ) : null}
        {copyToastText ? (
          <View pointerEvents="none" style={styles.chatCopyToast}>
            <Text style={styles.chatCopyToastText}>{copyToastText}</Text>
          </View>
        ) : null}
        <GlassCard style={styles.chatComposer}>
          <TextInput
            placeholder="给工作区发送任务"
            placeholderTextColor="#94a3b8"
            value={draftMessage}
            onChangeText={handleDraftMessageChange}
            onContentSizeChange={event => {
              const measuredContentHeight = Math.ceil(event.nativeEvent.contentSize.height)
              const measuredInputHeight = Platform.OS === 'ios'
                ? measuredContentHeight + CHAT_COMPOSER_INPUT_VERTICAL_PADDING * 2
                : measuredContentHeight
              const nextHeight = Math.min(CHAT_COMPOSER_INPUT_MAX_HEIGHT, Math.max(CHAT_COMPOSER_INPUT_MIN_HEIGHT, measuredInputHeight))
              setComposerInputHeight(nextHeight)
              setComposerInputScrollable(measuredContentHeight > CHAT_COMPOSER_INPUT_CONTENT_MAX_HEIGHT)
            }}
            onSelectionChange={event => setDraftSelection(event.nativeEvent.selection)}
            style={[styles.chatComposerInput, { height: composerInputHeight }]}
            editable={!composerDisabled}
            multiline
            scrollEnabled={composerInputScrollable}
            textAlignVertical="top"
          />
          <Pressable style={[styles.chatSendButton, sendButtonDisabled && styles.chatSendButtonDisabled]} onPress={() => void sendMessage()} disabled={sendButtonDisabled}>
            <MaterialCommunityIcons name={composerDisabled ? 'progress-clock' : 'arrow-up'} size={25} color="#fff" />
          </Pressable>
        </GlassCard>
      </View>
      <MessageActionSheet
        target={messageActionTarget}
        mobileScale={mobileScale}
        onClose={() => setMessageActionTarget(null)}
        onCopy={copyMessage}
        onQuote={quoteMessage}
      />
    </KeyboardAvoidingView>
  )
}

function ChatMessageBubble({
  message,
  mobileScale,
  agentList,
  onLongPress,
}: {
  message: ChatMessageView
  mobileScale: MobileScale
  agentList: ProjectAgent[]
  onLongPress: (target: ChatMessageActionTarget) => void
}) {
  const isUser = message.sender === 'user'
  const projectAgent = findProjectAgent(agentList, message.agentId)
  const fallbackAgent = message.agentId ? agents.find(item => item.id === message.agentId) : undefined
  const agentName = projectAgent?.name ?? fallbackAgent?.name ?? message.agentId ?? 'Agent'

  if (isUser) {
    return (
      <View style={styles.userMessageRow}>
        <Pressable style={styles.userPromptActionTarget} delayLongPress={280} onLongPress={() => onLongPress({ message, senderName: '用户' })}>
          <GlassCard style={[styles.userPromptBubble, styles.userPromptBubbleInAction]}>
            <ChatReplyPreview replyTo={message.replyTo} userBubble />
            <Text style={[styles.userPromptText, { fontSize: mobileScale.messageText, lineHeight: mobileScale.messageLineHeight }]}>{message.text}</Text>
            {message.time ? <Text style={styles.chatBubbleTime}>{message.time}</Text> : null}
          </GlassCard>
        </Pressable>
        <View style={[styles.chatUserGlyph, { width: mobileScale.chatUserAvatar, height: mobileScale.chatUserAvatar, borderRadius: mobileScale.chatUserAvatar / 2 }]}>
          <MaterialCommunityIcons name="account" size={mobileScale.chatUserAvatar * 0.54} color="#fff" />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.agentMessageBlock}>
      <View style={styles.agentMessageMetaRow}>
        <AgentGlyph agentId={message.agentId ?? 'orchestrator'} label={projectAgent?.name} provider={projectAgent?.modelProvider} color={getProjectAgentColor(projectAgent)} size={mobileScale.chatAgentAvatar} />
        <Text style={styles.agentMessageName}>{agentName}</Text>
        {message.time ? (
          <View style={styles.agentSmallBadge}>
            <Text style={styles.agentSmallBadgeText}>{message.time}</Text>
          </View>
        ) : null}
      </View>
      <Pressable style={styles.agentMessageActionTarget} delayLongPress={280} onLongPress={() => onLongPress({ message, senderName: agentName })}>
        <GlassCard style={[styles.chatBubbleLarge, styles.chatBubbleLargeInAction]}>
          <ChatReplyPreview replyTo={message.replyTo} />
          <ChatMarkdownContent content={message.text || '...'} mobileScale={mobileScale} />
        </GlassCard>
      </Pressable>
    </View>
  )
}

function ChatMarkdownContent({ content, mobileScale }: { content: string; mobileScale: MobileScale }) {
  const normalizedContent = useMemo(() => normalizeAiMarkdown(content, { mode: 'bubble' }) || '...', [content])
  const markdownStyles = useMemo(() => {
    const bodyText = {
      color: '#172033',
      fontSize: mobileScale.messageText,
      lineHeight: mobileScale.messageLineHeight,
      fontWeight: '700' as const,
    }
    const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

    return {
      body: {
        ...bodyText,
      },
      text: {
        ...bodyText,
      },
      paragraph: {
        marginTop: 0,
        marginBottom: 8,
      },
      heading1: {
        color: '#0f172a',
        fontSize: mobileScale.messageText + 6,
        lineHeight: mobileScale.messageLineHeight + 7,
        fontWeight: '900' as const,
        marginTop: 4,
        marginBottom: 10,
      },
      heading2: {
        color: '#0f172a',
        fontSize: mobileScale.messageText + 4,
        lineHeight: mobileScale.messageLineHeight + 5,
        fontWeight: '900' as const,
        marginTop: 4,
        marginBottom: 9,
      },
      heading3: {
        color: '#0f172a',
        fontSize: mobileScale.messageText + 2,
        lineHeight: mobileScale.messageLineHeight + 4,
        fontWeight: '900' as const,
        marginTop: 4,
        marginBottom: 8,
      },
      strong: {
        color: '#0f172a',
        fontWeight: '900' as const,
      },
      em: {
        color: '#334155',
        fontStyle: 'italic' as const,
      },
      bullet_list: {
        marginBottom: 8,
      },
      ordered_list: {
        marginBottom: 8,
      },
      bullet_list_icon: {
        color: '#172033',
        fontSize: mobileScale.messageText,
        lineHeight: mobileScale.messageLineHeight,
      },
      ordered_list_icon: {
        color: '#172033',
        fontSize: mobileScale.messageText,
        lineHeight: mobileScale.messageLineHeight,
      },
      bullet_list_content: {
        flex: 1,
        minWidth: 0,
      },
      ordered_list_content: {
        flex: 1,
        minWidth: 0,
      },
      list_item: {
        marginBottom: 3,
      },
      code_inline: {
        color: '#2563eb',
        fontFamily: monoFont,
        fontSize: Math.max(12, mobileScale.messageText - 1),
        fontWeight: '800' as const,
        backgroundColor: 'rgba(37,99,235,0.1)',
        borderRadius: 6,
        paddingHorizontal: 5,
        paddingVertical: 1,
      },
      code_block: {
        color: '#0f172a',
        fontFamily: monoFont,
        fontSize: Math.max(12, mobileScale.messageText - 2),
        lineHeight: Math.max(18, mobileScale.messageLineHeight - 4),
        backgroundColor: 'rgba(15,23,42,0.06)',
        borderRadius: 12,
        padding: 10,
        marginTop: 4,
        marginBottom: 10,
      },
      fence: {
        color: '#0f172a',
        fontFamily: monoFont,
        fontSize: Math.max(12, mobileScale.messageText - 2),
        lineHeight: Math.max(18, mobileScale.messageLineHeight - 4),
        backgroundColor: 'rgba(15,23,42,0.06)',
        borderRadius: 12,
        padding: 10,
        marginTop: 4,
        marginBottom: 10,
      },
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.08)',
        paddingHorizontal: 10,
        paddingVertical: 7,
        marginVertical: 8,
      },
      link: {
        color: '#2563eb',
        fontWeight: '900' as const,
      },
      hr: {
        backgroundColor: 'rgba(100,116,139,0.18)',
        height: 1,
        marginVertical: 10,
      },
      table: {
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.5)',
        borderRadius: 8,
        marginVertical: 8,
      },
      th: {
        backgroundColor: 'rgba(37,99,235,0.08)',
        padding: 6,
      },
      td: {
        padding: 6,
      },
    }
  }, [mobileScale])

  function handleLinkPress(url: string) {
    if (!url) return false
    void Linking.openURL(url)
    return false
  }

  return (
    <Markdown style={markdownStyles} onLinkPress={handleLinkPress}>
      {normalizedContent}
    </Markdown>
  )
}

function ChatReplyPreview({ replyTo, userBubble = false }: { replyTo?: ChatReplyReference; userBubble?: boolean }) {
  if (!replyTo) return null
  return (
    <View style={[styles.chatReplyPreview, userBubble && styles.chatReplyPreviewUser]}>
      <Text style={styles.chatReplyPreviewTitle} numberOfLines={1}>{getReplySenderLabel(replyTo)}</Text>
      <Text style={styles.chatReplyPreviewExcerpt} numberOfLines={2}>{replyTo.excerpt}</Text>
    </View>
  )
}

function MessageActionSheet({
  target,
  mobileScale,
  onClose,
  onCopy,
  onQuote,
}: {
  target: ChatMessageActionTarget | null
  mobileScale: MobileScale
  onClose: () => void
  onCopy: (target: ChatMessageActionTarget) => void
  onQuote: (target: ChatMessageActionTarget) => void
}) {
  const canCopy = !!target?.message.text.trim()
  const canQuote = !!target && !!createReplyReferenceFromMessage(target.message, target.senderName)

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.messageActionSheetBackdrop}>
        <Pressable style={styles.messageActionSheetScrim} onPress={onClose} />
        <GlassCard style={styles.messageActionSheet}>
          <View style={styles.messageActionSheetHandle} />
          <Text style={[styles.messageActionSheetTitle, { fontSize: mobileScale.messageText }]} numberOfLines={1}>{target?.senderName ?? '消息'}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!canCopy || !target}
            style={[styles.messageActionRow, (!canCopy || !target) && styles.messageActionRowDisabled]}
            onPress={() => target && onCopy(target)}
          >
            <MaterialCommunityIcons name="content-copy" size={21} color="#2563eb" />
            <Text style={styles.messageActionText}>复制</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!canQuote || !target}
            style={[styles.messageActionRow, (!canQuote || !target) && styles.messageActionRowDisabled]}
            onPress={() => target && onQuote(target)}
          >
            <MaterialCommunityIcons name="message-reply-text-outline" size={21} color="#2563eb" />
            <Text style={styles.messageActionText}>引用</Text>
          </Pressable>
        </GlassCard>
      </View>
    </Modal>
  )
}

function ChatProcessPanel({
  group,
  mobileScale,
  streaming,
  expanded,
  onToggleExpanded,
}: {
  group: ChatProcessGroup
  mobileScale: MobileScale
  streaming: boolean
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const hiddenStepCount = Math.max(0, group.steps.length - PROCESS_PREVIEW_STEP_COUNT)
  const visibleSteps = expanded ? group.steps : group.steps.slice(-PROCESS_PREVIEW_STEP_COUNT)
  const statusText = streaming || group.status === 'running' ? '进行中' : group.status === 'failed' ? '异常' : '已完成'

  return (
    <GlassCard style={[styles.chatProcessCard, group.status === 'running' && styles.chatProcessCardRunning]}>
      <View style={styles.chatProcessHead}>
        <View style={styles.chatProcessTitleLine}>
          <MaterialCommunityIcons name="robot-outline" size={22} color="#2563eb" />
          <Text style={[styles.chatProcessTitle, { fontSize: mobileScale.panelTitle }]}>本轮过程</Text>
          {group.steps.length > PROCESS_PREVIEW_STEP_COUNT ? (
            <Text style={[styles.chatProcessCount, { fontSize: mobileScale.metaText }]}>最新 {visibleSteps.length}/{group.steps.length}</Text>
          ) : null}
        </View>
        <View style={[styles.processStatePill, group.status === 'failed' && styles.processStatePillFailed]}>
          <Text style={[styles.processStateText, group.status === 'failed' && styles.processStateTextFailed, { fontSize: mobileScale.labelText }]}>{statusText}</Text>
        </View>
      </View>
      {visibleSteps.map(step => (
        <View key={step.id} style={styles.chatProcessRow}>
          <View style={[styles.chatProcessIcon, step.tone === 'done' && styles.chatProcessIconDone, step.tone === 'running' && styles.chatProcessIconRunning, step.tone === 'failed' && styles.chatProcessIconFailed]}>
            <MaterialCommunityIcons name={step.icon} size={19} color={step.tone === 'done' ? '#10b981' : '#fff'} />
          </View>
          <View style={styles.chatProcessStepBody}>
            <Text style={[styles.chatProcessStepTitle, { fontSize: mobileScale.messageText }]} numberOfLines={1}>{step.title}</Text>
            <Text style={[styles.chatProcessSummary, { fontSize: mobileScale.messageText }]} numberOfLines={expanded ? 5 : 2}>{step.summary}</Text>
          </View>
          {step.time ? <Text style={[styles.chatProcessTime, { fontSize: mobileScale.metaText }]}>{step.time}</Text> : null}
        </View>
      ))}
      {hiddenStepCount > 0 ? (
        <Pressable style={styles.chatProcessExpandButton} onPress={onToggleExpanded}>
          <Text style={styles.chatProcessExpandText}>{expanded ? '收起过程' : `展开全部 ${group.steps.length} 步`}</Text>
          <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#2563eb" />
        </Pressable>
      ) : null}
    </GlassCard>
  )
}

function LegacyChatScreen({ workspace, layoutTier, mobileScale, onOpenWorkspacePanel }: { workspace: Workspace; layoutTier: LayoutTier; mobileScale: MobileScale; onOpenWorkspacePanel: () => void }) {
  const isCompact = layoutTier === 'compact'
  const isStandard = layoutTier === 'standard'
  const isWide = layoutTier === 'wide'
  const insets = useSafeAreaInsets()
  const keyboardOffset = Platform.OS === 'ios' ? 8 : 0
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactView | null>(null)
  const artifactViews: ArtifactView[] = artifacts.map(item => {
    if (item.type === 'preview') return { ...item, status: 'generating', statusLabel: '生成中' }
    if (item.type === 'diff') return { ...item, status: 'partial', statusLabel: '部分完成' }
    if (item.type === 'review') return { ...item, status: 'generating', statusLabel: '等待审查' }
    return { ...item, status: 'ready', statusLabel: '可查看' }
  })

  return (
    <KeyboardAvoidingView
      style={styles.chatScreen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardOffset + insets.top}
    >
      <ScrollView
        style={styles.chatScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.chatScrollInner,
          isCompact && styles.chatScrollInnerCompact,
          isStandard && styles.chatScrollInnerStandard,
          isWide && styles.chatScrollInnerWide,
          { paddingBottom: 18 + insets.bottom },
        ]}
      >
        <GlassCard style={[styles.chatWorkspaceCard, isCompact && styles.chatWorkspaceCardCompact, isStandard && styles.chatWorkspaceCardStandard]}>
          <View style={styles.chatWorkspaceTop}>
            <View style={styles.chatWorkspaceCopy}>
              <Text style={styles.homeWorkspaceEyebrow}>{workspace.kind === 'group' ? 'GROUP WORKSPACE' : 'DIRECT WORKSPACE'}</Text>
              <Text style={styles.chatWorkspaceTitle}>{workspace.name}</Text>
            </View>
            <Pill label="当前活跃" tone="blue" icon="waveform" />
          </View>
          <Text style={styles.homeWorkspaceDesc} numberOfLines={2}>{workspace.goal}</Text>
          <Pressable style={styles.chatWorkspaceSwitchInline} onPress={onOpenWorkspacePanel}>
            <MaterialCommunityIcons name="swap-horizontal" size={18} color="#2563eb" />
            <Text style={styles.chatWorkspaceSwitchText}>打开工作区切换面板</Text>
          </Pressable>
          <View style={styles.chatAgentOverview}>
            {workspace.agents.slice(0, isCompact ? 3 : 4).map((agentId, index) => (
              <View key={agentId} style={{ marginLeft: index === 0 ? 0 : -8 }}>
                <AgentGlyph agentId={agentId} size={mobileScale.chatMiniAvatar} />
              </View>
            ))}
            <Text style={styles.chatAgentOverviewText}>{workspace.runningAgents} 个 Agent 执行中 · {workspace.artifactCount} 个产物</Text>
          </View>
        </GlassCard>

        <View style={styles.userMessageRow}>
          <GlassCard style={styles.userPromptBubble}>
            <Text style={[styles.userPromptText, { fontSize: mobileScale.messageText, lineHeight: mobileScale.messageLineHeight }]}>
              <Text style={styles.mentionText}>@engineer</Text>
              {'  '}先把移动端 app 的主 UI 做出来，按 web 端功能做 mock。
            </Text>
          </GlassCard>
          <AgentGlyph agentId="product-manager" size={mobileScale.chatUserAvatar} />
        </View>

        <View style={styles.agentMessageBlock}>
          <View style={styles.agentMessageMetaRow}>
            <AgentGlyph agentId="orchestrator" size={mobileScale.chatAgentAvatar} />
            <Text style={styles.agentMessageName}>协调 Agent</Text>
            <View style={styles.agentSmallBadge}>
              <Text style={styles.agentSmallBadgeText}>协调中</Text>
            </View>
          </View>
          <GlassCard style={styles.chatBubbleLarge}>
            <Text style={[styles.chatBubbleText, { fontSize: mobileScale.messageText, lineHeight: mobileScale.messageLineHeight }]}>我先快速梳理目标：移动端保留工作区、群聊、Agent 管理、代码/产物查看和交付状态。</Text>
          </GlassCard>
        </View>

        <GlassCard style={styles.chatProcessCard}>
          <View style={styles.chatProcessHead}>
            <View style={styles.chatProcessTitleLine}>
              <MaterialCommunityIcons name="robot-outline" size={22} color="#2563eb" />
              <Text style={[styles.chatProcessTitle, { fontSize: mobileScale.panelTitle }]}>本轮过程</Text>
            </View>
            <View style={styles.processStatePill}>
              <Text style={[styles.processStateText, { fontSize: mobileScale.labelText }]}>进行中</Text>
            </View>
          </View>
          {[
            { icon: 'check-circle-outline' as IconName, title: '路由完成', summary: '已识别任务并分配给工程师 Agent', time: '21:12', tone: 'done' },
            { icon: 'code-tags' as IconName, title: '工程执行中', summary: '正在生成移动端主 UI mock', time: '21:13', tone: 'running' },
            { icon: 'clock-outline' as IconName, title: '等待审查', summary: '工程师完成后将提交给审查 Agent', time: '-', tone: 'waiting' },
          ].map(step => (
            <View key={step.title} style={styles.chatProcessRow}>
              <View style={[styles.chatProcessIcon, step.tone === 'done' && styles.chatProcessIconDone, step.tone === 'running' && styles.chatProcessIconRunning]}>
                <MaterialCommunityIcons name={step.icon} size={19} color={step.tone === 'waiting' ? '#fff' : step.tone === 'done' ? '#10b981' : '#fff'} />
              </View>
              <Text style={[styles.chatProcessStepTitle, { fontSize: mobileScale.messageText }]}>{step.title}</Text>
              <Text style={[styles.chatProcessSummary, { fontSize: mobileScale.messageText }]} numberOfLines={1}>{step.summary}</Text>
              <Text style={[styles.chatProcessTime, { fontSize: mobileScale.metaText }]}>{step.time}</Text>
            </View>
          ))}
        </GlassCard>

        <View style={styles.agentMessageBlock}>
          <View style={styles.agentMessageMetaRow}>
            <AgentGlyph agentId="reviewer" size={mobileScale.chatReviewerAvatar} />
            <Text style={styles.agentMessageName}>工程师</Text>
            <View style={styles.engineerBadge}>
              <Text style={styles.engineerBadgeText}>执行中</Text>
            </View>
          </View>
          <GlassCard style={styles.engineerBubble}>
            <Text style={[styles.chatBubbleText, { fontSize: mobileScale.messageText, lineHeight: mobileScale.messageLineHeight }]}>我会把 Monaco 和 iframe 能力先转成移动端摘要卡，后续再接真实接口。</Text>
            <Text style={styles.chatBubbleTime}>21:14</Text>
          </GlassCard>
        </View>

        <GlassCard style={styles.currentArtifactsPanel}>
          <Text style={styles.currentArtifactsTitle}>当前产出（工程师）</Text>
          <View style={styles.currentArtifactGrid}>
            {artifactViews.map(item => (
                <CurrentArtifactCard
                  key={item.id}
                  artifact={item}
                  mobileScale={mobileScale}
                onPress={() => setSelectedArtifact(item)}
              />
            ))}
          </View>
        </GlassCard>
      </ScrollView>

      <GlassCard style={styles.chatComposer}>
        <TextInput placeholder="给工作区发送任务，支持 @Agent 和代码引用" placeholderTextColor="#94a3b8" style={styles.chatComposerInput} />
        <Pressable style={styles.composerToolButton}>
          <Text style={styles.composerToolText}>@</Text>
        </Pressable>
        <Pressable style={styles.composerToolButton}>
          <MaterialCommunityIcons name="code-tags" size={20} color="#0f172a" />
        </Pressable>
        <Pressable style={styles.chatSendButton}>
          <MaterialCommunityIcons name="arrow-up" size={25} color="#fff" />
        </Pressable>
      </GlassCard>
      <ArtifactDetailModal
        artifact={selectedArtifact}
        projectId={workspace.projectId ?? workspace.id}
        onClose={() => setSelectedArtifact(null)}
      />
    </KeyboardAvoidingView>
  )
}

function CurrentArtifactCard({ artifact, mobileScale, onPress }: { artifact: ArtifactView; mobileScale: MobileScale; onPress: () => void }) {
  const tone = artifact.status === 'ready' ? 'green' : artifact.status === 'partial' ? 'blue' : artifact.status === 'failed' ? 'red' : 'muted'
  const disabled = artifact.status === 'generating'
  return (
    <Pressable style={[styles.currentArtifactCard, { minHeight: mobileScale.artifactCardMinHeight }, disabled && styles.currentArtifactCardDisabled]} onPress={onPress} disabled={disabled}>
      <MaterialCommunityIcons name={artifact.icon} size={mobileScale.headerIcon} color={tone === 'green' ? '#10b981' : tone === 'red' ? '#dc2626' : tone === 'muted' ? '#334155' : '#5572ff'} />
      <Text style={styles.currentArtifactTitle} numberOfLines={2}>{artifact.title}</Text>
      <Text style={[styles.currentArtifactMeta, tone === 'green' && styles.currentArtifactMetaGreen, tone === 'red' && styles.currentArtifactMetaFailed, tone === 'muted' && styles.currentArtifactMetaMuted]} numberOfLines={2}>{artifact.metric}</Text>
      <View style={[styles.artifactStatusBadge, artifact.status === 'ready' && styles.artifactStatusReady, artifact.status === 'partial' && styles.artifactStatusPartial, artifact.status === 'failed' && styles.artifactStatusFailed]}>
        <Text style={[styles.artifactStatusText, artifact.status === 'ready' && styles.artifactStatusReadyText, artifact.status === 'partial' && styles.artifactStatusPartialText, artifact.status === 'failed' && styles.artifactStatusFailedText]}>{artifact.statusLabel}</Text>
      </View>
    </Pressable>
  )
}

function ActivityCenterModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const activityItems = [
    { workspace: workspaces[0], label: '工程师正在调整 RN 首页布局', type: '运行中', icon: 'robot-outline' as IconName },
    { workspace: workspaces[1], label: '预览摘要已更新', type: '预览 ready', icon: 'cellphone-screenshot' as IconName },
    { workspace: workspaces[2], label: '无阻塞问题', type: 'Review pass', icon: 'shield-check-outline' as IconName },
  ]

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalScrim} onPress={onClose} />
        <GlassCard style={styles.activityCenterSheet}>
          <View style={styles.artifactDetailHandle} />
          <View style={styles.activityCenterHead}>
            <View>
              <Text style={styles.homeWorkspaceEyebrow}>ACTIVITY CENTER</Text>
              <Text style={styles.artifactDetailTitle}>通知与最近活动</Text>
            </View>
            <Pressable style={styles.artifactCloseButton} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color="#0f172a" />
            </Pressable>
          </View>

          <View style={styles.activitySummaryRow}>
            <View style={styles.activitySummaryPill}>
              <MaterialCommunityIcons name="at" size={17} color="#2563eb" />
              <Text style={styles.activitySummaryText}>2 提及</Text>
            </View>
            <View style={styles.activitySummaryPill}>
              <MaterialCommunityIcons name="bell-ring-outline" size={17} color="#db2777" />
              <Text style={styles.activitySummaryText}>3 未读</Text>
            </View>
            <View style={styles.activitySummaryPill}>
              <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={17} color="#059669" />
              <Text style={styles.activitySummaryText}>1 完成</Text>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.activityCenterList}>
            {activityItems.map(item => (
              <View key={item.workspace.id} style={styles.activityCenterRow}>
                <View style={styles.activityCenterIcon}>
                  <MaterialCommunityIcons name={item.icon} size={21} color="#2563eb" />
                </View>
                <View style={styles.activityCopy}>
                  <View style={styles.activityCenterTitleLine}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.workspace.name}</Text>
                    <Text style={styles.activityTypeText}>{item.type}</Text>
                  </View>
                  <Text style={styles.bodyText} numberOfLines={1}>{item.label}</Text>
                </View>
                <Text style={styles.activityTime}>{item.workspace.updatedAt}</Text>
              </View>
            ))}
          </ScrollView>
        </GlassCard>
      </View>
    </Modal>
  )
}

function WorkspacePanelModal({
  visible,
  mode,
  workspaceList,
  activeWorkspaceId,
  layoutTier,
  creating,
  onClose,
  onSwitch,
  onCreate,
}: {
  visible: boolean
  mode: 'switch' | 'create'
  workspaceList: Workspace[]
  activeWorkspaceId: string
  layoutTier: LayoutTier
  creating: boolean
  onClose: () => void
  onSwitch: (workspace: Workspace) => void
  onCreate: (input: CreateWorkspaceInput) => void
}) {
  const [draftName, setDraftName] = useState('')
  const [draftGoal, setDraftGoal] = useState('通过多 Agent 协作完成一个可预览产物。')
  const [draftKind, setDraftKind] = useState<Workspace['kind']>('group')
  const [draftType, setDraftType] = useState<Workspace['type']>('dev')
  const [selectedAgents, setSelectedAgents] = useState<string[]>(['orchestrator', 'engineer'])
  const [typeOpen, setTypeOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const isCompact = layoutTier === 'compact'
  const visibleWorkspaces = workspaceList.filter(workspace => !workspace.archived).slice(0, 5)
  const directAgentOptions = DIRECT_WORKSPACE_AGENT_OPTIONS
  const preferredDirectAgentId =
    directAgentOptions.find(option => option.id === 'codex-direct')?.id ??
    directAgentOptions[0]?.id ??
    'codex-direct'
  const typeOptions: { value: Workspace['type']; label: string; helper: string }[] = [
    { value: 'dev', label: '开发工作区', helper: '适合多 Agent 协作实现、联调和交付。' },
    { value: 'research', label: '研究工作区', helper: '适合资料调研、归纳分析和报告草拟。' },
    { value: 'writing', label: '文档工作区', helper: '适合文档、方案、脚本和内容产出。' },
  ]
  const activeType = typeOptions.find(option => option.value === draftType) ?? typeOptions[0]
  const targetAgent = directAgentOptions.find(agent => agent.id === selectedAgents[0]) ?? directAgentOptions.find(agent => agent.id === preferredDirectAgentId)
  const canCreate = draftName.trim().length > 0 && draftGoal.trim().length > 0 && !creating && (draftKind === 'group' || Boolean(targetAgent))

  const toggleAgent = (agentId: string) => {
    setSelectedAgents(current => {
      if (draftKind === 'direct') return [agentId]
      if (current.includes(agentId)) return current.length === 1 ? current : current.filter(id => id !== agentId)
      return [...current, agentId]
    })
  }

  const createWorkspace = () => {
    if (!canCreate) return

    onCreate({
      name: draftName.trim(),
      goal: draftGoal.trim(),
      workspaceType: draftKind === 'direct' ? 'chat' : draftType,
      conversationType: draftKind,
      agentIds: draftKind === 'direct' ? [targetAgent?.id ?? preferredDirectAgentId] : selectedAgents,
    })
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalScrim} onPress={onClose} />
        <GlassCard style={[styles.workspacePanelSheet, isCompact && styles.workspacePanelSheetCompact]}>
          <View style={styles.artifactDetailHandle} />
          <View style={styles.activityCenterHead}>
            <View style={styles.workspacePanelTitleCopy}>
              <Text style={styles.homeWorkspaceEyebrow}>WORKSPACE PANEL</Text>
              <Text style={styles.artifactDetailTitle}>{mode === 'create' ? '创建工作区' : '切换工作区'}</Text>
            </View>
            <Pressable style={styles.artifactCloseButton} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color="#0f172a" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.workspacePanelContent}>
            {mode === 'switch' ? (
              <View style={styles.workspacePanelSection}>
                <View style={styles.workspacePanelSectionHead}>
                  <Text style={styles.workspacePanelSectionTitle}>快速切换</Text>
                  <Text style={styles.workbenchSectionMeta}>{workspaceList.length} 个</Text>
                </View>
                {visibleWorkspaces.map(workspace => {
                  const isActive = workspace.id === activeWorkspaceId
                  return (
                    <Pressable key={workspace.id} style={[styles.workspaceSwitchRow, isActive && styles.workspaceSwitchRowActive]} onPress={() => onSwitch(workspace)}>
                      <View style={styles.workspaceSwitchIcon}>
                        <MaterialCommunityIcons name={workspace.kind === 'group' ? 'account-group-outline' : 'account-outline'} size={20} color="#2563eb" />
                      </View>
                      <View style={styles.workspaceSwitchCopy}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{workspace.name}</Text>
                        <Text style={styles.bodyText} numberOfLines={1}>{workspace.latestEventLabel}</Text>
                      </View>
                      <Text style={styles.workspaceSwitchMeta}>{isActive ? '当前' : workspace.updatedAt}</Text>
                    </Pressable>
                  )
                })}
              </View>
            ) : null}

            {mode === 'create' ? (
              <View style={styles.workspaceCreateForm}>
                <Text style={styles.workspaceCreateTitle}>新建工作区</Text>
                <View style={styles.workspaceFormField}>
                  <Text style={styles.workspaceFormLabel}>工作区名称</Text>
                  <TextInput
                    value={draftName}
                    onChangeText={setDraftName}
                    placeholder="例如：投票小程序联调"
                    placeholderTextColor="#94a3b8"
                    style={styles.workspaceNameInput}
                  />
                </View>

                <View style={styles.workspaceFormField}>
                  <Text style={styles.workspaceFormLabel}>工作区目标</Text>
                  <TextInput
                    value={draftGoal}
                    onChangeText={setDraftGoal}
                    placeholder="通过多 Agent 协作完成一个可预览产物。"
                    placeholderTextColor="#94a3b8"
                    multiline
                    textAlignVertical="top"
                    style={[styles.workspaceNameInput, styles.workspaceGoalInput]}
                  />
                </View>

                <View style={styles.workspaceFormField}>
                  <Text style={styles.workspaceFormLabel}>会话模式</Text>
                  <View style={styles.workspaceSegmentControl}>
                    {(['group', 'direct'] as Workspace['kind'][]).map(kind => (
                      <Pressable
                        key={kind}
                        style={[styles.workspaceSegmentItem, draftKind === kind && styles.workspaceSegmentItemActive]}
                        onPress={() => {
                          setDraftKind(kind)
                          setSelectedAgents(current => {
                            if (kind === 'direct') return [preferredDirectAgentId]
                            const nextGroupAgents = current.filter(agentId => !isDirectWorkspaceAgentId(agentId))
                            return nextGroupAgents.length > 0 ? nextGroupAgents : [...DEFAULT_WORKSPACE_CREATE_AGENT_IDS]
                          })
                          setTypeOpen(false)
                          setAgentOpen(false)
                        }}
                      >
                        <Text style={[styles.workspaceSegmentText, draftKind === kind && styles.workspaceSegmentTextActive]}>{kind === 'group' ? '群聊工作区' : '单聊工作区'}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.workspaceFormHelp}>{draftKind === 'group' ? '由主脑协调多个 Agent 协作。' : '直接与一个 Agent 沟通，适合轻量任务。'}</Text>
                </View>

                {draftKind === 'group' ? (
                  <View style={styles.workspaceFormField}>
                    <Text style={styles.workspaceFormLabel}>工作区类型</Text>
                    <Pressable style={styles.workspaceSelectBox} onPress={() => setTypeOpen(open => !open)}>
                      <Text style={styles.workspaceSelectText}>{activeType.label}</Text>
                      <MaterialCommunityIcons name={typeOpen ? 'chevron-up' : 'chevron-down'} size={22} color="#334155" />
                    </Pressable>
                    {typeOpen ? (
                      <View style={styles.workspaceSelectMenu}>
                        {typeOptions.map(option => (
                          <Pressable
                            key={option.value}
                            style={[styles.workspaceSelectOption, draftType === option.value && styles.workspaceSelectOptionActive]}
                            onPress={() => {
                              setDraftType(option.value)
                              setTypeOpen(false)
                            }}
                          >
                            <Text style={[styles.workspaceSelectOptionText, draftType === option.value && styles.workspaceSelectOptionTextActive]}>{option.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <Text style={styles.workspaceFormHelp}>{activeType.helper}</Text>
                  </View>
                ) : (
                  <View style={styles.workspaceFormField}>
                    <Text style={styles.workspaceFormLabel}>目标 Agent</Text>
                    <Pressable style={styles.workspaceSelectBox} onPress={() => setAgentOpen(open => !open)}>
                      <Text style={styles.workspaceSelectText}>{targetAgent?.name ?? 'Codex Agent'}</Text>
                      <MaterialCommunityIcons name={agentOpen ? 'chevron-up' : 'chevron-down'} size={22} color="#334155" />
                    </Pressable>
                    {agentOpen ? (
                      <View style={styles.workspaceSelectMenu}>
                        {directAgentOptions.map(agent => (
                          <Pressable
                            key={agent.id}
                            style={[styles.workspaceSelectOption, targetAgent?.id === agent.id && styles.workspaceSelectOptionActive]}
                            onPress={() => {
                              setSelectedAgents([agent.id])
                              setAgentOpen(false)
                            }}
                          >
                            <Text style={[styles.workspaceSelectOptionText, targetAgent?.id === agent.id && styles.workspaceSelectOptionTextActive]}>{agent.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <Text style={styles.workspaceFormHelp}>固定把消息发送给一个目标 Agent，适合聚焦式调试。</Text>
                  </View>
                )}

                <Text style={styles.workspaceCreateTarget}>当前创建目标： 业务后端 API / {BUSINESS_API_BASE_URL.replace(/^https?:\/\//, '')}</Text>
                <View style={styles.workspaceCreateActions}>
                  <Pressable style={styles.workspaceCancelButton} onPress={onClose} disabled={creating}>
                    <Text style={styles.workspaceCancelText}>取消</Text>
                  </Pressable>
                  <Pressable style={[styles.workspaceCreateButton, !canCreate && styles.workspaceCreateButtonDisabled]} onPress={createWorkspace} disabled={!canCreate}>
                    <Text style={styles.workspaceCreateText}>{creating ? '创建中' : '创建工作区'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </GlassCard>
      </View>
    </Modal>
  )
}

function ArtifactDetailModal({
  artifact,
  projectId,
  onClose,
  onRefresh,
}: {
  artifact: ArtifactView | null
  projectId: string
  onClose: () => void
  onRefresh?: () => void
}) {
  const [deliverySummary, setDeliverySummary] = useState<ProjectDeliverySummary | undefined>()
  const [previewCapability, setPreviewCapability] = useState<ProjectPreviewCapability | undefined>()
  const [artifactAction, setArtifactAction] = useState<'delivery' | 'preview' | 'save' | 'build' | 'deploy' | 'apply' | undefined>()
  const [artifactError, setArtifactError] = useState('')
  const [artifactNotice, setArtifactNotice] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadArtifactContext() {
      if (!artifact) return
      setArtifactError('')
      setArtifactNotice('')
      try {
        const [delivery, capability] = await Promise.all([
          fetchProjectDeliverySummary(projectId).catch(() => undefined),
          fetchProjectPreviewCapability(projectId).catch(() => undefined),
        ])
        if (cancelled) return
        setDeliverySummary(delivery)
        setPreviewCapability(capability)
      } catch {
        if (!cancelled) {
          setDeliverySummary(undefined)
          setPreviewCapability(undefined)
        }
      }
    }

    void loadArtifactContext()
    return () => {
      cancelled = true
    }
  }, [artifact?.id, projectId])

  if (!artifact) return null

  const sourceUrl = artifact.type === 'zip'
    ? artifact.url
    : absoluteArtifactUrl(deliverySummary?.sourceArchive.url)
  const buildUrl = absoluteArtifactUrl(deliverySummary?.build.url)
  const deploymentUrl = artifact.type === 'deploy'
    ? artifact.url
    : absoluteArtifactUrl(deliverySummary?.deployment.url)
  const capabilityPreviewUrl =
    absoluteArtifactUrl(previewCapability?.targets.find(target => target.path === previewCapability.defaultTargetPath)?.url) ??
    absoluteArtifactUrl(previewCapability?.targets[0]?.url)
  const latestDeliveryPreviewUrl = buildUrl ?? deploymentUrl ?? capabilityPreviewUrl
  const previewTargetUrl = isDeliveryPreviewArtifact(artifact)
    ? latestDeliveryPreviewUrl ?? artifact.url
    : artifact.url ?? latestDeliveryPreviewUrl
  const statusRows = [
    {
      label: '源码快照',
      value: deliverySummary?.sourceArchive.summary ?? '暂未读取',
      icon: 'source-branch' as IconName,
    },
    {
      label: '构建产物',
      value: deliverySummary?.build.summary ?? previewCapability?.build?.summary ?? '暂未读取',
      icon: 'hammer-wrench' as IconName,
    },
    {
      label: '本地部署',
      value: deliverySummary?.deployment.summary ?? '暂未读取',
      icon: 'cloud-upload-outline' as IconName,
    },
  ]
  const files = artifact.files ?? []
  const issues = artifact.issues ?? []

  async function runArtifactAction(action: NonNullable<typeof artifactAction>, task: () => Promise<unknown>, notice: string) {
    setArtifactAction(action)
    setArtifactError('')
    setArtifactNotice('')
    try {
      await task()
      const nextDelivery = await fetchProjectDeliverySummary(projectId).catch(() => undefined)
      const nextCapability = await fetchProjectPreviewCapability(projectId).catch(() => undefined)
      setDeliverySummary(nextDelivery)
      setPreviewCapability(nextCapability)
      setArtifactNotice(notice)
      onRefresh?.()
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : '操作失败。')
    } finally {
      setArtifactAction(undefined)
    }
  }

  function openUrl(url?: string) {
    if (!url) return
    void Linking.openURL(url)
  }

  function copyText(value?: string) {
    if (!value) return
    void Clipboard.setStringAsync(value)
    setArtifactNotice('已复制到剪贴板')
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalScrim} onPress={onClose} />
        <GlassCard style={styles.artifactDetailSheet}>
          <View style={styles.artifactDetailHandle} />
          <View style={styles.artifactDetailHead}>
            <View style={styles.artifactDetailTitleRow}>
              <View style={styles.artifactDetailIcon}>
                <MaterialCommunityIcons name={artifact.icon} size={26} color="#2563eb" />
              </View>
              <View style={styles.artifactDetailTitleCopy}>
                <Text style={styles.homeWorkspaceEyebrow}>ARTIFACT DETAIL</Text>
                <Text style={styles.artifactDetailTitle}>{artifact.title}</Text>
              </View>
            </View>
            <Pressable style={styles.artifactCloseButton} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color="#0f172a" />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.artifactDetailContent}>
            <View style={styles.artifactHeroBlock}>
              <View style={styles.artifactHeroStatusLine}>
                <Text style={styles.artifactHeroMetric}>{artifact.metric}</Text>
                <View style={[styles.artifactStatusBadge, artifact.status === 'ready' && styles.artifactStatusReady, artifact.status === 'partial' && styles.artifactStatusPartial]}>
                  <Text style={[styles.artifactStatusText, artifact.status === 'ready' && styles.artifactStatusReadyText, artifact.status === 'partial' && styles.artifactStatusPartialText]}>{artifact.statusLabel}</Text>
                </View>
              </View>
              <Text style={styles.artifactHeroSummary}>{artifact.summary}</Text>
            </View>

            {artifactNotice ? (
              <View style={styles.artifactNotice}>
                <MaterialCommunityIcons name="check-circle-outline" size={18} color="#059669" />
                <Text style={styles.artifactNoticeText}>{artifactNotice}</Text>
              </View>
            ) : null}
            {artifactError ? (
              <View style={[styles.artifactNotice, styles.artifactNoticeError]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#dc2626" />
                <Text style={[styles.artifactNoticeText, styles.artifactNoticeErrorText]}>{artifactError}</Text>
              </View>
            ) : null}

            {previewTargetUrl ? (
              <View style={styles.artifactSection}>
                <View style={styles.artifactSectionHeader}>
                  <Text style={styles.sectionTitle}>预览</Text>
                  <Pressable style={styles.artifactSmallButton} onPress={() => openUrl(previewTargetUrl)}>
                    <Text style={styles.artifactSmallButtonText}>外部打开</Text>
                    <MaterialCommunityIcons name="open-in-new" size={14} color="#2563eb" />
                  </Pressable>
                </View>
                <View style={styles.artifactWebPreview}>
                  <WebView source={{ uri: previewTargetUrl }} style={styles.artifactWebView} startInLoadingState />
                </View>
                <Text style={styles.bodyText} numberOfLines={2}>{previewTargetUrl}</Text>
              </View>
            ) : null}

            {artifact.type === 'diff' ? (
              <View style={styles.artifactSection}>
                <View style={styles.artifactSectionHeader}>
                  <Text style={styles.sectionTitle}>代码 Diff</Text>
                  {artifact.changeSetId ? (
                    <Pressable
                      style={styles.artifactSmallButton}
                      onPress={() => runArtifactAction(
                        'apply',
                        () => applyProjectChangeSet(projectId, artifact.changeSetId as string),
                        '已提交应用 Diff 请求',
                      )}
                      disabled={artifactAction === 'apply'}
                    >
                      <Text style={styles.artifactSmallButtonText}>{artifactAction === 'apply' ? '应用中' : '应用'}</Text>
                    </Pressable>
                  ) : null}
                </View>
                {files.length ? (
                  <View style={styles.artifactFileList}>
                    {files.slice(0, 8).map(file => (
                      <View key={file.path} style={styles.artifactFileRow}>
                        <MaterialCommunityIcons name="file-code-outline" size={18} color="#2563eb" />
                        <View style={styles.artifactFileCopy}>
                          <Text style={styles.cardTitle} numberOfLines={1}>{file.path}</Text>
                          <Text style={styles.bodyText}>{file.status} · +{file.additions ?? 0} / -{file.deletions ?? 0}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
                {artifact.patch ? (
                  <Pressable style={styles.artifactCodeBlock} onPress={() => copyText(artifact.patch)}>
                    <Text style={styles.artifactCodeText}>{artifact.patch}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {artifact.type === 'review' ? (
              <View style={styles.artifactSection}>
                <Text style={styles.sectionTitle}>审查 / 校验</Text>
                {artifact.verdict ? <Text style={styles.artifactHeroMetric}>{artifact.verdict}</Text> : null}
                {issues.length ? (
                  issues.map(issue => (
                    <View key={issue} style={styles.artifactIssueRow}>
                      <MaterialCommunityIcons name="alert-circle-outline" size={17} color="#f59e0b" />
                      <Text style={styles.bodyText}>{issue}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.bodyText}>这一轮没有返回额外问题。</Text>
                )}
              </View>
            ) : null}

            {(artifact.type === 'text' || artifact.type === 'artifact' || artifact.type === 'deploy') && artifact.detailText ? (
              <View style={styles.artifactSection}>
                <Text style={styles.sectionTitle}>正文</Text>
                <Text style={styles.artifactHeroSummary}>{artifact.detailText}</Text>
              </View>
            ) : null}

            <View style={styles.artifactSection}>
              <Text style={styles.sectionTitle}>交付状态</Text>
              {statusRows.map(row => (
                <View key={row.label} style={styles.deliveryStatusRow}>
                  <MaterialCommunityIcons name={row.icon} size={19} color="#475569" />
                  <Text style={styles.deliveryStatusLabel}>{row.label}</Text>
                  <Text style={styles.deliveryStatusValue}>{row.value}</Text>
                </View>
              ))}
              <View style={styles.artifactActionGrid}>
                <Pressable
                  style={styles.deliveryOutlineButton}
                  onPress={() => runArtifactAction(
                    'save',
                    () => createProjectVersion(projectId, `App 保存源码版本 ${new Date().toLocaleString('zh-CN', { hour12: false })}`),
                    '源码版本已保存',
                  )}
                  disabled={Boolean(artifactAction)}
                >
                  <Text style={styles.deliveryOutlineText}>{artifactAction === 'save' ? '保存中' : '保存版本'}</Text>
                </Pressable>
                <Pressable
                  style={styles.deliveryPrimaryButton}
                  onPress={() => runArtifactAction(
                    'build',
                    async () => {
                      const version = await createProjectVersion(projectId, 'App 自动保存构建版本')
                      return buildProjectVersion(projectId, version.versionId)
                    },
                    '构建请求已完成',
                  )}
                  disabled={Boolean(artifactAction)}
                >
                  <Text style={styles.deliveryPrimaryText}>{artifactAction === 'build' ? '构建中' : '开始构建'}</Text>
                </Pressable>
              </View>
              <View style={styles.artifactActionGrid}>
                <Pressable
                  style={styles.deliveryGreenButton}
                  onPress={() => runArtifactAction(
                    'deploy',
                    async () => {
                      const version = await createProjectVersion(projectId, 'App 自动保存部署版本')
                      await buildProjectVersion(projectId, version.versionId)
                      return deployProjectVersion(projectId, version.versionId)
                    },
                    '部署请求已完成',
                  )}
                  disabled={Boolean(artifactAction)}
                >
                  <Text style={styles.deliveryGreenText}>{artifactAction === 'deploy' ? '部署中' : '部署'}</Text>
                  <MaterialCommunityIcons name="cloud-upload-outline" size={15} color="#22c59e" />
                </Pressable>
                <Pressable
                  style={styles.deliveryOutlineButton}
                  onPress={() => runArtifactAction(
                    'preview',
                    () => triggerProjectPreviewBuild(projectId, true),
                    '预览构建已刷新',
                  )}
                  disabled={Boolean(artifactAction)}
                >
                  <Text style={styles.deliveryOutlineText}>{artifactAction === 'preview' ? '刷新中' : '刷新预览'}</Text>
                </Pressable>
              </View>
              {(sourceUrl || buildUrl || deploymentUrl) ? (
                <View style={styles.artifactLinkRow}>
                  {sourceUrl ? <Pressable style={styles.artifactLinkButton} onPress={() => openUrl(sourceUrl)}><Text style={styles.artifactLinkText}>源码包</Text></Pressable> : null}
                  {buildUrl ? <Pressable style={styles.artifactLinkButton} onPress={() => openUrl(buildUrl)}><Text style={styles.artifactLinkText}>构建产物</Text></Pressable> : null}
                  {deploymentUrl ? <Pressable style={styles.artifactLinkButton} onPress={() => openUrl(deploymentUrl)}><Text style={styles.artifactLinkText}>部署入口</Text></Pressable> : null}
                </View>
              ) : null}
            </View>
          </ScrollView>
        </GlassCard>
      </View>
    </Modal>
  )
}

function CodeScreen({ layoutTier }: { layoutTier: LayoutTier }) {
  const isCompact = layoutTier === 'compact'

  return (
    <View style={styles.codeScreen}>
      <GlassCard compact style={styles.codeSegment}>
        <View style={styles.codeSegmentItemActive}>
          <MaterialCommunityIcons name="code-tags" size={20} color="#2563eb" />
          <Text style={styles.codeSegmentTextActive}>文件</Text>
        </View>
        <View style={styles.codeSegmentDivider} />
        <View style={styles.codeSegmentItem}>
          <MaterialCommunityIcons name="source-branch" size={20} color="#64748b" />
          <Text style={styles.codeSegmentText}>Diff</Text>
        </View>
        <View style={styles.codeSegmentDivider} />
        <View style={styles.codeSegmentItem}>
          <MaterialCommunityIcons name="eye-outline" size={21} color="#64748b" />
          <Text style={styles.codeSegmentText}>预览</Text>
        </View>
      </GlassCard>

      <GlassCard style={styles.codePanel}>
        <View style={styles.codePanelHead}>
          <View style={styles.codePanelTitleRow}>
            <Text style={styles.codePanelTitle}>文件树</Text>
            <View style={styles.diffBadge}>
              <Text style={styles.diffAdd}>+428</Text>
              <Text style={styles.diffSlash}> / </Text>
              <Text style={styles.diffRemove}>-0</Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-up" size={25} color="#475569" />
        </View>
        {codeFiles.map(file => (
          <View key={file.path} style={styles.codeFileRow}>
            <View style={[styles.fileTypeIcon, file.language === 'png' && styles.fileImageIcon]}>
              <Text style={styles.fileTypeText}>{file.language === 'png' ? '' : file.language.toUpperCase()}</Text>
              {file.language === 'png' ? <MaterialCommunityIcons name="image-outline" size={22} color="#42cfa6" /> : null}
            </View>
            <View style={styles.fileCopy}>
              <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
              <Text style={styles.fileMeta}>{file.language}{file.lines ? ` · ${file.lines} lines` : ''}</Text>
            </View>
            <View style={styles.fileStatusWrap}>
              <View style={[styles.fileStatusDot, file.changed === 'added' && styles.fileStatusAdded, file.changed === 'modified' && styles.fileStatusModified]} />
              <Text style={[styles.fileStatusText, file.changed === 'added' && styles.changeAdded, file.changed === 'modified' && styles.changeModified]}>
                {file.changed}
              </Text>
            </View>
            <MaterialCommunityIcons name="dots-horizontal" size={21} color="#64748b" />
          </View>
        ))}
      </GlassCard>

      <GlassCard style={[styles.previewShowcase, isCompact && styles.previewShowcaseCompact]}>
        <View style={styles.codePanelTitleRow}>
          <Text style={styles.codePanelTitle}>移动首页预览</Text>
        </View>
        <View style={styles.previewStage}>
          <Pressable style={styles.previewArrow}>
            <MaterialCommunityIcons name="chevron-left" size={25} color="#64748b" />
          </Pressable>
          <View style={styles.previewPhoneMini}>
            <View style={styles.miniStatusBar} />
            <View style={styles.miniHeaderLine}>
              <AgentGlyph agentId="orchestrator" size={18} />
              <Text style={styles.miniTinyText}>多 Agent 协作工作台</Text>
            </View>
            <Text style={styles.miniGreeting}>Hi, Susanna</Text>
            <Text style={styles.miniTitle}>很高兴为您服务</Text>
            <View style={styles.miniStatsRow}>
              <View style={styles.miniStat} />
              <View style={styles.miniStat} />
              <View style={styles.miniStat} />
            </View>
            <View style={styles.miniListBlock} />
            <View style={styles.miniNav}>
              <MaterialCommunityIcons name="home-variant" size={10} color="#fff" />
              <MaterialCommunityIcons name="layers-outline" size={10} color="#fff" />
              <Text style={styles.miniAi}>AI</Text>
              <MaterialCommunityIcons name="message-text-outline" size={10} color="#fff" />
              <MaterialCommunityIcons name="account-outline" size={10} color="#fff" />
            </View>
          </View>
          <Pressable style={styles.previewArrow}>
            <MaterialCommunityIcons name="chevron-right" size={25} color="#334155" />
          </Pressable>
        </View>
        <View style={styles.previewDots}>
          <View style={styles.previewDotActive} />
          <View style={styles.previewDot} />
          <View style={styles.previewDot} />
          <View style={styles.previewDot} />
        </View>
      </GlassCard>

      <GlassCard style={styles.deliveryStatusPanel}>
        <Text style={styles.codePanelTitle}>交付状态</Text>
        <View style={[styles.deliveryStatusGrid, isCompact && styles.deliveryStatusGridCompact]}>
          <DeliveryStatusCard icon="layers-triple" title="源码快照" status="ready" body="v0.1.0 已保存" time="今天 09:36" tone="blue" />
          <DeliveryStatusCard icon="cube-outline" title="构建产物" status="running" body="等待 RN 依赖安装后检查" time="今天 09:41" tone="purple" />
          <DeliveryStatusCard icon="cloud-upload-outline" title="部署入口" status="idle" body="移动端 mock 阶段暂不部署" time="-" tone="green" />
        </View>
        <View style={[styles.deliveryActionRow, isCompact && styles.deliveryActionRowCompact]}>
          <Pressable style={styles.deliveryOutlineButton}>
            <Text style={styles.deliveryOutlineText}>保存版本</Text>
          </Pressable>
          <Pressable style={styles.deliveryPrimaryButton}>
            <Text style={styles.deliveryPrimaryText}>开始构建</Text>
          </Pressable>
          <Pressable style={styles.deliveryGreenButton}>
            <Text style={styles.deliveryGreenText}>打开预览</Text>
            <MaterialCommunityIcons name="open-in-new" size={15} color="#22c59e" />
          </Pressable>
        </View>
      </GlassCard>
    </View>
  )
}

function DeliveryStatusCard({ icon, title, status, body, time, tone }: { icon: IconName; title: string; status: string; body: string; time: string; tone: 'blue' | 'purple' | 'green' }) {
  return (
    <View style={styles.deliveryStatusCard}>
      <View style={[styles.deliveryStatusIcon, tone === 'purple' && styles.deliveryStatusIconPurple, tone === 'green' && styles.deliveryStatusIconGreen]}>
        <MaterialCommunityIcons name={icon} size={28} color={tone === 'purple' ? '#9b6cf0' : tone === 'green' ? '#22c59e' : '#3d74ff'} />
      </View>
      <Text style={styles.deliveryStatusTitle}>{title}</Text>
      <View style={styles.deliveryStatusPill}>
        <Text style={[styles.deliveryStatusPillText, status === 'running' && styles.deliveryStatusRunning, status === 'idle' && styles.deliveryStatusIdle]}>{status}</Text>
      </View>
      <Text style={styles.deliveryStatusBody}>{body}</Text>
      <Text style={styles.deliveryStatusTime}>{time}</Text>
    </View>
  )
}

function AgentScreen({
  layoutTier,
  mobileScale,
  createSignal,
  registryTitle,
  canCreate,
  workspace,
  projectAgents,
  loading,
  onShowError,
}: {
  layoutTier: LayoutTier
  mobileScale: MobileScale
  createSignal: number
  registryTitle: string
  canCreate: boolean
  workspace: Workspace
  projectAgents: ProjectAgent[]
  loading: boolean
  onShowError: (input: Omit<BackendRetryDialogState, 'visible'>) => void
}) {
  const showFullRegistry = layoutTier === 'wide'
  const loadedAgents = useMemo(
    () => projectAgents.map(mapProjectAgentToAgentView),
    [projectAgents],
  )
  const [visibleAgents, setVisibleAgents] = useState<AgentView[]>(loadedAgents)
  const [selectedAgent, setSelectedAgent] = useState<AgentView | null>(null)
  const [editingAgent, setEditingAgent] = useState<AgentView | null>(null)
  const [agentConfigOpen, setAgentConfigOpen] = useState(false)
  const [agentActionState, setAgentActionState] = useState<AgentActionState>(null)
  const agentActionBusyRef = useRef(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AgentFilter>('all')
  const runningCount = visibleAgents.filter(agent => agent.status !== 'idle').length
  const builtinCount = visibleAgents.filter(isBuiltInAgentView).length
  const agentSearch = useMemo(
    () => new Fuse<AgentView>(visibleAgents, { keys: ['name', 'role', 'provider', 'skills', 'source', 'model', 'description', 'whenToUse'], threshold: 0.34 }),
    [visibleAgents],
  )
  const searchedAgents = query.trim() ? agentSearch.search(query.trim()).map(result => result.item) : visibleAgents
  const filteredAgents = searchedAgents.filter(agent => {
    if (filter === 'all') return true
    if (filter === 'builtin') return isBuiltInAgentView(agent)
    return agent.status === filter
  })
  const refreshAgentFromResponse = (response: ProjectAgent) => {
    setVisibleAgents(current => {
      const nextAgentView = mapProjectAgentToAgentView(response, current.length)
      return current.some(agent => agent.id === nextAgentView.id)
        ? current.map(agent => (agent.id === nextAgentView.id ? nextAgentView : agent))
        : [...current, nextAgentView]
    })
  }
  const beginAgentAction = (state: NonNullable<AgentActionState>) => {
    if (agentActionBusyRef.current) return false
    agentActionBusyRef.current = true
    setAgentActionState(state)
    return true
  }
  const finishAgentAction = () => {
    agentActionBusyRef.current = false
    setAgentActionState(null)
  }
  const createAgent = async (input: CreateProjectAgentInput) => {
    if (!canCreate) return
    if (!beginAgentAction({ type: 'create' })) return
    const projectId = workspace.projectId ?? workspace.id
    try {
      const response = await createProjectAgent(projectId, input)
      refreshAgentFromResponse(response)
      setSelectedAgent(null)
      setAgentConfigOpen(false)
    } catch (error) {
      onShowError({
        title: '新建 Agent 失败',
        message: '只有群聊工作区可以创建自定义 Agent，请确认接口状态后重试。',
        detail: error instanceof Error ? error.message : '创建失败',
        onRetry: () => {
          void createAgent(input)
        },
      })
    } finally {
      finishAgentAction()
    }
  }
  const deleteAgent = async (agent: AgentView) => {
    if (isBuiltInAgentView(agent)) return
    if (!beginAgentAction({ type: 'delete', agentId: agent.id })) return
    const projectId = workspace.projectId ?? workspace.id
    try {
      await deleteProjectAgent(projectId, agent.id)
      setVisibleAgents(current => current.filter(item => item.id !== agent.id))
      if (selectedAgent?.id === agent.id) setSelectedAgent(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('404')) {
        setVisibleAgents(current => current.filter(item => item.id !== agent.id))
        if (selectedAgent?.id === agent.id) setSelectedAgent(null)
        return
      }
      onShowError({
        title: '删除 Agent 失败',
        message: '只有自定义 Agent 可以删除，请确认接口状态后重试。',
        detail: message || '删除失败',
        onRetry: () => {
          void deleteAgent(agent)
        },
      })
    } finally {
      finishAgentAction()
    }
  }
  const saveAgent = async (nextAgent: AgentView, input: UpdateProjectAgentInput) => {
    if (isBuiltInAgentView(nextAgent)) return
    if (!beginAgentAction({ type: 'save', agentId: nextAgent.id })) return
    const projectId = workspace.projectId ?? workspace.id
    try {
      const response = await updateProjectAgent(projectId, nextAgent.id, input)
      refreshAgentFromResponse(response)
      setSelectedAgent(null)
      setAgentConfigOpen(false)
    } catch (error) {
      onShowError({
        title: '编辑 Agent 失败',
        message: '无法保存当前自定义 Agent，请稍后重试。',
        detail: error instanceof Error ? error.message : '保存失败',
        onRetry: () => {
          void saveAgent(nextAgent, input)
        },
      })
    } finally {
      finishAgentAction()
    }
  }

  useEffect(() => {
    setVisibleAgents(loadedAgents)
    setSelectedAgent(null)
  }, [loadedAgents])

  useEffect(() => {
    if (createSignal === 0 || !canCreate) return
    setEditingAgent(null)
    setSelectedAgent(null)
    setAgentConfigOpen(true)
  }, [canCreate, createSignal])

  if (agentConfigOpen) {
    return (
      <AgentConfigPage
        agent={editingAgent}
        saving={agentActionState?.type === 'create' || agentActionState?.type === 'save'}
        onBack={() => setAgentConfigOpen(false)}
        onSave={saveAgent}
        onCreate={createAgent}
      />
    )
  }

  return (
    <View style={styles.agentScreen}>
      <GlassCard style={[styles.agentSummary, !showFullRegistry && styles.agentSummaryCompact]}>
        <View style={[styles.agentSummaryHero, !showFullRegistry && styles.agentSummaryHeroCompact]}>
          <View style={[styles.registryIcon, { width: mobileScale.workspaceCardIcon, height: mobileScale.workspaceCardIcon, borderRadius: Math.round(mobileScale.workspaceCardIcon * 0.27) }]}>
            <MaterialCommunityIcons name="layers-triple" size={Math.round(mobileScale.workspaceCardIcon * 0.44)} color="#5572ff" />
          </View>
          <View style={styles.registryCopy}>
            <Text style={[styles.registryTitle, { fontSize: mobileScale.registryTitle }]} numberOfLines={1}>{registryTitle}</Text>
            <Text style={[styles.agentSummaryText, { fontSize: mobileScale.bodyText, lineHeight: mobileScale.bodyLineHeight }]}>管理模型、提示词、工具权限和上下文策略</Text>
          </View>
        </View>
        {showFullRegistry ? (
          <View style={styles.agentMetricRow}>
            <View style={styles.agentMetricBox}>
              <Text style={styles.agentMetricValue}>{visibleAgents.length}</Text>
              <Text style={styles.agentMetricLabel}>Agents</Text>
            </View>
            <View style={styles.agentMetricBox}>
              <View style={styles.metricValueLine}>
                <View style={styles.metricDot} />
                <Text style={styles.agentMetricValue}>{runningCount}</Text>
              </View>
              <Text style={styles.agentMetricLabel}>运行中</Text>
            </View>
            <View style={styles.agentMetricBox}>
              <View style={styles.metricValueLine}>
                <MaterialCommunityIcons name="cube-outline" size={26} color="#7658d8" />
                <Text style={styles.agentMetricValue}>{builtinCount}</Text>
              </View>
              <Text style={styles.agentMetricLabel}>内置</Text>
            </View>
          </View>
        ) : null}
      </GlassCard>

      <View style={[styles.agentSearchRow, layoutTier === 'compact' && styles.agentSearchRowCompact]}>
        <GlassCard compact style={styles.agentSearchBox}>
          <MaterialCommunityIcons name="magnify" size={22} color="#64748b" />
          <TextInput
            placeholder="搜索 Agent"
            placeholderTextColor="#94a3b8"
            value={query}
            onChangeText={setQuery}
            style={styles.agentSearchInput}
          />
        </GlassCard>
        <GlassCard compact style={styles.agentFilterButton}>
          <MaterialCommunityIcons name="filter-outline" size={21} color="#475569" />
          <Text style={styles.agentFilterText}>{filter === 'all' ? '全部状态' : filter === 'running' ? '运行中' : filter === 'reviewing' ? '审查中' : filter === 'idle' ? '空闲' : '内置'}</Text>
          <MaterialCommunityIcons name="menu-down" size={19} color="#64748b" />
        </GlassCard>
      </View>

      <View style={styles.agentFilterChips}>
        {[
          { key: 'all' as AgentFilter, label: '全部', icon: 'apps' as IconName },
          { key: 'running' as AgentFilter, label: '运行中', icon: 'play-circle-outline' as IconName },
          { key: 'reviewing' as AgentFilter, label: '审查中', icon: 'shield-check-outline' as IconName },
          { key: 'idle' as AgentFilter, label: '空闲', icon: 'sleep' as IconName },
          { key: 'builtin' as AgentFilter, label: '内置', icon: 'layers-triple' as IconName },
        ].map(item => (
          <Pressable key={item.key} onPress={() => setFilter(item.key)}>
            <Pill label={item.label} tone={filter === item.key ? 'blue' : 'muted'} icon={item.icon} />
          </Pressable>
        ))}
      </View>
      {loading && visibleAgents.length > 0 ? (
        <GlassCard style={styles.agentLoadingCard}>
          <ActivityIndicator size="small" color="#2563eb" />
          <Text style={styles.agentLoadingText}>正在同步 Agent...</Text>
        </GlassCard>
      ) : null}

      {filteredAgents.map(agent => (
        <AgentCard
          key={agent.id}
          agent={agent}
          layoutTier={layoutTier}
          mobileScale={mobileScale}
          deleting={agentActionState?.type === 'delete' && agentActionState.agentId === agent.id}
          actionsDisabled={Boolean(agentActionState)}
          onPress={() => setSelectedAgent(agent)}
          onDelete={() => void deleteAgent(agent)}
        />
      ))}
      {filteredAgents.length === 0 ? (
        <GlassCard style={styles.emptyStateCard}>
          {loading ? (
            <ActivityIndicator size="small" color="#2563eb" />
          ) : (
            <MaterialCommunityIcons name="account-search-outline" size={28} color="#64748b" />
          )}
          <Text style={styles.cardTitle}>{loading ? '正在加载 Agent' : '没有匹配的 Agent'}</Text>
          <Text style={styles.bodyText}>{loading ? '正在请求当前工作区的 Agent 接口。' : '换一个关键词或状态筛选试试。'}</Text>
        </GlassCard>
      ) : null}
      <Text style={styles.agentLoadedText}>已显示 {filteredAgents.length} / {visibleAgents.length} 个 Agent</Text>
      <AgentDetailModal
        agent={selectedAgent}
        mobileScale={mobileScale}
        onClose={() => setSelectedAgent(null)}
        onEdit={agent => {
          setEditingAgent(agent)
          setSelectedAgent(null)
          setAgentConfigOpen(true)
        }}
      />
    </View>
  )
}

function AppMenuDrawer({ visible, activeTab, mobileScale, onClose, onChange }: { visible: boolean; activeTab: TabKey; mobileScale: MobileScale; onClose: () => void; onChange: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.appMenuBackdrop}>
        <Pressable style={styles.appMenuScrim} onPress={onClose} />
        <GlassCard style={[styles.appMenuPanel, { paddingTop: insets.top + 14 }]}>
          <View style={styles.appMenuHead}>
            <AgentGlyph agentId="orchestrator" size={mobileScale.headerAvatar} />
            <View style={styles.appMenuHeadCopy}>
              <Text style={styles.homeWorkspaceEyebrow}>AGENTHUB</Text>
              <Text style={[styles.appMenuTitle, { fontSize: mobileScale.panelTitle }]}>页面切换</Text>
            </View>
          </View>
          <View style={styles.appMenuList}>
            {tabs.map(tab => {
              const active = tab.key === activeTab
              return (
                <Pressable key={tab.key} style={[styles.appMenuRow, active && styles.appMenuRowActive]} onPress={() => onChange(tab.key)}>
                  <View style={[styles.appMenuIcon, active && styles.appMenuIconActive]}>
                    <MaterialCommunityIcons name={tab.icon} size={20} color={active ? '#fff' : '#94a3b8'} />
                  </View>
                  <Text style={[styles.appMenuRowText, { fontSize: mobileScale.bodyText }, active && styles.appMenuRowTextActive]} numberOfLines={1}>{tab.label}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={active ? '#dbeafe' : '#64748b'} />
                </Pressable>
              )
            })}
          </View>
        </GlassCard>
      </View>
    </Modal>
  )
}

function StatCard({ label, value, icon, tone, active = false }: { label: string; value: string; icon: IconName; tone: string; active?: boolean }) {
  return (
    <GlassCard style={[styles.statCard, active && styles.statCardActive]}>
      <View style={styles.statIcon}>
        <MaterialCommunityIcons name={icon} size={24} color={tone} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </GlassCard>
  )
}

function Feature({ icon, label }: { icon: IconName; label: string }) {
  return (
    <GlassCard style={styles.featureCard}>
      <View style={styles.featureIcon}>
        <MaterialCommunityIcons name={icon} size={24} color="#0f172a" />
      </View>
      <Text style={styles.featureLabel}>{label}</Text>
    </GlassCard>
  )
}

function WorkspaceCard({
  workspace,
  agentList,
  layoutTier,
  mobileScale,
  pinBusy,
  archiveBusy,
  actionsDisabled,
  onPress,
  onTogglePin,
  onToggleArchive,
}: {
  workspace: Workspace
  agentList?: ProjectAgent[]
  layoutTier: LayoutTier
  mobileScale: MobileScale
  pinBusy?: boolean
  archiveBusy?: boolean
  actionsDisabled?: boolean
  onPress?: () => void
  onTogglePin?: () => void
  onToggleArchive?: () => void
}) {
  const isCompact = layoutTier === 'compact'
  const iconName = workspace.kind === 'group' ? 'school-outline' : 'account-group-outline'
  const typeLabel = workspace.type === 'dev' ? 'dev' : workspace.type === 'chat' ? 'chat' : workspace.type === 'research' ? 'research' : 'writing'
  const statusLabel = workspace.status === 'running' ? '运行中' : workspace.status === 'ready' ? 'ready' : 'failed'
  const primaryLabel = workspace.id === 'ws-campus' ? '主工作区' : workspace.type
  const workspaceAgents = getVisibleChatAgents(workspace, agentList ?? [])
  const extraAgents = Math.max(0, workspaceAgents.length - 4)
  const pinDisabled = actionsDisabled || !onTogglePin
  const archiveDisabled = actionsDisabled || !onToggleArchive

  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      <GlassCard style={[styles.workspaceCard, isCompact && styles.workspaceCardCompact]}>
      <View style={styles.workspaceTopRow}>
        <LinearGradient colors={workspace.kind === 'group' ? ['#4f8dfc', '#6ea5ff'] : ['#8f71f6', '#a98df8']} start={{ x: 0.08, y: 0.1 }} end={{ x: 1, y: 1 }} style={[styles.workspaceIconTile, { width: mobileScale.workspaceCardIcon, height: mobileScale.workspaceCardIcon, borderRadius: Math.round(mobileScale.workspaceCardIcon * 0.25) }]}>
          <MaterialCommunityIcons name={iconName} size={mobileScale.workspaceCardIconGlyph} color="#fff" />
        </LinearGradient>
        <View style={styles.workspaceTitleWrap}>
          <View style={styles.workspaceTitleRow}>
            <Text style={[styles.workspaceTitle, { fontSize: mobileScale.workspaceCardTitle }]} numberOfLines={1}>{workspace.name}</Text>
            <View style={styles.workspacePrimaryBadge}>
              <Text style={styles.workspacePrimaryText}>{primaryLabel}</Text>
            </View>
          </View>
          <Text style={styles.workspaceGoal} numberOfLines={2}>{workspace.goal}</Text>
          <View style={styles.workspaceStatRow}>
            <View style={styles.workspaceStatChip}>
              <View style={styles.workspaceRunningDot} />
              <Text style={styles.workspaceStatText}>{statusLabel}</Text>
            </View>
            <View style={styles.workspaceStatChip}>
              <MaterialCommunityIcons name="cube-outline" size={15} color="#2563eb" />
              <Text style={styles.workspaceStatTextBlue}>{workspace.artifactCount} 产物</Text>
            </View>
            <View style={styles.workspaceStatChip}>
              <MaterialCommunityIcons name="message-text-outline" size={15} color="#7c3aed" />
              <Text style={styles.workspaceStatTextPurple}>{workspace.messageCount} 消息</Text>
            </View>
          </View>
        </View>
        <View style={styles.workspaceActionColumn}>
          <View style={styles.workspaceActionButtons}>
            <Pressable
              style={[styles.workspacePinButton, pinDisabled && styles.workspaceActionButtonDisabled]}
              hitSlop={8}
              disabled={pinDisabled}
              onPress={event => {
                event.stopPropagation()
                onTogglePin?.()
              }}
            >
              {pinBusy ? (
                <ActivityIndicator size="small" color="#d97706" />
              ) : (
                <MaterialCommunityIcons name="pin" size={22} color={workspace.pinned ? '#d97706' : '#c4c9d4'} />
              )}
            </Pressable>
            <Pressable
              style={[
                styles.workspacePinButton,
                workspace.archived && styles.workspaceArchiveButtonActive,
                archiveDisabled && styles.workspaceActionButtonDisabled,
              ]}
              hitSlop={8}
              disabled={archiveDisabled}
              onPress={event => {
                event.stopPropagation()
                onToggleArchive?.()
              }}
            >
              {archiveBusy ? (
                <ActivityIndicator size="small" color="#2563eb" />
              ) : (
                <MaterialCommunityIcons name={workspace.archived ? 'archive-arrow-up-outline' : 'archive-outline'} size={21} color={workspace.archived ? '#2563eb' : '#c4c9d4'} />
              )}
            </Pressable>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={26} color="#64748b" />
        </View>
      </View>
      <View style={styles.workspaceAvatarRow}>
        {workspaceAgents.slice(0, 4).map((agent, index) => (
          <View key={getProjectAgentInstanceKey(agent, index)} style={{ marginLeft: index === 0 ? 0 : -10 }}>
            <AgentGlyph agentId={agent.id} label={agent.name} provider={agent.modelProvider} color={getProjectAgentColor(agent)} size={mobileScale.workspaceAgentAvatar} />
          </View>
        ))}
        {extraAgents > 0 ? (
          <View style={styles.workspaceMoreAvatar}>
            <Text style={styles.workspaceMoreAvatarText}>+{extraAgents}</Text>
          </View>
        ) : null}
        <Text style={styles.workspaceAvatarText}>{workspace.updatedAt} · {workspace.latestEventLabel}</Text>
      </View>
      <View style={styles.workspaceEventRow}>
        <View style={styles.workspaceEventLeft}>
          <MaterialCommunityIcons name="clock-outline" size={18} color="#64748b" />
          <Text style={styles.workspaceEventLabel}>最新事件</Text>
          <Text style={styles.workspaceEventTime}>{workspace.updatedAt}</Text>
          <Text style={styles.workspaceEventText} numberOfLines={1}>{workspace.latestEventLabel}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color="#64748b" />
      </View>
      </GlassCard>
    </Pressable>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.sender === 'user'
  const agent = message.agentId ? agents.find(item => item.id === message.agentId) : undefined
  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      {!isUser ? <AgentGlyph agentId={message.agentId ?? 'orchestrator'} size={34} /> : null}
      <View style={[styles.messageStack, isUser && styles.messageStackUser]}>
        {!isUser ? <Text style={styles.messageMeta}>{agent?.name ?? 'Agent'} · {message.time}</Text> : null}
        <GlassCard style={[styles.bubble, isUser ? styles.userBubble : undefined]}>
          {message.quote ? <Text style={styles.quoteText}>{message.quote}</Text> : null}
          <Text style={styles.messageText}>{message.text}</Text>
        </GlassCard>
        {message.process ? <ProcessStrip steps={message.process} /> : null}
        {message.artifacts ? <ArtifactStrip artifacts={message.artifacts} /> : null}
      </View>
    </View>
  )
}

function ProcessStrip({ steps }: { steps: { title: string; summary: string; status: string; icon: IconName }[] }) {
  return (
    <GlassCard style={styles.processCard}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>本轮过程</Text>
        <Pill label="展开" tone="blue" icon="chevron-down" />
      </View>
      {steps.map(step => (
        <View key={step.title} style={styles.processRow}>
          <MaterialCommunityIcons name={step.icon} size={18} color={step.status === 'running' ? '#2563eb' : '#475569'} />
          <View style={styles.processCopy}>
            <Text style={styles.cardTitle}>{step.title}</Text>
            <Text style={styles.bodyText}>{step.summary}</Text>
          </View>
        </View>
      ))}
    </GlassCard>
  )
}

function ArtifactStrip({ artifacts: items }: { artifacts: Artifact[] }) {
  return (
    <View style={styles.artifactGrid}>
      {items.map(item => (
        <GlassCard key={item.id} style={styles.artifactCard}>
          <MaterialCommunityIcons name={item.icon} size={22} color="#2563eb" />
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.bodyText} numberOfLines={2}>{item.summary}</Text>
          <Text style={styles.artifactMetric}>{item.metric}</Text>
        </GlassCard>
      ))}
    </View>
  )
}

function AgentDetailModal({ agent, mobileScale, onClose, onEdit }: { agent: AgentView | null; mobileScale: MobileScale; onClose: () => void; onEdit: (agent: AgentView) => void }) {
  if (!agent) return null

  const isBuiltin = isBuiltInAgentView(agent)
  const statusLabel = agent.status === 'running' ? '运行中' : agent.status === 'reviewing' ? '审查中' : '空闲中'

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalScrim} onPress={onClose} />
        <GlassCard style={styles.agentDetailSheet}>
          <View style={styles.artifactDetailHandle} />
          <View style={styles.artifactDetailHead}>
            <View style={styles.agentDetailTitleRow}>
              <AgentGlyph agentId={agent.id} size={mobileScale.agentDetailAvatar} />
              <View style={styles.artifactDetailTitleCopy}>
                <Text style={styles.homeWorkspaceEyebrow}>{isBuiltin ? 'DEFAULT AGENT' : 'CUSTOM AGENT'}</Text>
                <Text style={styles.artifactDetailTitle}>{agent.name}</Text>
              </View>
            </View>
            <Pressable style={styles.artifactCloseButton} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color="#0f172a" />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.artifactDetailContent}>
            <View style={styles.agentDetailStatusRow}>
              <View style={[styles.agentStatusBadge, styles[agent.status === 'running' ? 'running' : agent.status === 'reviewing' ? 'reviewing' : 'idle']]}>
                <View style={[styles.agentStatusDot, styles[`${agent.status === 'running' ? 'running' : agent.status === 'reviewing' ? 'reviewing' : 'idle'}Dot`]]} />
                <Text style={[styles.agentStatusText, styles[`${agent.status === 'running' ? 'running' : agent.status === 'reviewing' ? 'reviewing' : 'idle'}Text`]]}>{statusLabel}</Text>
              </View>
              <View style={styles.homeMetaChip}>
                <Text style={styles.homeMetaTextBlue}>{agent.provider}</Text>
              </View>
              <View style={styles.homeMetaChip}>
                <Text style={styles.homeMetaTextGray}>{agent.model ?? 'default'}</Text>
              </View>
              <View style={styles.homeMetaChip}>
                <Text style={styles.homeMetaTextGray}>{agent.id}</Text>
              </View>
            </View>

            <View style={styles.artifactSection}>
              <Text style={styles.sectionTitle}>角色说明</Text>
              <Text style={styles.artifactHeroSummary}>{agent.role}</Text>
            </View>

            {agent.description ? (
              <View style={styles.artifactSection}>
                <Text style={styles.sectionTitle}>description</Text>
                <Text style={styles.artifactHeroSummary}>{agent.description}</Text>
              </View>
            ) : null}

            {agent.whenToUse ? (
              <View style={styles.artifactSection}>
                <Text style={styles.sectionTitle}>whenToUse</Text>
                <Text style={styles.artifactHeroSummary}>{agent.whenToUse}</Text>
              </View>
            ) : null}

            <View style={styles.artifactSection}>
              <Text style={styles.sectionTitle}>skills</Text>
              <View style={styles.agentSkillLine}>
                {agent.skills.map(skill => (
                  <View key={skill} style={styles.agentSkillChip}>
                    <Text style={styles.agentSkillText}>{skill}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.artifactSectionGrid}>
              <View style={styles.artifactMiniPanel}>
                <Text style={styles.sectionTitle}>轻管理</Text>
                <Text style={styles.bodyText}>{isBuiltin ? '内置 Agent 不显示删除和编辑入口。' : '自定义 Agent 支持编辑和删除。'}</Text>
              </View>
              <Pressable
                style={[styles.agentEditMockButton, isBuiltin && styles.agentEditMockButtonDisabled]}
                disabled={isBuiltin}
                onPress={() => onEdit(agent)}
              >
                <MaterialCommunityIcons name={isBuiltin ? 'lock-outline' : 'pencil-outline'} size={20} color={isBuiltin ? '#94a3b8' : '#fff'} />
                <Text style={[styles.agentEditMockText, isBuiltin && styles.agentEditMockTextDisabled]}>{isBuiltin ? '不可编辑' : '基础编辑'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </GlassCard>
      </View>
    </Modal>
  )
}

function AgentConfigPage({
  agent,
  saving,
  onBack,
  onSave,
  onCreate,
}: {
  agent: AgentView | null
  saving: boolean
  onBack: () => void
  onSave: (agent: AgentView, input: UpdateProjectAgentInput) => void
  onCreate: (input: CreateProjectAgentInput) => void
}) {
  type AgentConfigProvider = Extract<Agent['provider'], 'claude' | 'codex'>
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<AgentConfigProvider>('claude')
  const [providerOpen, setProviderOpen] = useState(false)
  const [model, setModel] = useState('')
  const [role, setRole] = useState('Custom Agent')
  const [maxRunSeconds, setMaxRunSeconds] = useState('300')
  const [description, setDescription] = useState('User-created Agent')
  const [whenToUse, setWhenToUse] = useState('Use when the user explicitly selects or mentions this Agent.')
  const [systemPrompt, setSystemPrompt] = useState('You are a focused custom Agent. Follow the workspace context and return concise, actionable output.')
  const providerOptions: { value: AgentConfigProvider; label: string }[] = [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
  ]

  useEffect(() => {
    setName(agent?.name ?? '')
    setProvider(agent?.provider === 'codex' ? 'codex' : 'claude')
    setModel(agent?.model ?? '')
    setRole(agent?.role ?? 'Custom Agent')
    setMaxRunSeconds(String(agent?.runtimePolicy?.maxRunSeconds ?? 300))
    setDescription(agent?.description ?? agent?.role ?? 'User-created Agent')
    setWhenToUse(agent?.whenToUse ?? 'Use when the user explicitly selects or mentions this Agent.')
    setSystemPrompt(agent?.systemPrompt ?? 'You are a focused custom Agent. Follow the workspace context and return concise, actionable output.')
    setProviderOpen(false)
  }, [agent])

  const submit = () => {
    if (saving) return
    const fallbackName = name.trim() || '新建 Agent'
    const trimmedModel = model.trim()
    const nextModel = trimmedModel || (agent ? undefined : 'custom')
    const nextAgent: Agent = {
      id: agent?.id ?? `agent-${Date.now()}`,
      name: fallbackName,
      role: description.trim() || role.trim() || 'Custom Agent',
      provider,
      status: agent?.status ?? 'idle',
      color: agent?.color ?? '#f59e0b',
      skills: agent?.skills ?? ['自定义', '指令', '配置'],
    }
    const input = {
      name: nextAgent.name,
      role: role.trim() || 'Custom Agent',
      description: description.trim() || role.trim() || 'User-created Agent',
      whenToUse: whenToUse.trim(),
      systemPrompt: systemPrompt.trim(),
      modelProvider: provider,
      ...(nextModel ? { model: nextModel } : {}),
      runtimePolicy: {
        workspaceOnly: agent?.runtimePolicy?.workspaceOnly ?? true,
        allowNetwork: agent?.runtimePolicy?.allowNetwork ?? false,
        allowShell: agent?.runtimePolicy?.allowShell ?? false,
        maxRunSeconds: Number(maxRunSeconds) || 300,
      },
      skills: agent?.skills ?? ['自定义', provider],
    }

    if (agent) {
      onSave(agent, input)
      return
    }

    onCreate({
      ...input,
      name: input.name,
      systemPrompt: input.systemPrompt,
    })
  }

  return (
    <View style={styles.agentConfigPage}>
      <GlassCard style={styles.agentConfigSheet}>
        <View style={styles.agentConfigPageHead}>
          <Pressable style={styles.agentConfigBackButton} onPress={onBack}>
            <MaterialCommunityIcons name="chevron-left" size={26} color="#0f172a" />
          </Pressable>
          <View style={styles.activityCenterHead}>
            <View style={styles.workspacePanelTitleCopy}>
              <Text style={styles.homeWorkspaceEyebrow}>AGENT MANAGEMENT</Text>
              <Text style={styles.artifactDetailTitle}>{agent ? '编辑 Agent' : '新建 Agent'}</Text>
            </View>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.agentConfigContent}>
          <View style={styles.agentConfigGrid}>
            <AgentField label="name" value={name} onChangeText={setName} placeholder="Agent 显示名" />
            <AgentField label="role" value={role} onChangeText={setRole} placeholder="例如 前端工程师 / 需求分析师" />
          </View>

          <AgentField label="description" value={description} onChangeText={setDescription} placeholder="简短说明这个 Agent 做什么" multiline />
          <AgentField label="whenToUse" value={whenToUse} onChangeText={setWhenToUse} placeholder="什么时候应该调用它" multiline />
          <AgentField label="systemPrompt" value={systemPrompt} onChangeText={setSystemPrompt} placeholder="Agent 的核心行为指令" multiline tall />

          <View style={styles.agentConfigGrid}>
            <View style={[styles.agentFormField, providerOpen && styles.agentProviderFieldOpen]}>
              <Text style={styles.agentFormLabel}>Agent 服务提供方</Text>
              <Pressable style={styles.agentSelectBox} onPress={() => setProviderOpen(open => !open)}>
                <Text style={styles.agentFormInputText}>{providerOptions.find(option => option.value === provider)?.label}</Text>
                <MaterialCommunityIcons name="menu-down" size={22} color="#334155" />
              </Pressable>
              {providerOpen ? (
                <View style={styles.agentProviderMenu}>
                  {providerOptions.map(option => (
                    <Pressable
                      key={option.value}
                      style={[styles.agentProviderOption, provider === option.value && styles.agentProviderOptionActive]}
                      onPress={() => {
                        setProvider(option.value)
                        setProviderOpen(false)
                      }}
                    >
                      <Text style={[styles.agentProviderOptionText, provider === option.value && styles.agentProviderOptionTextActive]}>{option.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            <AgentField label="model" value={model} onChangeText={setModel} placeholder="不填用默认模型" />
            <AgentField label="maxRunSeconds" value={maxRunSeconds} onChangeText={setMaxRunSeconds} placeholder="最大运行时间" keyboardType="number-pad" />
          </View>

          <Pressable style={[styles.workspaceCreateButton, saving && styles.workspaceCreateButtonDisabled]} onPress={submit} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="content-save-outline" size={20} color="#fff" />
            )}
            <Text style={styles.workspaceCreateText}>{saving ? '处理中...' : agent ? '保存配置' : '创建 Agent'}</Text>
          </Pressable>
        </ScrollView>
      </GlassCard>
    </View>
  )
}

function AgentField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  tall = false,
  editable = true,
  keyboardType,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  multiline?: boolean
  tall?: boolean
  editable?: boolean
  keyboardType?: 'default' | 'number-pad'
}) {
  return (
    <View style={styles.agentFormField}>
      <Text style={styles.agentFormLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.agentFormInput, multiline && styles.agentFormTextarea, tall && styles.agentFormTextareaTall, !editable && styles.agentFormInputDisabled]}
      />
    </View>
  )
}

function AgentCard({
  agent,
  layoutTier,
  mobileScale,
  deleting,
  actionsDisabled,
  onPress,
  onDelete,
}: {
  agent: AgentView
  layoutTier: LayoutTier
  mobileScale: MobileScale
  deleting?: boolean
  actionsDisabled?: boolean
  onPress?: () => void
  onDelete?: () => void
}) {
  const isBuiltin = isBuiltInAgentView(agent)
  const statusLabel = agent.status === 'running' ? '运行中' : agent.status === 'reviewing' ? '审查中' : '空闲中'
  const statusTone = agent.status === 'running' ? 'running' : agent.status === 'reviewing' ? 'reviewing' : 'idle'
  const isCompact = layoutTier === 'compact'
  const isStandard = layoutTier === 'standard'
  const avatarSize = mobileScale.agentCardAvatar
  const deleteDisabled = actionsDisabled || !onDelete

  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      <GlassCard style={[styles.agentCard, (isCompact || isStandard) && styles.agentCardResponsive]}>
      <AgentGlyph agentId={agent.id} label={agent.name} provider={agent.provider} color={agent.color} size={avatarSize} />
      <View style={styles.agentCopy}>
        <View style={styles.agentCardTop}>
          <Text style={[styles.agentName, { fontSize: mobileScale.agentCardTitle }]} numberOfLines={1}>{agent.name}</Text>
          <View style={styles.agentCardActions}>
            {!isBuiltin ? (
              <Pressable
                style={[styles.agentDeleteButton, deleteDisabled && styles.agentDeleteButtonDisabled]}
                disabled={deleteDisabled}
                onPress={event => {
                  event.stopPropagation()
                  onDelete?.()
                }}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#ef4444" />
                ) : (
                  <MaterialCommunityIcons name="trash-can-outline" size={19} color="#ef4444" />
                )}
              </Pressable>
            ) : null}
            <MaterialCommunityIcons name="chevron-right" size={26} color="#64748b" />
          </View>
        </View>
        <View style={styles.agentBadgeRow}>
          <View style={[styles.agentTypeBadge, isBuiltin ? styles.agentTypeBuiltin : styles.agentTypeCustom]}>
            <Text style={[styles.agentTypeText, { fontSize: mobileScale.labelText }, isBuiltin ? styles.agentTypeBuiltinText : styles.agentTypeCustomText]}>
              {isBuiltin ? '内置' : '自定义'}
            </Text>
          </View>
          <View style={[styles.agentStatusBadge, styles[statusTone]]}>
            <View style={[styles.agentStatusDot, styles[`${statusTone}Dot`]]} />
            <Text style={[styles.agentStatusText, { fontSize: mobileScale.labelText }, styles[`${statusTone}Text`]]}>{statusLabel}</Text>
          </View>
        </View>
        <Text style={[styles.agentProvider, { fontSize: mobileScale.metaText }]}>提供方： {agent.provider}</Text>
        <Text style={[styles.agentRole, { fontSize: mobileScale.bodyText, lineHeight: mobileScale.bodyLineHeight }]} numberOfLines={1}>{agent.role}</Text>
        <View style={[styles.agentBottomRow, (isCompact || isStandard) && styles.agentBottomRowResponsive]}>
          <View style={styles.agentSkillLine}>
            {agent.skills.slice(0, 3).map(skill => (
              <View key={skill} style={[styles.agentSkillChip, agent.status === 'reviewing' ? styles.reviewSkillChip : agent.status === 'running' ? styles.runningSkillChip : undefined]}>
                <Text style={[styles.agentSkillText, { fontSize: mobileScale.labelText }, agent.status === 'reviewing' ? styles.reviewSkillText : agent.status === 'running' ? styles.runningSkillText : undefined]}>{skill}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      </GlassCard>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  safe: {
    flex: 1,
  },
  backendGate: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingBottom: Platform.select({ ios: 28, android: 18, default: 24 }),
  },
  backendGateCompact: {
    paddingHorizontal: 16,
  },
  backendGateCard: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 28,
  },
  backendGateCardCompact: {
    paddingHorizontal: 16,
    paddingVertical: 22,
  },
  backendGateIconWrap: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 24,
    backgroundColor: 'rgba(239,246,255,0.78)',
  },
  backendGateTitle: {
    color: '#172033',
    textAlign: 'center',
    fontWeight: '900',
  },
  backendGateBody: {
    maxWidth: 320,
    color: '#526173',
    textAlign: 'center',
    fontWeight: '800',
  },
  backendEndpointPill: {
    maxWidth: '100%',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(191,219,254,0.86)',
    borderRadius: 18,
    backgroundColor: 'rgba(239,246,255,0.68)',
  },
  backendEndpointText: {
    flexShrink: 1,
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  backendGateError: {
    maxWidth: 320,
    color: '#b91c1c',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  backendRetryButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
    borderRadius: 18,
    backgroundColor: '#2563eb',
  },
  backendRetryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  backendDialogBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  backendDialogScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.36)',
  },
  backendDialogCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 22,
    borderRadius: 24,
  },
  backendDialogIconWrap: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(254,202,202,0.9)',
    borderRadius: 20,
    backgroundColor: 'rgba(254,242,242,0.86)',
  },
  backendDialogTitle: {
    color: '#172033',
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '900',
  },
  backendDialogBody: {
    color: '#526173',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '800',
  },
  backendDialogDetail: {
    alignSelf: 'stretch',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(248,250,252,0.78)',
    color: '#b91c1c',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  backendDialogActions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  backendDialogSecondaryButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.42)',
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  backendDialogSecondaryText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '900',
  },
  backendDialogPrimaryButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 16,
    backgroundColor: '#2563eb',
  },
  backendDialogPrimaryButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  backendDialogPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  agentHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
  },
  agentHeaderLeft: {
    flexShrink: 1,
    gap: 12,
  },
  codeHeader: {
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 8, android: 6, default: 8 }),
    paddingBottom: 14,
    gap: 12,
  },
  headerLeft: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  headerAvatarButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  headerBackButton: {
    width: 44,
    height: 44,
    marginTop: 0,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.72)',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.52)',
  },
  codeHeaderLeft: {
    flex: 1,
  },
  chatHeaderLeftTight: {
    gap: 14,
  },
  headerCopy: {
    minWidth: 0,
    flex: 1,
  },
  eyebrow: {
    color: 'rgba(51,65,85,0.62)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitle: {
    marginTop: 2,
    color: '#1f2937',
    fontSize: 25,
    fontWeight: '900',
  },
  codeSubtitle: {
    marginTop: 2,
    color: '#526173',
    fontSize: 14,
    fontWeight: '800',
  },
  headerAction: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeHeaderButton: {
    width: Platform.select({ android: 48, default: 54 }),
    height: Platform.select({ android: 48, default: 54 }),
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatAgentManageButton: {
    borderColor: 'rgba(37,99,235,0.22)',
    backgroundColor: 'rgba(239,246,255,0.62)',
  },
  workspaceHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconButton: {
    width: Platform.select({ android: 48, default: 54 }),
    height: Platform.select({ android: 48, default: 54 }),
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPressable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellWrap: {
    position: 'relative',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 13,
    right: 13,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  agentHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 10,
  },
  agentCreateButton: {
    height: 48,
    width: 118,
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
  agentCreatePressable: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  agentCreateButtonCompact: {
    width: 106,
    paddingHorizontal: 0,
  },
  agentCreateText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
  },
  appMenuBackdrop: {
    flex: 1,
    alignItems: 'flex-start',
  },
  appMenuScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.24)',
  },
  appMenuPanel: {
    width: '72%',
    maxWidth: 320,
    height: '100%',
    paddingHorizontal: 14,
    paddingBottom: Platform.select({ ios: 24, android: 18, default: 20 }),
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    backgroundColor: 'rgba(15,23,42,0.9)',
  },
  appMenuHead: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  appMenuHeadCopy: {
    flex: 1,
    minWidth: 0,
  },
  appMenuTitle: {
    color: '#f8fafc',
    fontWeight: '900',
  },
  appMenuList: {
    gap: 4,
  },
  appMenuRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  appMenuRowActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  appMenuIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  appMenuIconActive: {
    backgroundColor: '#2563eb',
  },
  appMenuRowText: {
    flex: 1,
    minWidth: 0,
    color: '#dbe4ee',
    fontWeight: '800',
  },
  appMenuRowTextActive: {
    color: '#fff',
    fontWeight: '900',
  },
  content: {
    flex: 1,
  },
  contentFill: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 20,
    paddingBottom: Platform.select({ ios: 52, android: 42, default: 48 }),
  },
  screenStack: {
    gap: 14,
  },
  workbenchScreen: {
    gap: 14,
    paddingTop: 2,
  },
  workbenchActiveCopy: {
    flex: 1,
    minWidth: 0,
  },
  workbenchIconWrap: {
    width: 72,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workbenchSectionHead: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  workbenchSectionMeta: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  workbenchLoadingCard: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(239,246,255,0.66)',
  },
  workbenchLoadingText: {
    flex: 1,
    minWidth: 0,
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  workbenchListLoadingCard: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 34,
    borderRadius: 24,
    backgroundColor: 'rgba(239,246,255,0.72)',
  },
  workbenchListLoadingTitle: {
    color: '#172033',
    fontSize: 18,
    fontWeight: '900',
  },
  workbenchListLoadingText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  homeScreen: {
    gap: 18,
    paddingTop: 4,
  },
  homeScreenCompact: {
    gap: 14,
  },
  homeGreetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeGreetingText: {
    flex: 1,
    minWidth: 0,
  },
  homeGreeting: {
    color: '#172033',
    fontSize: 34,
    fontWeight: '900',
  },
  homeGreetingSub: {
    marginTop: 10,
    color: '#172033',
    fontSize: 32,
    fontWeight: '900',
  },
  homeHeroOrb: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 116,
  },
  animatedHomeIcon: {},
  homeStatGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  workspaceSummaryRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
  },
  workspaceSummaryRowActive: {
    opacity: 1,
  },
  workspaceSummaryIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(219,234,254,0.74)',
  },
  workspaceSummaryTitle: {
    flex: 1,
    minWidth: 0,
    color: '#172033',
    fontSize: 22,
    fontWeight: '900',
  },
  workspaceSummaryCount: {
    color: '#2563eb',
    fontSize: 20,
    fontWeight: '900',
  },
  statPressable: {
    flex: 1,
  },
  homeSectionTitle: {
    color: '#172033',
    fontSize: 19,
    fontWeight: '900',
  },
  homeFeatureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  activityCard: {
    gap: 12,
  },
  activityRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activityDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#2563eb',
  },
  activityCopy: {
    flex: 1,
    minWidth: 0,
  },
  activityTime: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '900',
  },
  emptyStateCard: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 22,
  },
  workspaceScreen: {
    gap: 14,
    paddingTop: 2,
  },
  workspaceScreenCompact: {
    gap: 12,
  },
  heroRow: {
    minHeight: 154,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroText: {
    flex: 1,
  },
  greeting: {
    color: '#252b36',
    fontSize: 35,
    fontWeight: '900',
  },
  heroTitle: {
    marginTop: 30,
    color: '#272d38',
    fontSize: 34,
    lineHeight: 47,
    fontWeight: '900',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    minHeight: 110,
    padding: 14,
    gap: 6,
    justifyContent: 'space-between',
  },
  statCardActive: {
    borderColor: 'rgba(37,99,235,0.34)',
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  statIcon: {
    alignSelf: 'flex-start',
  },
  statValue: {
    color: '#111827',
    fontSize: 32,
    fontWeight: '900',
  },
  statLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    color: '#202938',
    fontSize: 17,
    fontWeight: '900',
  },
  cardTitle: {
    color: '#273246',
    fontSize: 14,
    fontWeight: '900',
  },
  bodyText: {
    marginTop: 3,
    color: '#5d6b80',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  blockTitle: {
    marginTop: 8,
    color: '#1f2937',
    fontSize: 25,
    fontWeight: '900',
  },
  featureCard: {
    width: '31%',
    minHeight: 122,
    padding: 14,
    justifyContent: 'space-between',
  },
  featureIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
    backgroundColor: '#080b15',
  },
  featureLabel: {
    color: '#15304a',
    fontSize: 15,
    fontWeight: '900',
  },
  homeWorkspaceCard: {
    padding: 18,
    gap: 12,
    borderRadius: 28,
  },
  homeWorkspaceHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  homeWorkspaceEyebrow: {
    color: 'rgba(51,65,85,0.62)',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  homeWorkspaceTitle: {
    color: '#172033',
    fontSize: 26,
    fontWeight: '900',
  },
  homeStatusPill: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.48)',
  },
  homeStatusText: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '900',
  },
  homeWorkspaceDesc: {
    color: '#526173',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  homeWorkspaceMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  homeMetaChip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  homeMetaTextBlue: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '900',
  },
  homeMetaTextGreen: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '900',
  },
  homeMetaTextGray: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '900',
  },
  homeAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  homeAvatarText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
    color: '#526173',
    fontSize: 14,
    fontWeight: '700',
  },
  activeWorkspaceEnterRow: {
    alignSelf: 'flex-start',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    borderRadius: 17,
    backgroundColor: 'rgba(219,234,254,0.72)',
  },
  activeWorkspaceEnterText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  searchCard: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '700',
  },
  workspaceFilterLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
  },
  workspaceDropdownLine: {
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  workspaceDropdownWrap: {
    flex: 1,
    minWidth: 0,
  },
  workspaceDropdownButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.78)',
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  workspaceDropdownButtonOpen: {
    borderColor: 'rgba(37,99,235,0.42)',
    backgroundColor: 'rgba(239,246,255,0.76)',
  },
  workspaceDropdownText: {
    flex: 1,
    minWidth: 0,
    color: '#334155',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceDropdownMenu: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderRadius: 14,
  },
  workspaceDropdownOption: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226,232,240,0.5)',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  workspaceDropdownOptionText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
  },
  pinnedLimitNotice: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255,247,237,0.5)',
  },
  pinnedLimitText: {
    flex: 1,
    minWidth: 0,
    color: '#b45309',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  pinnedExpandButton: {
    minHeight: 42,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.72)',
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  pinnedExpandText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceCard: {
    padding: 16,
    gap: 14,
    borderRadius: 26,
  },
  workspaceCardCompact: {
    padding: 14,
    gap: 12,
  },
  workspaceTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  workspaceIconTile: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    overflow: 'hidden',
  },
  workspaceTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  workspaceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  workspaceTitle: {
    flex: 1,
    minWidth: 0,
    color: '#172033',
    fontSize: 24,
    fontWeight: '900',
  },
  workspacePrimaryBadge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(237,233,254,0.82)',
  },
  workspacePrimaryText: {
    color: '#6d4ed8',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceGoal: {
    color: '#5d6b80',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  workspaceStatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  workspaceStatChip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  workspaceRunningDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#27bf83',
  },
  workspaceStatText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceStatTextBlue: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceStatTextPurple: {
    color: '#7c3aed',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceActionColumn: {
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 92,
    paddingTop: 2,
  },
  workspaceActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  workspacePinButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  workspaceActionButtonDisabled: {
    opacity: 0.62,
  },
  workspaceArchiveButtonActive: {
    backgroundColor: 'rgba(219,234,254,0.82)',
  },
  workspaceAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    gap: 0,
  },
  workspaceMoreAvatar: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
    borderWidth: 1,
    borderColor: '#d8dce3',
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  workspaceMoreAvatarText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '900',
  },
  workspaceAvatarText: {
    flex: 1,
    marginLeft: 10,
    color: '#526173',
    fontSize: 13,
    fontWeight: '700',
  },
  workspaceEventRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  workspaceEventLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workspaceEventLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  workspaceEventTime: {
    color: '#526173',
    fontSize: 12,
    fontWeight: '800',
  },
  workspaceEventText: {
    flex: 1,
    minWidth: 0,
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
  },
  loadMoreButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  loadMoreText: {
    color: '#526173',
    fontSize: 15,
    fontWeight: '800',
  },
  chatScreen: {
    flex: 1,
    gap: 14,
    paddingTop: 4,
    position: 'relative',
  },
  chatScroll: {
    flex: 1,
  },
  chatScrollToBottomButton: {
    position: 'absolute',
    right: 18,
    zIndex: 20,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(191,219,254,0.9)',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#1e293b',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  chatScrollInner: {
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: Platform.select({ ios: 16, android: 8, default: 12 }),
    paddingBottom: 8,
  },
  chatScrollInnerCompact: {
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 18, android: 8, default: 12 }),
  },
  chatScrollInnerStandard: {
    paddingHorizontal: 20,
    paddingTop: Platform.select({ ios: 28, android: 10, default: 16 }),
  },
  chatScrollInnerWide: {
    paddingHorizontal: 24,
    paddingTop: Platform.select({ ios: 18, android: 10, default: 14 }),
  },
  chatWorkspaceCard: {
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 16,
    gap: 10,
  },
  chatWorkspaceCardCompact: {
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  chatWorkspaceCardStandard: {
    paddingTop: 22,
    paddingHorizontal: 20,
  },
  chatWorkspaceTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  chatWorkspaceCopy: {
    flex: 1,
    minWidth: 0,
  },
  chatWorkspaceTitle: {
    marginTop: 2,
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '900',
  },
  chatWorkspaceSwitchInline: {
    alignSelf: 'flex-start',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(219,234,254,0.78)',
  },
  chatWorkspaceSwitchText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  chatAgentOverview: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chatAgentOverviewText: {
    flex: 1,
    marginLeft: 10,
    color: '#475569',
    fontSize: 13,
    fontWeight: '800',
  },
  chatHeaderTitle: {
    fontSize: 20,
  },
  chatSubtitleRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  chatLiveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#10b981',
  },
  chatHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  streamingPill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  streamingText: {
    color: '#0f9f6e',
    fontSize: 14,
    fontWeight: '900',
  },
  chatStreamingRow: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  chatHeaderCard: {
    padding: 16,
    gap: 8,
  },
  userMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: 10,
  },
  userPromptActionTarget: {
    maxWidth: '78%',
    alignSelf: 'flex-end',
  },
  userPromptBubble: {
    maxWidth: '78%',
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 24,
    backgroundColor: 'rgba(219,234,254,0.48)',
  },
  userPromptBubbleInAction: {
    maxWidth: '100%',
  },
  userPromptText: {
    color: '#172033',
    fontSize: 18,
    lineHeight: 31,
    fontWeight: '800',
  },
  mentionText: {
    color: '#2563eb',
    fontWeight: '900',
  },
  agentMessageBlock: {
    gap: 8,
  },
  agentMessageActionTarget: {
    marginLeft: 66,
    maxWidth: '84%',
    alignSelf: 'flex-start',
  },
  agentMessageMetaRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  agentMessageName: {
    color: '#526173',
    fontSize: 16,
    fontWeight: '900',
  },
  agentSmallBadge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(237,233,254,0.72)',
  },
  agentSmallBadgeText: {
    color: '#7658d8',
    fontSize: 13,
    fontWeight: '900',
  },
  engineerBadge: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(209,250,229,0.72)',
  },
  engineerBadgeText: {
    color: '#0f9f6e',
    fontSize: 13,
    fontWeight: '900',
  },
  chatBubbleLarge: {
    marginLeft: 66,
    maxWidth: '84%',
    padding: 18,
    borderRadius: 23,
  },
  chatBubbleLargeInAction: {
    marginLeft: 0,
    maxWidth: '100%',
  },
  engineerBubble: {
    marginLeft: 62,
    maxWidth: '78%',
    padding: 18,
    borderRadius: 23,
  },
  chatBubbleText: {
    color: '#172033',
    fontSize: 17,
    lineHeight: 30,
    fontWeight: '700',
  },
  chatBubbleTime: {
    marginTop: 8,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  chatReplyPreview: {
    marginBottom: 10,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#2563eb',
    borderRadius: 12,
    backgroundColor: 'rgba(37,99,235,0.08)',
  },
  chatReplyPreviewUser: {
    backgroundColor: 'rgba(255,255,255,0.44)',
  },
  chatReplyPreviewTitle: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  chatReplyPreviewExcerpt: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  chatUserGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.76)',
    backgroundColor: '#2563eb',
  },
  chatProcessCard: {
    marginLeft: 66,
    maxWidth: '86%',
    padding: 14,
    gap: 9,
    borderRadius: 22,
  },
  chatProcessCardRunning: {
    borderColor: 'rgba(37,99,235,0.22)',
  },
  chatProcessHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 2,
  },
  chatProcessTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatProcessTitle: {
    color: '#334155',
    fontSize: 16,
    fontWeight: '900',
  },
  chatProcessCount: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  processStatePill: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(239,246,255,0.8)',
  },
  processStatePillFailed: {
    backgroundColor: 'rgba(254,226,226,0.85)',
  },
  processStateText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  processStateTextFailed: {
    color: '#dc2626',
  },
  chatProcessRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  chatProcessIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#94a3b8',
  },
  chatProcessIconDone: {
    backgroundColor: 'rgba(209,250,229,0.9)',
  },
  chatProcessIconRunning: {
    backgroundColor: '#5572ff',
  },
  chatProcessIconFailed: {
    backgroundColor: '#dc2626',
  },
  chatProcessStepTitle: {
    color: '#172033',
    fontSize: 14,
    fontWeight: '900',
  },
  chatProcessStepBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  chatProcessSummary: {
    minWidth: 0,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  chatProcessTime: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  chatProcessExpandButton: {
    minHeight: 34,
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(239,246,255,0.82)',
  },
  chatProcessExpandText: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  currentArtifactsPanel: {
    padding: 14,
    gap: 12,
    borderRadius: 24,
  },
  currentArtifactsTitle: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '900',
  },
  currentArtifactsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  currentArtifactsSubtitle: {
    flexShrink: 1,
    color: '#64748b',
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '800',
  },
  currentArtifactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  currentArtifactCard: {
    flexGrow: 1,
    flexBasis: '31%',
    minWidth: 104,
    maxWidth: '48%',
    minHeight: 126,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  currentArtifactCardDisabled: {
    opacity: 0.62,
  },
  currentArtifactTitle: {
    alignSelf: 'stretch',
    color: '#172033',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  currentArtifactMeta: {
    alignSelf: 'stretch',
    color: '#2563eb',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  currentArtifactMetaGreen: {
    color: '#10b981',
  },
  currentArtifactMetaFailed: {
    color: '#dc2626',
  },
  currentArtifactMetaMuted: {
    color: '#64748b',
  },
  artifactStatusBadge: {
    minHeight: 24,
    minWidth: 54,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(226,232,240,0.72)',
  },
  artifactStatusReady: {
    backgroundColor: 'rgba(209,250,229,0.82)',
  },
  artifactStatusPartial: {
    backgroundColor: 'rgba(219,234,254,0.84)',
  },
  artifactStatusFailed: {
    backgroundColor: 'rgba(254,226,226,0.86)',
  },
  artifactStatusText: {
    color: '#64748b',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '900',
  },
  artifactStatusReadyText: {
    color: '#059669',
  },
  artifactStatusPartialText: {
    color: '#2563eb',
  },
  artifactStatusFailedText: {
    color: '#dc2626',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.28)',
  },
  messageActionSheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  messageActionSheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.3)',
  },
  messageActionSheet: {
    marginHorizontal: 12,
    marginBottom: Platform.select({ ios: 18, android: 12, default: 16 }),
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: Platform.select({ ios: 22, android: 16, default: 20 }),
    borderRadius: 24,
    gap: 8,
  },
  messageActionSheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(100,116,139,0.34)',
  },
  messageActionSheetTitle: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '900',
    paddingHorizontal: 4,
    paddingBottom: 2,
  },
  messageActionRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(239,246,255,0.72)',
  },
  messageActionRowDisabled: {
    opacity: 0.42,
  },
  messageActionText: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '900',
  },
  artifactDetailSheet: {
    maxHeight: '82%',
    marginHorizontal: 12,
    marginBottom: Platform.select({ ios: 18, android: 12, default: 16 }),
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: Platform.select({ ios: 24, android: 18, default: 22 }),
    borderRadius: 28,
    gap: 12,
  },
  artifactDetailHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(100,116,139,0.36)',
  },
  artifactDetailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  artifactDetailTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  artifactDetailIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(219,234,254,0.8)',
  },
  artifactDetailTitleCopy: {
    flex: 1,
    minWidth: 0,
  },
  artifactDetailTitle: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '900',
  },
  artifactCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  artifactDetailContent: {
    gap: 12,
    paddingBottom: 8,
  },
  artifactHeroBlock: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(239,246,255,0.62)',
    gap: 6,
  },
  artifactHeroMetric: {
    color: '#2563eb',
    fontSize: 22,
    fontWeight: '900',
  },
  artifactHeroStatusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  artifactHeroSummary: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  artifactSection: {
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  artifactSectionHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  artifactSmallButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(219,234,254,0.72)',
  },
  artifactSmallButtonText: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  artifactNotice: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(209,250,229,0.72)',
  },
  artifactNoticeError: {
    backgroundColor: 'rgba(254,226,226,0.78)',
  },
  artifactNoticeText: {
    flex: 1,
    minWidth: 0,
    color: '#047857',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  artifactNoticeErrorText: {
    color: '#dc2626',
  },
  artifactWebPreview: {
    height: 320,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.28)',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  artifactWebView: {
    flex: 1,
    backgroundColor: '#fff',
  },
  artifactFileList: {
    gap: 8,
  },
  artifactCodeBlock: {
    maxHeight: 240,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.88)',
  },
  artifactCodeText: {
    color: '#e2e8f0',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    lineHeight: 17,
  },
  artifactIssueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  artifactActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  artifactLinkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  artifactLinkButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.08)',
  },
  artifactLinkText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  loadMoreButtonDisabled: {
    opacity: 0.72,
  },
  artifactFileRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  artifactFileCopy: {
    flex: 1,
    minWidth: 0,
  },
  artifactSectionGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  artifactMiniPanel: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  deliveryStatusRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deliveryStatusLabel: {
    width: 72,
    color: '#475569',
    fontSize: 13,
    fontWeight: '800',
  },
  deliveryStatusValue: {
    flex: 1,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '900',
  },
  activityCenterSheet: {
    maxHeight: '72%',
    marginHorizontal: 12,
    marginBottom: Platform.select({ ios: 18, android: 12, default: 16 }),
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: Platform.select({ ios: 24, android: 18, default: 22 }),
    borderRadius: 28,
    gap: 14,
  },
  activityCenterHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activitySummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  activitySummaryPill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.46)',
  },
  activitySummaryText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '900',
  },
  activityCenterList: {
    gap: 10,
    paddingBottom: 4,
  },
  activityCenterRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  activityCenterIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(219,234,254,0.72)',
  },
  activityCenterTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activityTypeText: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  workspacePanelSheet: {
    maxHeight: '84%',
    marginHorizontal: 12,
    marginBottom: Platform.select({ ios: 18, android: 12, default: 16 }),
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: Platform.select({ ios: 24, android: 18, default: 22 }),
    borderRadius: 28,
    gap: 12,
  },
  workspacePanelSheetCompact: {
    maxHeight: '88%',
    paddingHorizontal: 14,
  },
  workspacePanelTitleCopy: {
    flex: 1,
    minWidth: 0,
  },
  workspacePanelContent: {
    gap: 14,
    paddingBottom: 4,
  },
  workspacePanelSection: {
    gap: 10,
    padding: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.36)',
  },
  workspacePanelSectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  workspacePanelSectionTitle: {
    color: '#172033',
    fontSize: 16,
    fontWeight: '900',
  },
  workspaceCreateForm: {
    gap: 16,
    paddingBottom: 4,
  },
  workspaceCreateTitle: {
    color: '#172033',
    fontSize: 28,
    fontWeight: '900',
  },
  workspaceFormField: {
    gap: 8,
  },
  workspaceFormLabel: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '900',
  },
  workspaceSwitchRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  workspaceSwitchRowActive: {
    backgroundColor: 'rgba(219,234,254,0.78)',
  },
  workspaceSwitchIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  workspaceSwitchCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  workspaceSwitchMeta: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  workspaceNameInput: {
    minHeight: 56,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.76)',
    borderRadius: 18,
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  workspaceGoalInput: {
    minHeight: 132,
    paddingTop: 14,
    paddingBottom: 14,
  },
  workspaceSegmentControl: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  workspaceSegmentItem: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  workspaceSegmentItemActive: {
    backgroundColor: '#5d96ff',
  },
  workspaceSegmentText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '900',
  },
  workspaceSegmentTextActive: {
    color: '#fff',
  },
  workspaceFormHelp: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  workspaceSelectBox: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.76)',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  workspaceSelectText: {
    color: '#172033',
    fontSize: 16,
    fontWeight: '800',
  },
  workspaceSelectMenu: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.64)',
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  workspaceSelectOption: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226,232,240,0.48)',
  },
  workspaceSelectOptionActive: {
    backgroundColor: 'rgba(219,234,254,0.68)',
  },
  workspaceSelectOptionText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '800',
  },
  workspaceSelectOptionTextActive: {
    color: '#2563eb',
    fontWeight: '900',
  },
  workspaceCreateTarget: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  workspaceCreateActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 2,
  },
  workspaceCancelButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.74)',
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  workspaceCancelText: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '900',
  },
  workspaceOptionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  workspaceKindCard: {
    flex: 1,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  workspaceKindCardActive: {
    backgroundColor: 'rgba(219,234,254,0.78)',
  },
  workspaceKindText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceKindTextActive: {
    color: '#2563eb',
  },
  workspaceChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  workspaceTypeChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.46)',
  },
  workspaceTypeChipActive: {
    backgroundColor: 'rgba(219,234,254,0.82)',
  },
  workspaceTypeText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '900',
  },
  workspaceTypeTextActive: {
    color: '#2563eb',
  },
  agentSelectChip: {
    maxWidth: '48%',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.46)',
  },
  agentSelectChipActive: {
    backgroundColor: 'rgba(236,253,245,0.82)',
  },
  agentSelectDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  agentSelectText: {
    flexShrink: 1,
    color: '#64748b',
    fontSize: 13,
    fontWeight: '900',
  },
  agentSelectTextActive: {
    color: '#047857',
  },
  workspaceCreateButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#2563eb',
  },
  workspaceCreateButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  workspaceCreateText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  agentDetailSheet: {
    maxHeight: '78%',
    marginHorizontal: 12,
    marginBottom: Platform.select({ ios: 18, android: 12, default: 16 }),
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: Platform.select({ ios: 24, android: 18, default: 22 }),
    borderRadius: 28,
    gap: 12,
  },
  agentDetailTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  agentDetailStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  agentEditMockButton: {
    flex: 1,
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 18,
    backgroundColor: '#2563eb',
  },
  agentEditMockButtonDisabled: {
    backgroundColor: 'rgba(226,232,240,0.82)',
  },
  agentEditMockText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  agentEditMockTextDisabled: {
    color: '#94a3b8',
  },
  agentConfigPage: {
    gap: 12,
    paddingTop: 2,
  },
  agentConfigSheet: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: Platform.select({ ios: 24, android: 18, default: 22 }),
    borderRadius: 28,
    gap: 12,
  },
  agentConfigPageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  agentConfigBackButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  agentConfigContent: {
    gap: 12,
    paddingBottom: 8,
  },
  agentConfigGrid: {
    gap: 12,
  },
  agentFormField: {
    gap: 6,
    zIndex: 1,
  },
  agentProviderFieldOpen: {
    zIndex: 50,
    elevation: 50,
  },
  agentFormLabel: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '900',
  },
  agentFormInput: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    borderRadius: 16,
    color: '#334155',
    fontSize: 15,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.36)',
  },
  agentFormInputDisabled: {
    color: '#64748b',
    backgroundColor: 'rgba(226,232,240,0.38)',
  },
  agentFormTextarea: {
    minHeight: 78,
    paddingTop: 12,
    lineHeight: 21,
  },
  agentFormTextareaTall: {
    minHeight: 116,
  },
  agentSelectBox: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    backgroundColor: '#f8fafc',
  },
  agentFormInputText: {
    flex: 1,
    minWidth: 0,
    color: '#334155',
    fontSize: 15,
    fontWeight: '700',
  },
  agentProviderMenu: {
    position: 'absolute',
    top: 74,
    left: 0,
    right: 0,
    zIndex: 60,
    padding: 4,
    borderWidth: 1,
    borderColor: '#dbe4ee',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 18,
  },
  agentProviderOption: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  agentProviderOptionActive: {
    backgroundColor: '#2563eb',
  },
  agentProviderOptionText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '800',
  },
  agentProviderOptionTextActive: {
    color: '#fff',
  },
  chatComposerDock: {
    paddingHorizontal: 12,
    paddingTop: 2,
  },
  chatReplyComposerBar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  chatReplyComposerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  chatReplyComposerTitle: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  chatReplyComposerExcerpt: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  chatReplyComposerClose: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(226,232,240,0.72)',
  },
  chatCopyToast: {
    alignSelf: 'center',
    minHeight: 30,
    justifyContent: 'center',
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(15,23,42,0.82)',
  },
  chatCopyToastText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  mentionAgentMenu: {
    maxHeight: 232,
    marginBottom: 8,
    padding: 6,
    borderRadius: 18,
  },
  mentionAgentList: {
    maxHeight: 220,
  },
  mentionAgentRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
  },
  mentionAgentCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  mentionAgentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mentionAgentName: {
    flex: 1,
    minWidth: 0,
    color: '#172033',
    fontSize: 14,
    fontWeight: '900',
  },
  mentionAgentHandle: {
    maxWidth: 132,
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  mentionAgentRole: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  chatComposer: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: CHAT_COMPOSER_VERTICAL_PADDING,
    borderRadius: 22,
  },
  chatComposerInput: {
    flex: 1,
    minWidth: 0,
    minHeight: CHAT_COMPOSER_INPUT_MIN_HEIGHT,
    maxHeight: CHAT_COMPOSER_INPUT_MAX_HEIGHT,
    paddingVertical: CHAT_COMPOSER_INPUT_VERTICAL_PADDING,
    paddingTop: CHAT_COMPOSER_INPUT_VERTICAL_PADDING,
    paddingBottom: CHAT_COMPOSER_INPUT_VERTICAL_PADDING,
    color: '#1f2937',
    fontSize: 15,
    lineHeight: CHAT_COMPOSER_INPUT_LINE_HEIGHT,
    fontWeight: '700',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  composerToolButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  composerToolText: {
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '900',
  },
  chatSendButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#9ca3af',
  },
  chatSendButtonDisabled: {
    opacity: 0.56,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageStack: {
    maxWidth: '86%',
    gap: 8,
  },
  messageStackUser: {
    alignItems: 'flex-end',
  },
  messageMeta: {
    marginLeft: 6,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  bubble: {
    padding: 13,
    borderRadius: 22,
  },
  userBubble: {
    backgroundColor: 'rgba(255,244,193,0.48)',
  },
  quoteText: {
    marginBottom: 8,
    padding: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    color: '#64748b',
    fontSize: 12,
  },
  messageText: {
    color: '#273246',
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '600',
  },
  processCard: {
    padding: 12,
    gap: 9,
  },
  processRow: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
  },
  processCopy: {
    flex: 1,
    minWidth: 0,
  },
  artifactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  artifactCard: {
    width: '47.8%',
    minHeight: 130,
    padding: 12,
    gap: 5,
  },
  artifactMetric: {
    marginTop: 'auto',
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    padding: 9,
    gap: 10,
  },
  composerInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 12,
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '700',
  },
  sendButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 25,
    backgroundColor: '#9ca3af',
  },
  segment: {
    flexDirection: 'row',
    gap: 8,
  },
  codeScreen: {
    gap: 14,
    paddingTop: 2,
  },
  codeSegment: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
  },
  codeSegmentItemActive: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(239,246,255,0.68)',
  },
  codeSegmentItem: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  codeSegmentDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(148,163,184,0.32)',
  },
  codeSegmentTextActive: {
    color: '#2563eb',
    fontSize: 18,
    fontWeight: '900',
  },
  codeSegmentText: {
    color: '#64748b',
    fontSize: 18,
    fontWeight: '900',
  },
  codePanel: {
    padding: 18,
    gap: 10,
    borderRadius: 28,
  },
  codePanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  codePanelTitleRow: {
    minWidth: 0,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  codePanelTitle: {
    color: '#172033',
    fontSize: 19,
    fontWeight: '900',
  },
  diffBadge: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  diffAdd: {
    color: '#10b981',
    fontSize: 15,
    fontWeight: '900',
  },
  diffSlash: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '900',
  },
  diffRemove: {
    color: '#f43f5e',
    fontSize: 15,
    fontWeight: '900',
  },
  codeFileRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  fileTypeIcon: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#3b82f6',
  },
  fileImageIcon: {
    backgroundColor: 'rgba(209,250,229,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,148,0.5)',
  },
  fileTypeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  fileCopy: {
    flex: 1,
    minWidth: 0,
  },
  filePath: {
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '900',
  },
  fileMeta: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  fileStatusWrap: {
    minWidth: 86,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  fileStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#aeb7c2',
  },
  fileStatusAdded: {
    backgroundColor: '#34c38f',
  },
  fileStatusModified: {
    backgroundColor: '#f6b422',
  },
  fileStatusText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'lowercase',
  },
  changeBadge: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  changeAdded: {
    color: '#059669',
  },
  changeModified: {
    color: '#2563eb',
  },
  previewPanel: {
    padding: 16,
  },
  previewShowcase: {
    minHeight: 318,
    padding: 18,
    borderRadius: 28,
  },
  previewShowcaseCompact: {
    minHeight: 292,
  },
  previewStage: {
    flex: 1,
    minHeight: 232,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewArrow: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  previewPhoneMini: {
    width: 132,
    height: 226,
    overflow: 'hidden',
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.1)',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.78)',
    shadowColor: '#475569',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  miniStatusBar: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#111827',
  },
  miniHeaderLine: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  miniTinyText: {
    color: '#172033',
    fontSize: 6,
    fontWeight: '900',
  },
  miniGreeting: {
    marginTop: 10,
    color: '#172033',
    fontSize: 10,
    fontWeight: '900',
  },
  miniTitle: {
    color: '#172033',
    fontSize: 13,
    fontWeight: '900',
  },
  miniStatsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 5,
  },
  miniStat: {
    flex: 1,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(226,232,240,0.72)',
  },
  miniListBlock: {
    marginTop: 10,
    height: 66,
    borderRadius: 11,
    backgroundColor: 'rgba(241,245,249,0.9)',
  },
  miniNav: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 9,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: 15,
    backgroundColor: 'rgba(15,23,42,0.84)',
  },
  miniAi: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  previewDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 9,
  },
  previewDotActive: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  previewDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: 'rgba(148,163,184,0.34)',
  },
  phonePreview: {
    overflow: 'hidden',
    minHeight: 260,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.44)',
  },
  previewTitle: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '900',
  },
  previewBig: {
    marginTop: 16,
    color: '#111827',
    fontSize: 26,
    fontWeight: '900',
  },
  previewCard: {
    height: 56,
    marginTop: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  previewDock: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: 28,
    backgroundColor: 'rgba(15,23,42,0.78)',
  },
  deliveryCard: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  deliveryCopy: {
    flex: 1,
    minWidth: 0,
  },
  deliveryStatusPanel: {
    padding: 18,
    gap: 16,
    borderRadius: 28,
  },
  deliveryStatusGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  deliveryStatusGridCompact: {
    flexDirection: 'column',
  },
  deliveryStatusCard: {
    flex: 1,
    minHeight: 150,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  deliveryStatusIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(219,234,254,0.82)',
  },
  deliveryStatusIconPurple: {
    backgroundColor: 'rgba(237,233,254,0.82)',
  },
  deliveryStatusIconGreen: {
    backgroundColor: 'rgba(209,250,229,0.82)',
  },
  deliveryStatusTitle: {
    marginTop: 9,
    color: '#172033',
    fontSize: 15,
    fontWeight: '900',
  },
  deliveryStatusPill: {
    alignSelf: 'flex-start',
    marginTop: 5,
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.48)',
  },
  deliveryStatusPillText: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '900',
  },
  deliveryStatusRunning: {
    color: '#2563eb',
  },
  deliveryStatusIdle: {
    color: '#64748b',
  },
  deliveryStatusBody: {
    marginTop: 12,
    color: '#273246',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  deliveryStatusTime: {
    marginTop: 'auto',
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  deliveryActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  deliveryActionRowCompact: {
    flexDirection: 'column',
  },
  deliveryOutlineButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  deliveryOutlineText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '900',
  },
  deliveryPrimaryButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#2563eb',
  },
  deliveryPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  deliveryGreenButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#22c59e',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  deliveryGreenText: {
    color: '#22c59e',
    fontSize: 16,
    fontWeight: '900',
  },
  agentScreen: {
    gap: 14,
    paddingTop: 4,
  },
  agentSummary: {
    minHeight: 220,
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderRadius: 28,
  },
  agentSummaryCompact: {
    minHeight: 112,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  agentSummaryHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  agentSummaryHeroCompact: {
    gap: 12,
  },
  registryIcon: {
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(221,229,255,0.68)',
  },
  registryCopy: {
    flex: 1,
    minWidth: 0,
  },
  registryTitle: {
    color: '#172033',
    fontSize: 26,
    fontWeight: '900',
  },
  agentSummaryText: {
    marginTop: 8,
    color: '#526173',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '800',
  },
  agentMetricRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  agentMetricBox: {
    flex: 1,
    minHeight: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  metricValueLine: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  metricDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#27bf83',
  },
  agentMetricValue: {
    color: '#172033',
    fontSize: 34,
    fontWeight: '900',
  },
  agentMetricLabel: {
    marginTop: 2,
    color: '#526173',
    fontSize: 15,
    fontWeight: '800',
  },
  agentSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 2,
  },
  agentSearchRowCompact: {
    gap: 8,
  },
  agentSearchBox: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  agentSearchPlaceholder: {
    color: '#64748b',
    fontSize: 16,
    fontWeight: '800',
  },
  agentSearchInput: {
    flex: 1,
    minWidth: 0,
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  agentFilterButton: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  agentFilterText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '900',
  },
  agentFilterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  agentLoadingCard: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(239,246,255,0.66)',
  },
  agentLoadingText: {
    flex: 1,
    minWidth: 0,
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '900',
  },
  agentCard: {
    minHeight: 144,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: 28,
  },
  agentCardResponsive: {
    minHeight: 150,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  agentCopy: {
    flex: 1,
    minWidth: 0,
  },
  agentCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  agentCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  agentDeleteButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(254,226,226,0.82)',
  },
  agentDeleteButtonDisabled: {
    opacity: 0.62,
  },
  agentBadgeRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  agentName: {
    flex: 1,
    minWidth: 0,
    color: '#172033',
    fontSize: 22,
    fontWeight: '900',
  },
  agentTypeBadge: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  agentTypeBuiltin: {
    backgroundColor: 'rgba(124,88,216,0.11)',
  },
  agentTypeCustom: {
    backgroundColor: 'rgba(37,99,235,0.1)',
  },
  agentTypeText: {
    fontSize: 13,
    fontWeight: '900',
  },
  agentTypeBuiltinText: {
    color: '#7658d8',
  },
  agentTypeCustomText: {
    color: '#2563eb',
  },
  agentStatusBadge: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  running: {
    backgroundColor: 'rgba(230,250,241,0.72)',
  },
  idle: {
    backgroundColor: 'rgba(241,245,249,0.76)',
  },
  reviewing: {
    backgroundColor: 'rgba(255,241,218,0.78)',
  },
  agentStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  runningDot: {
    backgroundColor: '#20b981',
  },
  idleDot: {
    backgroundColor: '#64748b',
  },
  reviewingDot: {
    backgroundColor: '#d97706',
  },
  agentStatusText: {
    fontSize: 14,
    fontWeight: '900',
  },
  runningText: {
    color: '#0f9f6e',
  },
  idleText: {
    color: '#475569',
  },
  reviewingText: {
    color: '#b45309',
  },
  agentProvider: {
    marginTop: 7,
    color: '#526173',
    fontSize: 14,
    fontWeight: '800',
  },
  agentRole: {
    marginTop: 8,
    color: '#334155',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '800',
  },
  agentBottomRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  agentBottomRowResponsive: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 10,
  },
  agentSkillLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  agentSkillChip: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 999,
    backgroundColor: 'rgba(239,232,255,0.56)',
  },
  runningSkillChip: {
    backgroundColor: 'rgba(222,247,236,0.66)',
  },
  reviewSkillChip: {
    backgroundColor: 'rgba(255,237,213,0.66)',
  },
  agentSkillText: {
    color: '#6d4ed8',
    fontSize: 14,
    fontWeight: '900',
  },
  runningSkillText: {
    color: '#119b68',
  },
  reviewSkillText: {
    color: '#b45309',
  },
  agentLoadedText: {
    color: '#64748b',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
  },
  sideRail: {
    position: 'absolute',
    left: 12,
    minHeight: 320,
    width: 142,
    justifyContent: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderRadius: 34,
  },
  navFab: {
    position: 'absolute',
    left: 18,
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 29,
    backgroundColor: 'rgba(15,23,42,0.82)',
  },
  navFabButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  sideRailToggle: {
    width: 46,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sideRailStack: {
    marginTop: 8,
    gap: 8,
  },
  sideRailItem: {
    minHeight: 48,
    borderRadius: 24,
  },
  sideRailItemExpanded: {
    minWidth: 124,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
  },
  sideRailItemActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  sideRailIconWrap: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
  },
  sideRailIconWrapActive: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  sideRailAi: {
    minHeight: 62,
  },
  sideRailAiIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 36,
    backgroundColor: '#14e0ba',
  },
  sideRailAiActive: {
    backgroundColor: 'rgba(20,224,186,0.18)',
  },
  sideRailLabel: {
    flex: 1,
    minWidth: 0,
    color: '#dbe4ee',
    fontSize: 13,
    fontWeight: '800',
  },
  sideRailLabelActive: {
    color: '#fff',
  },
  sideRailAiLabel: {
    color: '#8ef5dd',
    fontSize: 15,
    fontWeight: '900',
  },
})
