import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import {
  AlertTriangle,
  Braces,
  ChevronRight,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  Globe2,
  LoaderCircle,
  Quote,
  RefreshCcw,
  Search,
  X,
} from 'lucide-react'
import {
  buildBusinessProjectVersion,
  createBusinessProjectVersion,
  deployBusinessProjectVersion,
  fetchBusinessProjectDeliverySummary,
  fetchBusinessProjectVersionDiff,
  fetchBusinessProjectVersions,
  fetchBusinessProjectPreviewCapability,
  fetchBusinessProjectDiff,
  fetchBusinessProjectFileContent,
  fetchBusinessProjectFiles,
  restoreBusinessProjectVersion,
  triggerBusinessProjectPreviewBuild,
} from '../api/businessBackend'
import type {
  CodeWorkspaceDialogRequest,
  CodeWorkspaceDialogTab,
  CodeWorkspaceDialogTurnResult,
  CodeSelectionReference,
  WorkspaceDeliveryAsset,
  WorkspaceDeliverySurface,
  WorkspaceDeliverySummary,
  WorkspacePreviewCapability,
  WorkspacePreviewTarget,
  WorkspaceDiffSnapshot,
  WorkspaceFileContent,
  WorkspaceFileNode,
  WorkspaceVersionDiff,
  WorkspaceVersionRecord,
  WorkspaceVersionRestoreResult,
} from '../types'
import { GlassPanel } from './GlassPanel'
import { MarkdownRenderer } from './MarkdownRenderer'
import { StatusPill } from './StatusPill'

type CodeWorkspaceDialogProps = {
  open: boolean
  projectId?: string
  workspaceName?: string
  onClose: () => void
  onQuoteSelection: (selection: CodeSelectionReference) => void
  onProjectDeliveryUpdated?: () => void | Promise<void>
  requestedDialogState?: CodeWorkspaceDialogRequest
  requestedDialogStateKey?: number
}

type FileCacheEntry = {
  loading: boolean
  content?: WorkspaceFileContent
  error?: string
}

type EditorSelectionState = {
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

type CodeWrapMode = 'on' | 'off'
type WorkspacePanelMode = CodeWorkspaceDialogTab
type PreviewSurfaceMode = 'workspace' | 'build' | 'deployment'
type PreviewFrameStatus = 'loading' | 'slow' | 'ready' | 'error'
type DeliveryAction = 'save' | 'build' | 'deploy' | undefined
type DialogBootstrapState = 'idle' | 'loading' | 'ready' | 'error'

type PreviewSurfaceOption = {
  mode: PreviewSurfaceMode
  label: string
  summary: string
  available: boolean
  target?: WorkspacePreviewTarget
}

type MonacoEditorInstance = import('monaco-editor').editor.IStandaloneCodeEditor
type MonacoNamespace = typeof import('monaco-editor')
type MonacoThemeData = import('monaco-editor').editor.IStandaloneThemeData
type MonacoDisposable = import('monaco-editor').IDisposable

const CODE_EDITOR_THEME = 'agenthub-dark'
const DIALOG_ANIMATION_MS = 220

const CODE_EDITOR_THEME_DATA: MonacoThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6B7A90', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'FF7B72' },
    { token: 'operator', foreground: 'FF7B72' },
    { token: 'string', foreground: '8DDB8C' },
    { token: 'string.escape', foreground: '56D4DD' },
    { token: 'number', foreground: 'F2C572' },
    { token: 'regexp', foreground: '56D4DD' },
    { token: 'type', foreground: 'EACB5D' },
    { token: 'type.identifier', foreground: 'EACB5D' },
    { token: 'class', foreground: 'EACB5D' },
    { token: 'class.identifier', foreground: 'EACB5D' },
    { token: 'interface', foreground: 'C792EA' },
    { token: 'namespace', foreground: 'C792EA' },
    { token: 'function', foreground: '79C0FF' },
    { token: 'function.identifier', foreground: '79C0FF' },
    { token: 'identifier', foreground: 'E6EDF3' },
    { token: 'variable', foreground: 'E6EDF3' },
    { token: 'tag', foreground: 'FF7B72' },
    { token: 'attribute.name', foreground: 'F2C572' },
    { token: 'attribute.value', foreground: '8DDB8C' },
    { token: 'delimiter', foreground: '9FB0C7' },
    { token: 'delimiter.bracket', foreground: '9FB0C7' },
  ],
  colors: {
    'editor.background': '#0F1725',
    'editor.foreground': '#E6EDF3',
    'editor.lineHighlightBackground': '#192233',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#264F78AA',
    'editor.inactiveSelectionBackground': '#264F7855',
    'editor.selectionHighlightBackground': '#2F81F755',
    'editor.wordHighlightBackground': '#2F81F733',
    'editor.wordHighlightStrongBackground': '#2F81F755',
    'editorCursor.foreground': '#F8FAFC',
    'editorWhitespace.foreground': '#334155',
    'editorIndentGuide.background1': '#243041',
    'editorIndentGuide.activeBackground1': '#475569',
    'editorLineNumber.foreground': '#607089',
    'editorLineNumber.activeForeground': '#D8E1EB',
    'editorGutter.background': '#0F1725',
    'editorBracketMatch.background': '#1D4ED833',
    'editorBracketMatch.border': '#60A5FA',
    'editorOverviewRuler.border': '#00000000',
    'editor.findMatchBackground': '#7C3AED55',
    'editor.findMatchHighlightBackground': '#7C3AED22',
    'editorHoverWidget.background': '#151F2F',
    'editorHoverWidget.border': '#304155',
    'editorWidget.background': '#151F2F',
    'editorWidget.border': '#304155',
    'scrollbarSlider.background': '#94A3B833',
    'scrollbarSlider.hoverBackground': '#94A3B855',
    'scrollbarSlider.activeBackground': '#CBD5E166',
    'minimap.background': '#0F1725',
  },
}

type FileTreeProps = {
  nodes: WorkspaceFileNode[]
  activeFilePath?: string
  expandedPaths: Record<string, boolean>
  forceExpanded: boolean
  onToggleDirectory: (directoryPath: string) => void
  onSelectFile: (filePath: string) => void
}

type FileTreeNodeProps = {
  node: WorkspaceFileNode
  depth: number
  activeFilePath?: string
  expandedPaths: Record<string, boolean>
  forceExpanded: boolean
  onToggleDirectory: (directoryPath: string) => void
  onSelectFile: (filePath: string) => void
}

/**
 * Returns the first text-like file path from a nested workspace file tree.
 * Input: nested file nodes. Output: first file path or undefined.
 */
function firstTextFilePath(nodes: WorkspaceFileNode[]): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'file' && node.isText) {
      return node.path
    }
    if (node.kind === 'directory' && node.children?.length) {
      const nestedPath = firstTextFilePath(node.children)
      if (nestedPath) {
        return nestedPath
      }
    }
  }
  return undefined
}

/**
 * Checks whether one nested workspace file tree still contains a relative path.
 * Input: nested file nodes and one target path.
 * Output: true when the path still exists anywhere in the tree.
 */
function treeContainsPath(nodes: WorkspaceFileNode[], targetPath: string): boolean {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return true
    }
    if (node.kind === 'directory' && node.children?.length && treeContainsPath(node.children, targetPath)) {
      return true
    }
  }
  return false
}

/**
 * Expands the ancestor directories for one active file path.
 * Input: file path. Output: expanded directory lookup.
 */
function expandAncestors(filePath: string | undefined): Record<string, boolean> {
  if (!filePath) {
    return {}
  }

  const expanded: Record<string, boolean> = {}
  const segments = filePath.split('/').filter(Boolean)
  for (let index = 1; index < segments.length; index += 1) {
    expanded[segments.slice(0, index).join('/')] = true
  }
  return expanded
}

/**
 * Filters one workspace file tree by filename or relative path.
 * Input: nested nodes and lowercase query string. Output: filtered nested nodes.
 */
function filterFileTree(nodes: WorkspaceFileNode[], query: string): WorkspaceFileNode[] {
  if (!query) {
    return nodes
  }

  return nodes.flatMap(node => {
    const haystack = `${node.name} ${node.path}`.toLowerCase()
    if (node.kind === 'directory') {
      const children = filterFileTree(node.children ?? [], query)
      if (haystack.includes(query) || children.length > 0) {
        return [{ ...node, children }]
      }
      return []
    }
    return haystack.includes(query) ? [node] : []
  })
}

/**
 * Counts changed files from one porcelain git status payload.
 * Input: git status summary. Output: number of changed rows.
 */
function countChangedFiles(status: string | undefined): number {
  return status?.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length ?? 0
}

/**
 * Builds one quote-ready code selection from the active editor selection.
 * Input: editor instance, active file path, and editor language. Output: structured selection or undefined.
 */
function buildCodeSelection(
  editor: MonacoEditorInstance | null,
  activeFilePath: string | undefined,
  language: string | undefined,
): EditorSelectionState | undefined {
  const selection = editor?.getSelection()
  const model = editor?.getModel()
  if (!selection || !model || selection.isEmpty() || !activeFilePath) {
    return undefined
  }

  const selectedText = model.getValueInRange(selection)
  if (!selectedText.trim()) {
    return undefined
  }

  const beforeStart = Math.max(1, selection.startLineNumber - 6)
  const afterEnd = Math.min(model.getLineCount(), selection.endLineNumber + 6)
  const beforeContext =
    beforeStart < selection.startLineNumber
      ? model.getValueInRange({
          startLineNumber: beforeStart,
          startColumn: 1,
          endLineNumber: selection.startLineNumber - 1,
          endColumn: model.getLineMaxColumn(selection.startLineNumber - 1),
        })
      : undefined
  const afterContext =
    selection.endLineNumber < afterEnd
      ? model.getValueInRange({
          startLineNumber: selection.endLineNumber + 1,
          startColumn: 1,
          endLineNumber: afterEnd,
          endColumn: model.getLineMaxColumn(afterEnd),
        })
      : undefined

  return {
    filePath: activeFilePath,
    selectedText,
    startLine: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLine: selection.endLineNumber,
    endColumn: selection.endColumn,
    language,
    beforeContext,
    afterContext,
  }
}

/**
 * Registers the shared dark Monaco theme used by the workspace code browser.
 * Input: Monaco namespace before editor mount.
 * Output: theme available through the local theme id.
 */
function registerCodeEditorTheme(monaco: MonacoNamespace): void {
  monaco.editor.defineTheme(CODE_EDITOR_THEME, CODE_EDITOR_THEME_DATA)
}

/**
 * Returns one human-readable label for the detected preview framework.
 * Input: optional preview capability.
 * Output: localized framework label.
 */
function previewFrameworkLabel(capability: WorkspacePreviewCapability | undefined): string {
  switch (capability?.framework) {
    case 'static-html':
      return '静态 HTML'
    case 'vanilla-module':
      return '原生模块'
    case 'vite-react':
      return 'Vite React'
    case 'vite-vue':
      return 'Vite Vue'
    case 'vite-svelte':
      return 'Vite Svelte'
    case 'vite':
      return 'Vite'
    case 'angular':
      return 'Angular'
    default:
      return '未识别'
  }
}

/**
 * Returns one concise summary for the current preview mode and build state.
 * Input: optional preview capability.
 * Output: localized preview status label.
 */
function previewModeLabel(capability: WorkspacePreviewCapability | undefined): string {
  if (!capability) {
    return '正在识别预览模式'
  }
  if (capability.mode === 'static') {
    return '源码可直接预览'
  }
  if (capability.mode === 'module-shell') {
    return '源码可直接运行'
  }
  if (capability.mode === 'build') {
    switch (capability.build?.status) {
      case 'running':
        return '正在构建预览产物'
      case 'success':
        return '正在查看构建产物'
      case 'failed':
        return '构建失败'
      default:
        return '等待构建预览产物'
    }
  }
  return '当前工作区不可预览'
}

/**
 * Maps one delivery asset state into the shared status-pill variant.
 * Input: delivery asset summary.
 * Output: semantic status-pill keyword.
 */
function deliveryPillStatus(asset: WorkspaceDeliveryAsset | undefined): 'ready' | 'running' | 'success' | 'failed' | 'muted' {
  if (!asset) {
    return 'muted'
  }
  if (asset.status === 'failed') {
    return 'failed'
  }
  if (asset.status === 'ready') {
    return 'success'
  }
  return 'ready'
}

/**
 * Returns one concise label for the current delivery asset state.
 * Input: delivery asset summary.
 * Output: localized status label.
 */
function deliveryPillLabel(asset: WorkspaceDeliveryAsset | undefined): string {
  if (!asset) {
    return '未知'
  }
  if (asset.status === 'failed') {
    return '失败'
  }
  if (asset.status === 'ready') {
    return '就绪'
  }
  return '待生成'
}

/**
 * Clips one delivery log into a compact multiline preview.
 * Input: optional raw delivery log.
 * Output: shortened log text or an empty string.
 */
function clipDeliveryLog(log: string | undefined): string {
  const normalized = log?.trim() ?? ''
  if (!normalized) {
    return ''
  }
  return normalized.length > 320 ? `${normalized.slice(0, 320)}...` : normalized
}

/**
 * Creates one iframe-ready target for build or deployment previews.
 * Input: stable display path and optional preview URL.
 * Output: preview target or undefined when the asset does not exist yet.
 */
function createExternalPreviewTarget(
  path: string,
  url: string | undefined,
): WorkspacePreviewTarget | undefined {
  if (!url) {
    return undefined
  }

  return {
    path,
    url,
  }
}

/**
 * Builds the preview source options shown in the preview toolbar.
 * Input: workspace preview state, selected runtime target, and delivery summary.
 * Output: workspace, build, and deployment preview source options.
 */
function buildPreviewSurfaceOptions(
  capability: WorkspacePreviewCapability | undefined,
  workspaceTarget: WorkspacePreviewTarget | undefined,
  deliverySummary: WorkspaceDeliverySummary | undefined,
): PreviewSurfaceOption[] {
  const buildTarget = createExternalPreviewTarget('build/index.html', deliverySummary?.build.url)
  const deploymentTarget = createExternalPreviewTarget('deploy/index.html', deliverySummary?.deployment.url)

  return [
    {
      mode: 'workspace',
      label: '工作区预览',
      summary: capability?.reason ?? '检测当前工作区源码的可预览入口。',
      available: Boolean(capability),
      target: workspaceTarget,
    },
    {
      mode: 'build',
      label: '构建产物',
      summary: deliverySummary?.build.summary ?? '当前还没有生成可预览的构建产物。',
      available: Boolean(buildTarget),
      target: buildTarget,
    },
    {
      mode: 'deployment',
      label: '本地部署',
      summary: deliverySummary?.deployment.summary ?? '当前还没有生成可预览的本地部署页面。',
      available: Boolean(deploymentTarget),
      target: deploymentTarget,
    },
  ]
}

/**
 * Returns one concise label for the active preview source.
 * Input: active preview source and workspace preview capability.
 * Output: source label shown in the preview toolbar.
 */
function previewSurfaceLabel(
  mode: PreviewSurfaceMode,
  capability: WorkspacePreviewCapability | undefined,
): string {
  if (mode === 'workspace') {
    return `${previewFrameworkLabel(capability)} / ${previewModeLabel(capability)}`
  }
  if (mode === 'build') {
    return '交付构建产物 / 只读预览'
  }
  return '本地部署地址 / 只读预览'
}

/**
 * Returns one empty-state copy for the current preview source.
 * Input: active preview source.
 * Output: localized fallback copy for the preview panel.
 */
function previewSurfaceEmptyMessage(mode: PreviewSurfaceMode): string {
  if (mode === 'build') {
    return '当前还没有可访问的构建产物。'
  }
  if (mode === 'deployment') {
    return '当前还没有可访问的本地部署页面。'
  }
  return '当前工作区还没有可访问的预览入口。'
}

/**
 * Renders the full-screen code workspace dialog for one project workspace.
 * Input: open state, project identity, and quote callback.
 * Output: file tree, read-only code browser, and static preview panel.
 */
export function CodeWorkspaceDialog({
  open,
  projectId,
  workspaceName,
  onClose,
  onQuoteSelection,
  onProjectDeliveryUpdated,
  requestedDialogState,
  requestedDialogStateKey,
}: CodeWorkspaceDialogProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const editorShellRef = useRef<HTMLDivElement | null>(null)
  const workspaceLayoutRef = useRef<HTMLDivElement | null>(null)
  const activeFilePathRef = useRef<string | undefined>(undefined)
  const activeLanguageRef = useRef<string | undefined>(undefined)
  const editorDisposablesRef = useRef<MonacoDisposable[]>([])
  const selectionDraftRef = useRef<EditorSelectionState | undefined>(undefined)
  const selectionCommitTimerRef = useRef<number | undefined>(undefined)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const pointerSelectionRef = useRef(false)
  const autoBuildKeyRef = useRef('')
  const [isRendered, setIsRendered] = useState(open)
  const [isVisible, setIsVisible] = useState(open)
  const [bootstrapState, setBootstrapState] = useState<DialogBootstrapState>(open ? 'loading' : 'idle')
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const [panelMode, setPanelMode] = useState<WorkspacePanelMode>('code')
  const [fileTree, setFileTree] = useState<WorkspaceFileNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState('')
  const [fileQuery, setFileQuery] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({})
  const [activeFilePath, setActiveFilePath] = useState<string>()
  const [fileCache, setFileCache] = useState<Record<string, FileCacheEntry>>({})
  const [diffSnapshot, setDiffSnapshot] = useState<WorkspaceDiffSnapshot>()
  const [selectionState, setSelectionState] = useState<EditorSelectionState | undefined>(undefined)
  const [treeRootLabel, setTreeRootLabel] = useState('')
  const [wrapMode, setWrapMode] = useState<CodeWrapMode>('on')
  const [previewCapability, setPreviewCapability] = useState<WorkspacePreviewCapability>()
  const [turnResultContext, setTurnResultContext] = useState<CodeWorkspaceDialogTurnResult>()
  const [previewSurfaceMode, setPreviewSurfaceMode] = useState<PreviewSurfaceMode>('workspace')
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string>()
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewBuildLoading, setPreviewBuildLoading] = useState(false)
  const [deliverySummary, setDeliverySummary] = useState<WorkspaceDeliverySummary>()
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [deliveryError, setDeliveryError] = useState('')
  const [deliveryAction, setDeliveryAction] = useState<DeliveryAction>()
  const [versions, setVersions] = useState<WorkspaceVersionRecord[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState<string>()
  const [diffBaseVersionId, setDiffBaseVersionId] = useState<string>()
  const [versionDiff, setVersionDiff] = useState<WorkspaceVersionDiff>()
  const [versionDiffLoading, setVersionDiffLoading] = useState(false)
  const [versionDiffError, setVersionDiffError] = useState('')
  const [restoreBusyVersionId, setRestoreBusyVersionId] = useState<string>()
  const [restoreMessage, setRestoreMessage] = useState('')
  const [lastRestoreResult, setLastRestoreResult] = useState<WorkspaceVersionRestoreResult>()
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [previewStatus, setPreviewStatus] = useState<PreviewFrameStatus>('loading')
  const [editorViewport, setEditorViewport] = useState({
    width: 0,
    height: 0,
  })

  const filteredTree = useMemo(
    () => filterFileTree(fileTree, fileQuery.trim().toLowerCase()),
    [fileQuery, fileTree],
  )
  const activeFileEntry = activeFilePath ? fileCache[activeFilePath] : undefined
  const activeFileContent = activeFileEntry?.content
  const changedFileCount = countChangedFiles(diffSnapshot?.status)
  const canMountEditor = Boolean(activeFileContent && editorViewport.width >= 240 && editorViewport.height >= 220)
  const previewTargets = previewCapability?.targets ?? []
  const selectedPreviewTarget =
    previewTargets.find(target => target.path === selectedPreviewPath) ??
    previewTargets[0]
  const previewSurfaceOptions = useMemo(
    () => buildPreviewSurfaceOptions(previewCapability, selectedPreviewTarget, deliverySummary),
    [deliverySummary, previewCapability, selectedPreviewTarget],
  )
  const activePreviewOption =
    previewSurfaceOptions.find(option => option.mode === previewSurfaceMode && option.available) ??
    previewSurfaceOptions.find(option => option.mode === 'workspace' && option.available) ??
    previewSurfaceOptions.find(option => option.available)
  const activePreviewMode = activePreviewOption?.mode ?? 'workspace'
  const activePreviewTarget = activePreviewOption?.target
  const workspacePreviewCapability = activePreviewMode === 'workspace' ? previewCapability : undefined
  const previewBuildStatus = previewCapability?.build?.status
  const previewBusy = previewLoading || previewBuildLoading || previewBuildStatus === 'running'
  const dialogBusy = bootstrapState === 'loading' || treeLoading || previewLoading || deliveryLoading || versionsLoading
  const previewLogExcerpt = previewCapability?.build?.logExcerpt?.trim() ?? ''
  const deliveryBusy = Boolean(deliveryAction)
  const turnDiff = turnResultContext?.diff
  const turnReview = turnResultContext?.review
  const diffPatch = turnDiff?.patch ?? diffSnapshot?.patch ?? ''
  const diffFiles = turnDiff?.files ?? []
  const diffSummary = turnDiff?.summary ?? turnReview?.summary ?? ''
  const diffStatusSummary = diffSnapshot?.status?.trim() ?? ''
  const currentDeliveryVersionId = deliverySummary?.currentVersion?.versionId
  const canShowPreviewFrame = Boolean(activePreviewTarget?.url) && (
    activePreviewMode !== 'workspace' ||
    previewCapability?.mode === 'static' ||
    previewCapability?.mode === 'module-shell' ||
    previewBuildStatus === 'success'
  )
  const currentVersion = versions.find(version => version.isCurrent) ?? versions.find(version => version.versionId === currentDeliveryVersionId)
  const selectedVersion = versions.find(version => version.versionId === selectedVersionId)
  const diffBaseVersion = versions.find(version => version.versionId === diffBaseVersionId)
  const bootstrapErrorMessage =
    treeError || versionsError || previewError || deliveryError || 'Failed to load workspace assets.'

  useEffect(() => {
    activeFilePathRef.current = activeFilePath
    activeLanguageRef.current = activeFileContent?.language
  }, [activeFileContent?.language, activeFilePath])

  useEffect(() => {
    return () => {
      clearDialogCloseTimer()
      clearSelectionCommitTimer()
      disposeEditorListeners()
    }
  }, [])

  /**
   * Clears the deferred selection commit timer.
   * Input: none.
   * Output: pending selection commit canceled.
   */
  function clearSelectionCommitTimer() {
    if (selectionCommitTimerRef.current === undefined) {
      return
    }

    window.clearTimeout(selectionCommitTimerRef.current)
    selectionCommitTimerRef.current = undefined
  }

  /**
   * Clears the delayed close timer used by the dialog exit animation.
   * Input: none.
   * Output: pending close transition callback canceled.
   */
  function clearDialogCloseTimer() {
    if (closeTimerRef.current === undefined) {
      return
    }

    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
  }

  /**
   * Disposes editor event subscriptions created during mount.
   * Input: none.
   * Output: editor listeners released.
   */
  function disposeEditorListeners() {
    for (const disposable of editorDisposablesRef.current) {
      disposable.dispose()
    }
    editorDisposablesRef.current = []
  }

  /**
   * Rebuilds the latest code selection from the current editor model.
   * Input: none.
   * Output: selection draft stored in the shared ref and returned.
   */
  function refreshSelectionDraft(): EditorSelectionState | undefined {
    const nextSelection = buildCodeSelection(editorRef.current, activeFilePathRef.current, activeLanguageRef.current)
    selectionDraftRef.current = nextSelection
    return nextSelection
  }

  /**
   * Commits the latest selection draft after the user finishes the current gesture.
   * Input: optional delay in milliseconds.
   * Output: selection state updated once the timer fires.
   */
  function scheduleSelectionCommit(delayMs = 140) {
    clearSelectionCommitTimer()
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = undefined
      setSelectionState(selectionDraftRef.current)
    }, delayMs)
  }

  /**
   * Recomputes the structured code selection from the current editor state.
   * Input: none.
   * Output: updates the dialog selection state.
   */
  function syncSelectionState() {
    refreshSelectionDraft()
    if (pointerSelectionRef.current) {
      return
    }
    scheduleSelectionCommit()
  }

  /**
   * Reflows Monaco after layout-affecting UI state changes.
   * Input: none.
   * Output: editor viewport recalculated on the next frame.
   */
  function relayoutEditorSoon() {
    window.requestAnimationFrame(() => {
      editorRef.current?.layout()
    })
  }

  /**
   * Resets dialog-scoped state before a fresh bootstrap or after the close animation ends.
   * Input: none.
   * Output: cached selections, preview state, and panel state cleared.
   */
  function resetDialogState() {
    clearSelectionCommitTimer()
    disposeEditorListeners()
    pointerSelectionRef.current = false
    selectionDraftRef.current = undefined
    editorRef.current = null
    activeFilePathRef.current = undefined
    activeLanguageRef.current = undefined
    autoBuildKeyRef.current = ''
    setEditorViewport({
      width: 0,
      height: 0,
    })
    setPanelMode('code')
    setFileTree([])
    setTreeLoading(false)
    setTreeError('')
    setFileQuery('')
    setExpandedPaths({})
    setActiveFilePath(undefined)
    setFileCache({})
    setDiffSnapshot(undefined)
    setSelectionState(undefined)
    setTreeRootLabel('')
    setWrapMode('on')
    setPreviewCapability(undefined)
    setTurnResultContext(undefined)
    setPreviewSurfaceMode('workspace')
    setSelectedPreviewPath(undefined)
    setPreviewLoading(false)
    setPreviewError('')
    setPreviewBuildLoading(false)
    setDeliverySummary(undefined)
    setDeliveryLoading(false)
    setDeliveryError('')
    setDeliveryAction(undefined)
    setVersions([])
    setVersionsLoading(false)
    setVersionsError('')
    setSelectedVersionId(undefined)
    setDiffBaseVersionId(undefined)
    setVersionDiff(undefined)
    setVersionDiffLoading(false)
    setVersionDiffError('')
    setRestoreBusyVersionId(undefined)
    setRestoreMessage('')
    setLastRestoreResult(undefined)
    setPreviewAttempt(0)
    setPreviewStatus('loading')
  }

  /**
   * Loads one workspace file into the cache so the editor can mount without a second round trip.
   * Input: project id and repo-relative file path.
   * Output: resolved text file content cached under the file path.
   */
  async function loadFileContentIntoCache(
    currentProjectId: string,
    filePath: string,
  ): Promise<WorkspaceFileContent> {
    setSelectionState(undefined)
    setFileCache(previous => ({
      ...previous,
      [filePath]: {
        loading: true,
      },
    }))

    try {
      const content = await fetchBusinessProjectFileContent(currentProjectId, filePath)
      setFileCache(previous => ({
        ...previous,
        [filePath]: {
          loading: false,
          content,
        },
      }))
      return content
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load file content.'
      setFileCache(previous => ({
        ...previous,
        [filePath]: {
          loading: false,
          error: message,
        },
      }))
      throw new Error(message)
    }
  }

  /**
   * Applies one preview capability payload while preserving the best available active target.
   * Input: next preview capability and an optional preferred target path.
   * Output: preview capability, target selection, and iframe retry state updated.
   */
  function applyPreviewCapability(
    capability: WorkspacePreviewCapability,
    preferredPreviewPath?: string,
  ) {
    const nextPreviewTarget =
      capability.targets.find(target => target.path === preferredPreviewPath) ??
      capability.targets.find(target => target.path === capability.defaultTargetPath) ??
      capability.targets[0]

    setPreviewCapability(capability)
    setSelectedPreviewPath(nextPreviewTarget?.path)
    setPreviewAttempt(0)
  }

  /**
   * Loads the current preview capability without refetching the file tree.
   * Input: optional preferred preview target path and silent-refresh flag.
   * Output: preview capability state refreshed from the backend.
   */
  async function loadPreviewCapability(
    preferredPreviewPath?: string,
    options?: { silent?: boolean },
  ) {
    if (!projectId) {
      return
    }

    if (!options?.silent) {
      setPreviewLoading(true)
      setPreviewError('')
    }

    try {
      const capability = await fetchBusinessProjectPreviewCapability(projectId)
      applyPreviewCapability(capability, preferredPreviewPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load preview capability.'
      setPreviewError(message)
      setPreviewCapability(undefined)
      setSelectedPreviewPath(undefined)
    } finally {
      if (!options?.silent) {
        setPreviewLoading(false)
      }
    }
  }

  /**
   * Loads the current source/build/deploy summary for the selected project.
   * Input: optional silent-refresh flag.
   * Output: delivery summary state refreshed from the backend.
   */
  async function loadDeliverySummary(options?: { silent?: boolean }) {
    if (!projectId) {
      return
    }

    if (!options?.silent) {
      setDeliveryLoading(true)
      setDeliveryError('')
    }

    try {
      const summary = await fetchBusinessProjectDeliverySummary(projectId)
      setDeliverySummary(summary)
    } catch (error) {
      setDeliverySummary(undefined)
      setDeliveryError(error instanceof Error ? error.message : 'Failed to load delivery summary.')
    } finally {
      if (!options?.silent) {
        setDeliveryLoading(false)
      }
    }
  }

  /**
   * Loads saved version history for the selected project.
   * Input: optional silent-refresh flag.
   * Output: version list state refreshed from the backend.
   */
  async function loadVersions(options?: { silent?: boolean }): Promise<boolean> {
    if (!projectId) {
      return false
    }

    if (!options?.silent) {
      setVersionsLoading(true)
      setVersionsError('')
    }

    try {
      const nextVersions = await fetchBusinessProjectVersions(projectId)
      setVersions(nextVersions)
      setSelectedVersionId(previous => {
        if (previous && nextVersions.some(version => version.versionId === previous)) {
          return previous
        }
        return nextVersions[0]?.versionId
      })
      setDiffBaseVersionId(previous => {
        if (previous && nextVersions.some(version => version.versionId === previous)) {
          return previous
        }
        return undefined
      })
      return true
    } catch (error) {
      setVersions([])
      setVersionsError(error instanceof Error ? error.message : 'Failed to load version history.')
      return false
    } finally {
      if (!options?.silent) {
        setVersionsLoading(false)
      }
    }
  }

  /**
   * Loads one saved-version diff from the business backend.
   * Input: base and target version ids.
   * Output: version diff state refreshed from the backend.
   */
  async function loadVersionDiff(baseVersionId: string, targetVersionId: string) {
    if (!projectId) {
      return
    }

    setVersionDiffLoading(true)
    setVersionDiffError('')

    try {
      const nextDiff = await fetchBusinessProjectVersionDiff(projectId, baseVersionId, targetVersionId)
      setVersionDiff(nextDiff)
    } catch (error) {
      setVersionDiff(undefined)
      setVersionDiffError(error instanceof Error ? error.message : 'Failed to load version diff.')
    } finally {
      setVersionDiffLoading(false)
    }
  }

  /**
   * Loads the current project file browser snapshot from the local backend.
   * Input: optional preferred active file path and preview target path.
   * Output: updates file tree, diff state, preview state, and active selections.
   */
  async function loadWorkspaceBrowser(
    preferredActiveFilePath?: string,
    preferredPreviewPath?: string,
    options?: { prefetchInitialFileContent?: boolean },
  ): Promise<{ success: boolean; activeFilePath?: string }> {
    if (!projectId) {
      return { success: false }
    }

    setTreeLoading(true)
    setPreviewLoading(true)
    setDeliveryLoading(true)
    setTreeError('')
    setPreviewError('')
    setDeliveryError('')

    try {
      const [treeSnapshot, nextDiff, previewSnapshot, nextDeliverySummary] = await Promise.all([
        fetchBusinessProjectFiles(projectId),
        fetchBusinessProjectDiff(projectId).catch(() => undefined),
        fetchBusinessProjectPreviewCapability(projectId),
        fetchBusinessProjectDeliverySummary(projectId),
      ])

      const nextTree = treeSnapshot.entries
      const firstFile = firstTextFilePath(nextTree)
      const nextActiveFilePath =
        preferredActiveFilePath && treeContainsPath(nextTree, preferredActiveFilePath)
          ? preferredActiveFilePath
          : firstFile

      setFileTree(nextTree)
      setTreeRootLabel(treeSnapshot.rootLabel || '')
      setDiffSnapshot(nextDiff)
      applyPreviewCapability(previewSnapshot, preferredPreviewPath)
      setDeliverySummary(nextDeliverySummary)
      setExpandedPaths(previous => ({
        ...previous,
        ...expandAncestors(nextActiveFilePath),
      }))
      if (options?.prefetchInitialFileContent && nextActiveFilePath) {
        await loadFileContentIntoCache(projectId, nextActiveFilePath)
      }
      setActiveFilePath(nextActiveFilePath)
      return {
        success: true,
        activeFilePath: nextActiveFilePath,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workspace files.'
      setTreeError(message)
      setPreviewError(message)
      setDeliveryError(message)
      setPreviewCapability(undefined)
      setSelectedPreviewPath(undefined)
      setDeliverySummary(undefined)
      return { success: false }
    } finally {
      setTreeLoading(false)
      setPreviewLoading(false)
      setDeliveryLoading(false)
    }
  }

  /**
   * Reloads every project-scoped browser surface after one restore or delivery mutation.
   * Input: optional preferred active file and preview target.
   * Output: tree, preview, diff, delivery, and version states refreshed.
   */
  async function refreshWorkspaceSurfaces(
    preferredActiveFilePath?: string,
    preferredPreviewPath?: string,
  ) {
    await loadWorkspaceBrowser(preferredActiveFilePath, preferredPreviewPath)
    await loadVersions({ silent: true })
    await onProjectDeliveryUpdated?.()
  }

  useEffect(() => {
    clearDialogCloseTimer()

    if (open) {
      setIsRendered(true)
      const frame = window.requestAnimationFrame(() => {
        setIsVisible(true)
      })
      return () => {
        window.cancelAnimationFrame(frame)
      }
    }

    setIsVisible(false)
    if (!isRendered) {
      setBootstrapState('idle')
      return
    }

    closeTimerRef.current = window.setTimeout(() => {
      setIsRendered(false)
      setBootstrapState('idle')
      resetDialogState()
      clearDialogCloseTimer()
    }, DIALOG_ANIMATION_MS)

    return () => {
      clearDialogCloseTimer()
    }
  }, [isRendered, open])

  useEffect(() => {
    if (!open) {
      return
    }

    resetDialogState()
    setBootstrapState('loading')

    if (!projectId) {
      setTreeError('Project id is required before opening workspace assets.')
      setBootstrapState('error')
      return
    }

    let cancelled = false

    async function bootstrapDialog() {
      const [browserResult, versionsReady] = await Promise.all([
        loadWorkspaceBrowser(undefined, undefined, { prefetchInitialFileContent: true }),
        loadVersions(),
      ])
      if (cancelled) {
        return
      }

      setBootstrapState(browserResult.success && versionsReady ? 'ready' : 'error')
    }

    void bootstrapDialog()

    return () => {
      cancelled = true
    }
  }, [bootstrapAttempt, open, projectId])

  useEffect(() => {
    if (!open || !activePreviewOption || activePreviewOption.mode === previewSurfaceMode) {
      return
    }

    setPreviewSurfaceMode(activePreviewOption.mode)
  }, [activePreviewOption, open, previewSurfaceMode])

  useEffect(() => {
    if (!open || panelMode !== 'code') {
      return
    }

    const shell = editorShellRef.current
    if (!shell) {
      return
    }

    const syncViewport = () => {
      const width = Math.max(0, Math.round(shell.clientWidth))
      const height = Math.max(0, Math.round(shell.clientHeight))
      setEditorViewport(previous =>
        previous.width === width && previous.height === height
          ? previous
          : {
              width,
              height,
            },
      )
      if (editorRef.current && width > 0 && height > 0) {
        editorRef.current.layout({
          width,
          height,
        })
      }
    }

    syncViewport()
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(syncViewport)
    })
    resizeObserver.observe(shell)
    const initialFrame = window.requestAnimationFrame(syncViewport)
    const delayedFrame = window.setTimeout(syncViewport, 140)

    return () => {
      window.cancelAnimationFrame(initialFrame)
      window.clearTimeout(delayedFrame)
      resizeObserver.disconnect()
    }
  }, [open, panelMode, activeFilePath, activeFileContent?.path])

  useEffect(() => {
    if (!open || !projectId || !activeFilePath) {
      return
    }
    const cachedEntry = fileCache[activeFilePath]
    if (cachedEntry?.loading || cachedEntry?.content || cachedEntry?.error) {
      return
    }

    let cancelled = false
    const currentProjectId = projectId
    const currentFilePath = activeFilePath

    async function loadFileContent() {
      try {
        await loadFileContentIntoCache(currentProjectId, currentFilePath)
      } catch (error) {
        if (cancelled) {
          return
        }
        setFileCache(previous => ({
          ...previous,
          [currentFilePath]: {
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load file content.',
          },
        }))
      }
    }

    void loadFileContent()

    return () => {
      cancelled = true
    }
  }, [activeFilePath, open, projectId])

  useEffect(() => {
    clearSelectionCommitTimer()
    selectionDraftRef.current = buildCodeSelection(editorRef.current, activeFilePath, activeFileContent?.language)
    setSelectionState(selectionDraftRef.current)
  }, [activeFileContent, activeFilePath])

  useEffect(() => {
    if (!open || panelMode !== 'preview') {
      return
    }

    if (!canShowPreviewFrame) {
      setPreviewStatus(previewBuildStatus === 'running' ? 'loading' : 'error')
      return
    }

    setPreviewStatus('loading')
    const slowTimer = window.setTimeout(() => {
      setPreviewStatus(previous => (previous === 'loading' ? 'slow' : previous))
    }, 2500)
    const errorTimer = window.setTimeout(() => {
      setPreviewStatus(previous => (previous === 'ready' ? previous : 'error'))
    }, 10000)

    return () => {
      window.clearTimeout(slowTimer)
      window.clearTimeout(errorTimer)
    }
  }, [activePreviewMode, activePreviewTarget?.url, canShowPreviewFrame, open, panelMode, previewAttempt, previewBuildStatus])

  useEffect(() => {
    if (
      !open ||
      panelMode !== 'preview' ||
      previewSurfaceMode !== 'workspace' ||
      !projectId ||
      previewCapability?.mode !== 'build'
    ) {
      return
    }

    if (previewCapability.build?.status !== 'idle') {
      return
    }

    const autoBuildKey = `${projectId}:${previewCapability.sourceHash}`
    if (autoBuildKeyRef.current === autoBuildKey) {
      return
    }

    autoBuildKeyRef.current = autoBuildKey
    void handleStartPreviewBuild()
  }, [open, panelMode, previewCapability, previewSurfaceMode, projectId])

  useEffect(() => {
    if (
      !open ||
      panelMode !== 'preview' ||
      previewSurfaceMode !== 'workspace' ||
      !projectId ||
      previewCapability?.mode !== 'build' ||
      previewCapability.build?.status !== 'running'
    ) {
      return
    }

    const timer = window.setInterval(() => {
      void loadPreviewCapability(selectedPreviewPath, { silent: true })
    }, 2000)

    return () => {
      window.clearInterval(timer)
    }
  }, [open, panelMode, previewCapability, previewSurfaceMode, projectId, selectedPreviewPath])

  useEffect(() => {
    if (panelMode === 'code') {
      relayoutEditorSoon()
    }
  }, [panelMode])

  useEffect(() => {
    if (!open || !projectId || !selectedVersionId || !diffBaseVersionId || selectedVersionId === diffBaseVersionId) {
      setVersionDiff(undefined)
      setVersionDiffError('')
      return
    }

    void loadVersionDiff(diffBaseVersionId, selectedVersionId)
  }, [diffBaseVersionId, open, projectId, selectedVersionId])

  /**
   * Starts or retries the current preview build through the business backend.
   * Input: optional force flag.
   * Output: build state and preview targets refreshed from the backend.
   */
  async function handleStartPreviewBuild(force = false) {
    if (!projectId) {
      return
    }

    setPreviewBuildLoading(true)
    setPreviewError('')

    try {
      const capability = await triggerBusinessProjectPreviewBuild(projectId, force)
      applyPreviewCapability(capability, selectedPreviewPath)
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Failed to start preview build.')
    } finally {
      setPreviewBuildLoading(false)
    }
  }

  /**
   * Refreshes local delivery metadata and the parent chat pane after one action succeeds.
   * Input: none.
   * Output: workspace browser and parent room state reloaded.
   */
  async function refreshAfterDeliveryAction() {
    await refreshWorkspaceSurfaces(activeFilePath, selectedPreviewPath)
  }

  /**
   * Saves the current workspace repo into a versioned source snapshot when needed.
   * Input: optional force-save flag.
   * Output: current version record for follow-up build or deploy steps.
   */
  async function ensureDeliveryVersion(forceSave = false): Promise<WorkspaceVersionRecord> {
    if (!projectId) {
      throw new Error('Project id is required before saving a delivery version.')
    }

    if (!forceSave && currentDeliveryVersionId && changedFileCount === 0) {
      return {
        versionId: currentDeliveryVersionId,
        tag: currentDeliveryVersionId,
        commitSha: '',
        sourceZipPath: '',
        sourceZipUrl: deliverySummary?.sourceArchive.url ?? '',
        buildPath: undefined,
        buildPreviewUrl: deliverySummary?.build.url,
        buildStatus: deliverySummary?.build.status === 'ready'
          ? 'success'
          : deliverySummary?.build.status === 'failed'
            ? 'failed'
            : undefined,
        buildLog: deliverySummary?.build.log,
        createdAt: deliverySummary?.currentVersion?.createdAt ?? new Date().toISOString(),
        updatedAt: deliverySummary?.currentVersion?.updatedAt ?? new Date().toISOString(),
      }
    }

    return createBusinessProjectVersion(
      projectId,
      `保存本地源码版本 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    )
  }

  /**
   * Saves the current workspace repo into one new downloadable source snapshot.
   * Input: none.
   * Output: delivery summary refreshed after the snapshot completes.
   */
  async function handleSaveSourceSnapshot() {
    if (!projectId || deliveryBusy) {
      return
    }

    setDeliveryAction('save')
    setDeliveryError('')

    try {
      await ensureDeliveryVersion(true)
      await refreshAfterDeliveryAction()
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : 'Failed to save source snapshot.')
    } finally {
      setDeliveryAction(undefined)
    }
  }

  /**
   * Builds the latest saved version into a deployable static artifact.
   * Input: none.
   * Output: delivery summary refreshed after the build completes.
   */
  async function handleBuildDelivery() {
    if (!projectId || deliveryBusy) {
      return
    }

    setDeliveryAction('build')
    setDeliveryError('')

    try {
      const version = await ensureDeliveryVersion()
      await buildBusinessProjectVersion(projectId, version.versionId)
      await refreshAfterDeliveryAction()
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : 'Failed to build delivery artifact.')
      await loadDeliverySummary({ silent: true }).catch(() => undefined)
    } finally {
      setDeliveryAction(undefined)
    }
  }

  /**
   * Saves, builds, and publishes the latest version into the local deployment route.
   * Input: none.
   * Output: delivery summary refreshed after the deployment completes.
   */
  async function handleDeployDelivery() {
    if (!projectId || deliveryBusy) {
      return
    }

    setDeliveryAction('deploy')
    setDeliveryError('')

    try {
      const version = await ensureDeliveryVersion()
      const needsBuild = deliverySummary?.build.status !== 'ready' || deliverySummary?.build.versionId !== version.versionId || changedFileCount > 0
      if (needsBuild) {
        await buildBusinessProjectVersion(projectId, version.versionId)
      }
      await deployBusinessProjectVersion(projectId, version.versionId)
      await refreshAfterDeliveryAction()
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : 'Failed to publish local deployment.')
      await loadDeliverySummary({ silent: true }).catch(() => undefined)
    } finally {
      setDeliveryAction(undefined)
    }
  }

  /**
   * Refreshes the tree, preview, and diff state for the current workspace.
   * Input: none.
   * Output: reloads browser data from the local backend.
   */
  async function handleRefresh() {
    await refreshWorkspaceSurfaces(activeFilePath, selectedPreviewPath)
  }

  /**
   * Opens one preview surface inside the main code workspace area.
   * Input: target preview surface mode.
   * Output: dialog scrolls to the code area and switches to preview.
   */
  function openPreviewSurface(mode: PreviewSurfaceMode) {
    setPanelMode('preview')
    setPreviewSurfaceMode(mode)
    setPreviewAttempt(0)
    window.requestAnimationFrame(() => {
      workspaceLayoutRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
    })
  }

  /**
   * Applies one external dialog-open request from the chat surface.
   * Input: optional requested tab, preview surface, and turn-result payload.
   * Output: dialog tab state and preview source updated in place.
   */
  function applyDialogRequest(request: CodeWorkspaceDialogRequest | undefined) {
    setTurnResultContext(request?.turnResult)

    const nextTab = request?.tab ?? request?.turnResult?.defaultTab ?? 'code'
    setPanelMode(nextTab)

    if (nextTab === 'preview') {
      if (request?.previewSurface) {
        setPreviewSurfaceMode(request.previewSurface)
      } else {
        setPreviewSurfaceMode('workspace')
      }
      setPreviewAttempt(0)
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }

    applyDialogRequest(requestedDialogState)
  }, [open, requestedDialogState, requestedDialogStateKey])

  /**
   * Restores the workspace repo to the selected saved version and refreshes every dependent panel.
   * Input: target version record.
   * Output: version restore result stored for user feedback.
   */
  async function handleRestoreVersion(version: WorkspaceVersionRecord) {
    if (!projectId || restoreBusyVersionId) {
      return
    }

    const confirmed = window.confirm(
      `确定恢复到版本 ${version.versionId} 吗？\n\n这会覆盖当前工作区源码。\n恢复前会自动保存当前快照，避免丢失现在的内容。`,
    )

    if (!confirmed) {
      return
    }

    setRestoreBusyVersionId(version.versionId)
    setVersionsError('')
    setVersionDiffError('')

    try {
      const result = await restoreBusinessProjectVersion(projectId, version.versionId, {
        createSnapshotBeforeRestore: true,
        ...(restoreMessage.trim() ? { message: restoreMessage.trim() } : {}),
      })
      setLastRestoreResult(result)
      setSelectedVersionId(result.restoredVersion.versionId)
      setDiffBaseVersionId(undefined)
      setVersionDiff(undefined)
      await refreshWorkspaceSurfaces(activeFilePath, selectedPreviewPath)
    } catch (error) {
      setVersionsError(error instanceof Error ? error.message : 'Failed to restore version.')
    } finally {
      setRestoreBusyVersionId(undefined)
    }
  }

  /**
   * Restarts the preview iframe load sequence after a timeout or iframe error.
   * Input: none.
   * Output: remounts the iframe and resets the preview status.
   */
  function handleRetryPreview() {
    setPreviewAttempt(previous => previous + 1)
  }

  if (!isRendered) {
    return null
  }

  return (
    <div
      className={`code-dialog-backdrop ${isVisible ? 'is-visible' : ''}`}
      role="presentation"
      onClick={onClose}
    >
      <div className="code-dialog__surface" role="presentation" onClick={event => event.stopPropagation()}>
        <GlassPanel className="code-dialog">
          <header className="code-dialog__header">
            <div>
              <p className="eyebrow">Workspace Assets</p>
              <h2>{workspaceName ?? '当前工作区代码'}</h2>
              <span>
                {treeRootLabel ? `当前工作区范围：${treeRootLabel}` : '当前工作区范围：repo'}
              </span>
              <span>
                {changedFileCount > 0 ? `当前工作区有 ${changedFileCount} 个本地变更文件` : '当前工作区当前没有本地变更文件'}
              </span>
            </div>
            <div className="code-dialog__actions">
              <button
                className="icon-button code-dialog__icon-button"
                type="button"
                onClick={() => {
                  if (bootstrapState === 'ready') {
                    void handleRefresh()
                    return
                  }
                  setBootstrapAttempt(previous => previous + 1)
                }}
                disabled={bootstrapState === 'loading'}
                title={bootstrapState === 'ready' ? '刷新工作区' : '重试加载工作区资源'}
              >
                <RefreshCcw className={dialogBusy ? 'icon-spin' : ''} size={16} />
              </button>
              <button className="icon-button code-dialog__icon-button" type="button" onClick={onClose} title="关闭代码面板">
                <X size={16} />
              </button>
            </div>
          </header>

          {bootstrapState !== 'ready' ? (
            <div className="code-dialog__loading-shell">
              <div className={`code-dialog__loading-card ${bootstrapState === 'error' ? 'is-error' : ''}`}>
                {bootstrapState === 'error' ? (
                  <AlertTriangle size={22} />
                ) : (
                  <LoaderCircle className="icon-spin" size={22} />
                )}
                <strong>
                  {bootstrapState === 'error'
                    ? '工作区资源加载失败'
                    : '正在准备工作区资源'}
                </strong>
                <p>
                  {bootstrapState === 'error'
                    ? bootstrapErrorMessage
                    : '文件树、预览能力、交付状态、版本历史和首个代码文件准备完成后，再进入正式页面。'}
                </p>
                <div className="code-dialog__loading-meta">
                  <span>工作区：{workspaceName ?? '当前工作区'}</span>
                  <span>文件与差异：{treeLoading ? '加载中' : treeError ? '失败' : '就绪'}</span>
                  <span>预览能力：{previewLoading ? '加载中' : previewError ? '失败' : '就绪'}</span>
                  <span>交付状态：{deliveryLoading ? '加载中' : deliveryError ? '失败' : '就绪'}</span>
                  <span>版本历史：{versionsLoading ? '加载中' : versionsError ? '失败' : '就绪'}</span>
                </div>
                {bootstrapState === 'error' ? (
                  <div className="code-dialog__loading-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => setBootstrapAttempt(previous => previous + 1)}
                    >
                      重试
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="code-dialog__body">
          <section className="code-delivery-strip">
            <div className="code-delivery-strip__header">
              <div>
                <p className="eyebrow">Local Delivery</p>
                <strong>源码、交付构建和本地部署状态</strong>
                <span>
                  {changedFileCount > 0
                    ? '当前存在未保存代码变更，构建或部署时会先生成新的源码快照。'
                    : '当前工作区已经可以直接继续构建或重新部署。'}
                </span>
              </div>
              {deliveryLoading ? (
                <span className="code-delivery-strip__loading">
                  <LoaderCircle className="icon-spin" size={14} />
                  正在同步交付状态
                </span>
              ) : null}
            </div>

            <div className="code-delivery-grid">
              <DeliveryStatusCard
                title="源码快照"
                asset={deliverySummary?.sourceArchive}
                busy={deliveryAction === 'save'}
                actionLabel={deliveryAction === 'save'
                  ? '保存中...'
                  : currentDeliveryVersionId
                    ? (changedFileCount > 0 ? '保存最新源码' : '重新保存源码')
                    : '保存源码'}
                actionDisabled={deliveryBusy || !projectId}
                actionBusy={deliveryAction === 'save'}
                onAction={() => void handleSaveSourceSnapshot()}
                linkLabel={deliverySummary?.sourceArchive.url ? '下载源码' : undefined}
                linkUrl={deliverySummary?.sourceArchive.url}
              />
              <DeliveryStatusCard
                title="交付构建"
                asset={deliverySummary?.build}
                busy={deliveryAction === 'build'}
                actionLabel={deliveryAction === 'build'
                  ? '构建中...'
                  : deliverySummary?.build.status === 'failed'
                    ? '重试构建'
                    : deliverySummary?.build.status === 'ready'
                      ? '重新构建'
                      : '开始构建'}
                actionDisabled={deliveryBusy || !projectId}
                actionBusy={deliveryAction === 'build'}
                onAction={() => void handleBuildDelivery()}
                linkLabel={deliverySummary?.build.url ? '打开产物' : undefined}
                linkUrl={deliverySummary?.build.url}
                onLinkAction={deliverySummary?.build.url ? () => openPreviewSurface('build') : undefined}
              />
              <DeliveryStatusCard
                title="本地部署"
                asset={deliverySummary?.deployment}
                busy={deliveryAction === 'deploy'}
                actionLabel={deliveryAction === 'deploy'
                  ? '部署中...'
                  : deliverySummary?.deployment.status === 'ready'
                    ? '重新部署'
                    : '开始部署'}
                actionDisabled={deliveryBusy || !projectId}
                actionBusy={deliveryAction === 'deploy'}
                onAction={() => void handleDeployDelivery()}
                linkLabel={deliverySummary?.deployment.url ? '打开部署' : undefined}
                linkUrl={deliverySummary?.deployment.url}
                onLinkAction={deliverySummary?.deployment.url ? () => openPreviewSurface('deployment') : undefined}
              />
            </div>

            {deliveryError ? (
              <div className="code-delivery-strip__error">
                <AlertTriangle size={15} />
                <span>{deliveryError}</span>
              </div>
            ) : null}
          </section>

          <section className="code-version-strip">
            <div className="code-version-strip__header">
              <div>
                <p className="eyebrow">Version History</p>
                <strong>版本历史 / Diff / 恢复</strong>
                <span>
                  {versionsLoading
                    ? '正在同步版本列表...'
                    : versions.length > 0
                      ? `当前共 ${versions.length} 个版本`
                      : '当前还没有保存过源码版本'}
                </span>
              </div>
              <div className="code-version-strip__actions">
                <input
                  className="code-version-message-input"
                  type="text"
                  placeholder="可选：恢复提交说明"
                  value={restoreMessage}
                  onChange={event => setRestoreMessage(event.currentTarget.value)}
                />
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void loadVersions()}
                  disabled={versionsLoading}
                >
                  {versionsLoading ? <LoaderCircle className="icon-spin" size={14} /> : <RefreshCcw size={14} />}
                  刷新版本
                </button>
              </div>
            </div>

            <div className="code-version-strip__layout">
              <section className="code-versions-list">
                <div className="code-versions-list__header">
                  <strong>版本列表</strong>
                  <span>{currentVersion ? `当前版本：${currentVersion.versionId}` : '当前还没有版本'}</span>
                </div>

                {versionsError ? (
                  <div className="code-versions-list__error">{versionsError}</div>
                ) : null}

                {lastRestoreResult ? (
                  <div className="code-versions-list__success">
                    已恢复到 {lastRestoreResult.restoredVersion.versionId}
                    {lastRestoreResult.snapshotVersion ? `，并自动保存快照 ${lastRestoreResult.snapshotVersion.versionId}` : ''}
                  </div>
                ) : null}

                {versionsLoading ? (
                  <div className="code-versions-list__empty">
                    <LoaderCircle className="icon-spin" size={18} />
                    正在加载版本列表...
                  </div>
                ) : versions.length === 0 ? (
                  <div className="code-versions-list__empty">
                    <RefreshCcw size={18} />
                    当前还没有可用的源码版本
                  </div>
                ) : panelMode === 'diff' ? (
                  <div className="code-editor-toolbar code-editor-toolbar--preview">
                    <div className="code-editor-toolbar__meta">
                      <strong>{turnDiff?.title ?? '当前代码 Diff'}</strong>
                      <span>{turnResultContext ? '本轮产物差异视图' : '当前工作区实时差异视图'}</span>
                      <span>{diffSummary || turnResultContext?.summary || diffStatusSummary || '这里会展示当前本轮或当前工作区的代码差异。'}</span>
                    </div>
                    <div className="code-editor-toolbar__actions code-editor-toolbar__actions--preview">
                      {turnResultContext?.sourceArchiveUrl ? (
                        <a
                          className="secondary-button code-preview-open"
                          href={turnResultContext.sourceArchiveUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          下载源码快照
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="code-version-cards">
                    {versions.map(version => {
                      const isSelected = version.versionId === selectedVersionId
                      const isBase = version.versionId === diffBaseVersionId
                      const isRestoring = restoreBusyVersionId === version.versionId

                      return (
                        <div
                          className={`code-version-card ${isSelected ? 'is-selected' : ''} ${version.isCurrent ? 'is-current' : ''}`}
                          key={version.versionId}
                        >
                          <button
                            className="code-version-card__body"
                            type="button"
                            onClick={() => setSelectedVersionId(version.versionId)}
                          >
                            <div className="code-version-card__header">
                              <strong>{version.versionId}</strong>
                              <div className="code-version-card__badges">
                                {version.isCurrent ? <StatusPill status="success" label="当前" /> : null}
                                {isBase ? <StatusPill status="ready" label="Diff 基线" /> : null}
                              </div>
                            </div>
                            <span>{new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                            <span>{version.commitSha ? `commit ${version.commitSha.slice(0, 12)}` : '未记录 commitSha'}</span>
                          </button>
                          <div className="code-version-card__actions">
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => setDiffBaseVersionId(version.versionId)}
                              disabled={isSelected}
                            >
                              设为对比基线
                            </button>
                            <a className="secondary-button" href={version.sourceZipUrl} target="_blank" rel="noreferrer">
                              下载源码
                              <ExternalLink size={14} />
                            </a>
                            <button
                              className="primary-button"
                              type="button"
                              onClick={() => void handleRestoreVersion(version)}
                              disabled={isRestoring || version.isCurrent}
                            >
                              {isRestoring ? <LoaderCircle className="icon-spin" size={14} /> : null}
                              {version.isCurrent ? '当前版本' : '恢复到此版本'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <section className="code-version-diff">
                <div className="code-version-diff__header">
                  <strong>版本 Diff</strong>
                  <span>
                    {diffBaseVersion && selectedVersion && diffBaseVersion.versionId !== selectedVersion.versionId
                      ? `${diffBaseVersion.versionId} -> ${selectedVersion.versionId}`
                      : '先选一个版本，再选一个 Diff 基线'}
                  </span>
                </div>

                {versionDiffError ? (
                  <div className="code-versions-list__error">{versionDiffError}</div>
                ) : versionDiffLoading ? (
                  <div className="code-versions-list__empty">
                    <LoaderCircle className="icon-spin" size={18} />
                    正在加载版本差异...
                  </div>
                ) : versionDiff ? (
                  <div className="code-version-diff__content">
                    <div className="code-version-diff__meta">
                      <span>从 {versionDiff.fromVersion.versionId}</span>
                      <span>到 {versionDiff.toVersion.versionId}</span>
                    </div>
                    <pre className="code-version-diff__patch">{versionDiff.diff || '两个版本之间没有文本差异。'}</pre>
                  </div>
                ) : (
                  <div className="code-versions-list__empty">
                    <Braces size={18} />
                    选择两个不同版本后，这里会显示它们之间的源码 Diff
                  </div>
                )}
              </section>
            </div>
          </section>

          <div className="code-dialog__layout" ref={workspaceLayoutRef}>
            <aside className="code-sidebar">
              <label className="search-box">
                <Search size={15} />
                <input
                  type="search"
                  placeholder="搜索文件"
                  value={fileQuery}
                  onChange={event => setFileQuery(event.currentTarget.value)}
                />
              </label>

              <div className="code-tree">
                {treeLoading ? (
                  <div className="code-tree__empty">
                    <LoaderCircle className="icon-spin" size={18} />
                    正在加载文件树...
                  </div>
                ) : treeError ? (
                  <div className="code-tree__empty code-tree__empty--error">{treeError}</div>
                ) : filteredTree.length > 0 ? (
                  <FileTree
                    nodes={filteredTree}
                    activeFilePath={activeFilePath}
                    expandedPaths={expandedPaths}
                    forceExpanded={fileQuery.trim().length > 0}
                    onToggleDirectory={directoryPath => {
                      setExpandedPaths(previous => ({
                        ...previous,
                        [directoryPath]: !previous[directoryPath],
                      }))
                    }}
                    onSelectFile={filePath => {
                      setPanelMode('code')
                      setActiveFilePath(filePath)
                      setExpandedPaths(previous => ({
                        ...previous,
                        ...expandAncestors(filePath),
                      }))
                    }}
                  />
                ) : (
                  <div className="code-tree__empty">当前工作区还没有可浏览文件。</div>
                )}
              </div>
            </aside>

            <section className="code-editor-panel">
              <div className="code-editor-panel__top">
                <div className="code-panel-tabs">
                  <button
                    className={`code-panel-tab ${panelMode === 'code' ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setPanelMode('code')}
                  >
                    <Braces size={15} />
                    代码
                  </button>
                  <button
                    className={`code-panel-tab ${panelMode === 'diff' ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setPanelMode('diff')}
                  >
                    <ChevronRight size={15} />
                    Diff
                  </button>
                  <button
                    className={`code-panel-tab ${panelMode === 'preview' ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setPanelMode('preview')}
                  >
                    <Globe2 size={15} />
                    预览
                  </button>
                </div>

                {panelMode === 'code' ? (
                  <div className="code-editor-toolbar">
                    <div className="code-editor-toolbar__meta">
                      <strong>{activeFileContent?.path ?? activeFilePath ?? '未选择文件'}</strong>
                      <span>
                        {activeFileContent
                          ? `${activeFileContent.language} / ${activeFileContent.lineCount} lines / ${activeFileContent.byteLength} bytes`
                          : '从左侧选择一个文本文件后即可查看代码'}
                      </span>
                    </div>
                    <div className="code-editor-toolbar__actions">
                      <button
                        className={`secondary-button code-editor-toolbar__toggle ${wrapMode === 'on' ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => {
                          setWrapMode(previous => (previous === 'on' ? 'off' : 'on'))
                          relayoutEditorSoon()
                        }}
                      >
                        {wrapMode === 'on' ? '自动换行开' : '自动换行关'}
                      </button>
                      <button
                        className="primary-button code-editor-toolbar__quote"
                        type="button"
                        disabled={!selectionState}
                        onClick={() => {
                          if (!selectionState) {
                            return
                          }
                          onQuoteSelection(selectionState)
                        }}
                      >
                        <Quote size={15} />
                        引用选中代码
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="code-editor-toolbar code-editor-toolbar--preview">
                      <div className="code-editor-toolbar__meta">
                        <strong>{activePreviewTarget?.path ?? previewCapability?.entryPath ?? '暂无可预览入口'}</strong>
                        <span>{previewSurfaceLabel(activePreviewMode, previewCapability)}</span>
                        <span>{activePreviewOption?.summary ?? previewCapability?.reason ?? '正在识别当前工作区的预览方式。'}</span>
                      </div>
                      <div className="code-editor-toolbar__actions code-editor-toolbar__actions--preview">
                        <div className="segmented-control code-preview-source-switch">
                          {previewSurfaceOptions.map(option => (
                            <button
                              key={option.mode}
                              className={activePreviewMode === option.mode ? 'is-active' : ''}
                              type="button"
                              onClick={() => {
                                setPreviewSurfaceMode(option.mode)
                                setPreviewAttempt(0)
                              }}
                              disabled={!option.available}
                              title={option.summary}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        {activePreviewMode === 'workspace' && previewCapability?.mode === 'build' ? (
                          <button
                            className="secondary-button code-preview-build-button"
                            type="button"
                            onClick={() => void handleStartPreviewBuild(previewBuildStatus === 'failed' || previewBuildStatus === 'success')}
                            disabled={previewBusy}
                          >
                            {previewBusy ? <LoaderCircle className="icon-spin" size={14} /> : <RefreshCcw size={14} />}
                            {previewBuildStatus === 'success'
                              ? '重新构建'
                              : previewBuildStatus === 'failed'
                                ? '重试构建'
                                : previewBuildStatus === 'running'
                                  ? '构建中'
                                  : '开始构建'}
                          </button>
                        ) : null}
                        {activePreviewMode === 'workspace' ? (
                          <select
                            className="code-preview-select"
                            value={selectedPreviewTarget?.path ?? ''}
                            onChange={event => {
                              setSelectedPreviewPath(event.currentTarget.value || undefined)
                              setPreviewAttempt(0)
                            }}
                            disabled={previewTargets.length === 0 || previewBusy}
                          >
                            {previewTargets.length === 0 ? (
                              <option value="">暂无预览入口</option>
                            ) : (
                              previewTargets.map(target => (
                                <option key={target.path} value={target.path}>
                                  {target.path} {target.source === 'build' ? '(build)' : target.source === 'module-shell' ? '(module)' : ''}
                                </option>
                              ))
                            )}
                          </select>
                        ) : null}
                        {activePreviewMode !== 'workspace' ? (
                          <div className="code-preview-toolbar__workspace-placeholder">
                            当前预览模式无需选择文件入口
                          </div>
                        ) : null}
                        {activePreviewTarget?.url ? (
                          <a
                            className="secondary-button code-preview-open"
                            href={activePreviewTarget.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            新窗口打开
                            <ExternalLink size={14} />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {panelMode === 'code' ? (
                <div className="code-editor-shell" ref={editorShellRef}>
                  {activeFileEntry?.loading ? (
                    <div className="code-editor-empty">
                      <LoaderCircle className="icon-spin" size={18} />
                      正在加载文件内容...
                    </div>
                  ) : activeFileEntry?.error ? (
                    <div className="code-editor-empty code-editor-empty--error">{activeFileEntry.error}</div>
                  ) : activeFileContent && canMountEditor ? (
                    <Editor
                      height="100%"
                      path={activeFileContent.path}
                      language={activeFileContent.language}
                      value={activeFileContent.content}
                      theme={CODE_EDITOR_THEME}
                      beforeMount={registerCodeEditorTheme}
                      options={{
                        readOnly: true,
                        fontSize: 13,
                        fontFamily: 'Consolas, "SFMono-Regular", "JetBrains Mono", monospace',
                        fontLigatures: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: wrapMode,
                        wrappingIndent: 'indent',
                        automaticLayout: true,
                        renderLineHighlight: 'line',
                        lineNumbersMinChars: 3,
                        padding: { top: 12, bottom: 12 },
                        smoothScrolling: true,
                        matchBrackets: 'always',
                        renderWhitespace: 'selection',
                        cursorBlinking: 'solid',
                        guides: {
                          indentation: true,
                          highlightActiveIndentation: true,
                          bracketPairs: true,
                          bracketPairsHorizontal: 'active',
                          highlightActiveBracketPair: true,
                        },
                        bracketPairColorization: {
                          enabled: true,
                          independentColorPoolPerBracketType: true,
                        },
                        'semanticHighlighting.enabled': 'configuredByTheme',
                      }}
                      onMount={editor => {
                        disposeEditorListeners()
                        editorRef.current = editor
                        editor.layout({
                          width: Math.max(editorViewport.width, 1),
                          height: Math.max(editorViewport.height, 1),
                        })
                        relayoutEditorSoon()
                        window.setTimeout(() => {
                          editor.layout()
                        }, 140)
                        editorDisposablesRef.current = [
                          editor.onDidChangeCursorSelection(() => {
                            syncSelectionState()
                          }),
                          editor.onMouseDown(() => {
                            pointerSelectionRef.current = true
                            clearSelectionCommitTimer()
                            setSelectionState(undefined)
                          }),
                          editor.onMouseUp(() => {
                            pointerSelectionRef.current = false
                            refreshSelectionDraft()
                            scheduleSelectionCommit(60)
                          }),
                          editor.onDidBlurEditorText(() => {
                            pointerSelectionRef.current = false
                            refreshSelectionDraft()
                            scheduleSelectionCommit(0)
                          }),
                        ]
                        editor.onDidDispose(() => {
                          disposeEditorListeners()
                          clearSelectionCommitTimer()
                        })
                        syncSelectionState()
                      }}
                    />
                  ) : activeFileContent ? (
                    <div className="code-editor-empty">
                      <LoaderCircle className="icon-spin" size={18} />
                      正在初始化代码编辑器...
                    </div>
                  ) : (
                    <div className="code-editor-empty">
                      <Braces size={18} />
                      从左侧文件树选择一个文本文件开始查看。
                    </div>
                  )}
                </div>
              ) : panelMode === 'diff' ? (
                <div className="code-diff-shell">
                  {turnReview ? (
                    <div className="code-diff-review">
                      {turnReview.verdict ? (
                        <StatusPill status={turnReview.verdict === 'PASS' ? 'success' : turnReview.verdict === 'FAIL' ? 'failed' : 'ready'} label={turnReview.verdict} />
                      ) : null}
                      <MarkdownRenderer content={turnReview.summary} mode="panel" className="markdown-content--panel" />
                      {turnReview.issues?.length ? (
                        <ul className="code-diff-issues">
                          {turnReview.issues.map((issue, index) => (
                            <li key={`${issue}-${index}`}>{issue}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {diffFiles.length ? (
                    <div className="code-diff-files">
                      {diffFiles.map(file => (
                        <div className="code-diff-file-row" key={file.path}>
                          <span className={`diff-file-badge diff-file-badge--${file.status}`}>{file.status}</span>
                          <code>{file.path}</code>
                          <em>
                            +{file.additions} / -{file.deletions}
                          </em>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {diffPatch ? (
                    <pre className="code-diff-patch">{diffPatch}</pre>
                  ) : (
                    <div className="code-preview-empty">
                      <ChevronRight size={18} />
                      {diffStatusSummary || '当前还没有可展示的代码差异。'}
                    </div>
                  )}
                </div>
              ) : (
                <div className="code-preview-shell">
                  {activePreviewMode === 'workspace' && previewLoading && !workspacePreviewCapability ? (
                    <div className="code-preview-empty">
                      <LoaderCircle className="icon-spin" size={18} />
                      正在识别预览方式...
                    </div>
                  ) : activePreviewMode === 'workspace' && previewError && !workspacePreviewCapability ? (
                    <div className="code-preview-empty code-preview-empty--error">{previewError}</div>
                  ) : activePreviewMode === 'workspace' && !workspacePreviewCapability ? (
                    <div className="code-preview-empty">
                      <Globe2 size={18} />
                      当前工作区还没有可用的预览能力信息。
                    </div>
                  ) : workspacePreviewCapability?.mode === 'unsupported' ? (
                    <div className="code-preview-empty">
                      <AlertTriangle size={18} />
                      <strong>当前工作区暂不支持页面预览</strong>
                      <p>{workspacePreviewCapability.reason}</p>
                    </div>
                  ) : workspacePreviewCapability?.mode === 'build' && previewBuildStatus !== 'success' ? (
                    <div className="code-preview-build">
                      <div className={`code-preview-build__card code-preview-build__card--${previewBuildStatus ?? 'idle'}`}>
                        {previewBuildStatus === 'failed' ? (
                          <AlertTriangle size={18} />
                        ) : (
                          <LoaderCircle className={previewBuildStatus === 'running' ? 'icon-spin' : ''} size={18} />
                        )}
                        <strong>{workspacePreviewCapability.build?.summary ?? workspacePreviewCapability.reason}</strong>
                        <p>{workspacePreviewCapability.reason}</p>
                        {workspacePreviewCapability.build?.installCommand ? (
                          <code>{workspacePreviewCapability.build.installCommand}</code>
                        ) : null}
                        {workspacePreviewCapability.build?.buildCommand ? (
                          <code>{workspacePreviewCapability.build.buildCommand}</code>
                        ) : null}
                        {previewLogExcerpt ? (
                          <pre className="code-preview-log">{previewLogExcerpt}</pre>
                        ) : null}
                        <div className="code-preview-actions">
                          <button
                            className="primary-button"
                            type="button"
                            onClick={() => void handleStartPreviewBuild(previewBuildStatus === 'failed')}
                            disabled={previewBusy}
                          >
                            {previewBuildStatus === 'failed' ? '重新构建' : previewBuildStatus === 'running' ? '构建中...' : '开始构建'}
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => void loadPreviewCapability(selectedPreviewPath)}
                            disabled={previewBusy}
                          >
                            刷新状态
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : !activePreviewTarget?.url ? (
                    <div className="code-preview-empty">
                      <Globe2 size={18} />
                      {previewSurfaceEmptyMessage(activePreviewMode)}
                    </div>
                  ) : (
                    <>
                      <iframe
                        key={`${activePreviewMode}-${activePreviewTarget.path}-${previewAttempt}`}
                        className="code-preview-frame"
                        src={activePreviewTarget.url}
                        title={activePreviewTarget.path}
                        onLoad={() => setPreviewStatus('ready')}
                        onError={() => setPreviewStatus('error')}
                      />

                      {previewStatus !== 'ready' ? (
                        <div className="code-preview-overlay">
                          <div className={`code-preview-status code-preview-status--${previewStatus}`}>
                            {previewStatus === 'error' ? (
                              <AlertTriangle size={18} />
                            ) : (
                              <LoaderCircle className="icon-spin" size={18} />
                            )}
                            <strong>
                              {previewStatus === 'error'
                                ? '预览加载失败'
                                : previewStatus === 'slow'
                                  ? '页面加载较慢'
                                  : '正在加载页面预览'}
                            </strong>
                            <p>
                              {previewStatus === 'error'
                                ? '可以重试 iframe 预览，或者直接在新窗口打开当前页面。'
                                : previewStatus === 'slow'
                                  ? '页面资源较多或构建结果正在冷启动，请再等一会。'
                                  : '正在拉取当前工作区的页面资源。'}
                            </p>
                            {previewStatus === 'error' ? (
                              <div className="code-preview-actions">
                                <button className="primary-button" type="button" onClick={handleRetryPreview}>
                                  重试预览
                                </button>
                                <a className="secondary-button" href={activePreviewTarget.url} target="_blank" rel="noreferrer">
                                  新窗口打开
                                </a>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  )
}

type DeliveryStatusCardProps = {
  title: string
  asset: WorkspaceDeliveryAsset | undefined
  busy: boolean
  actionLabel: string
  actionDisabled: boolean
  actionBusy: boolean
  onAction: () => void
  linkLabel?: string
  linkUrl?: string
  onLinkAction?: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  secondaryActionDisabled?: boolean
}

/**
 * Renders one compact local-delivery status card above the code and preview panels.
 * Input: delivery asset summary, action button state, and optional external link.
 * Output: one delivery summary card.
 */
function DeliveryStatusCard({
  title,
  asset,
  busy,
  actionLabel,
  actionDisabled,
  actionBusy,
  onAction,
  linkLabel,
  linkUrl,
  onLinkAction,
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionDisabled,
}: DeliveryStatusCardProps) {
  const logExcerpt = clipDeliveryLog(asset?.log)
  const inlinePreviewMode = linkLabel === '打开产物'
    ? 'build'
    : linkLabel === '打开部署'
      ? 'deployment'
      : undefined

  return (
    <div className={`code-delivery-card ${busy ? 'is-busy' : ''} ${asset?.status === 'failed' ? 'is-failed' : asset?.status === 'ready' ? 'is-ready' : ''}`}>
      <div className="code-delivery-card__header">
        <strong>{title}</strong>
        <StatusPill status={deliveryPillStatus(asset)} label={deliveryPillLabel(asset)} />
      </div>
      <p>{asset?.summary ?? '当前还没有可用状态。'}</p>
      {asset?.versionId ? <span className="code-delivery-card__meta">{asset.versionId}</span> : null}
      {logExcerpt ? <pre className="code-delivery-card__log">{logExcerpt}</pre> : null}
      <div className="code-delivery-card__actions">
        <button
          className="primary-button code-delivery-card__action code-delivery-card__action--primary"
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
        >
          {actionBusy ? <LoaderCircle className="icon-spin" size={14} /> : null}
          {actionLabel}
        </button>
        {secondaryActionLabel && onSecondaryAction ? (
          <button
            className="secondary-button code-delivery-card__action code-delivery-card__action--secondary"
            type="button"
            onClick={onSecondaryAction}
            disabled={secondaryActionDisabled}
          >
            {secondaryActionLabel}
            <Globe2 size={14} />
          </button>
        ) : onLinkAction && linkLabel ? (
          <button
            className="secondary-button code-delivery-card__action code-delivery-card__action--secondary"
            type="button"
            onClick={onLinkAction}
          >
            {inlinePreviewMode === 'build' ? '查看产物' : '查看部署'}
            <Globe2 size={14} />
          </button>
        ) : linkUrl && linkLabel ? (
          <a
            className="secondary-button code-delivery-card__action code-delivery-card__action--secondary"
            href={linkUrl}
            target="_blank"
            rel="noreferrer"
          >
            {linkLabel}
            <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Renders the nested file tree used by the code dialog sidebar.
 * Input: tree nodes, expansion state, and callbacks.
 * Output: nested file tree buttons.
 */
function FileTree({
  nodes,
  activeFilePath,
  expandedPaths,
  forceExpanded,
  onToggleDirectory,
  onSelectFile,
}: FileTreeProps) {
  return (
    <div className="code-tree__list">
      {nodes.map(node => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          activeFilePath={activeFilePath}
          expandedPaths={expandedPaths}
          forceExpanded={forceExpanded}
          onToggleDirectory={onToggleDirectory}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  )
}

/**
 * Renders one file-tree node with recursive children when expanded.
 * Input: one tree node plus rendering state.
 * Output: one tree row and optional nested children.
 */
function FileTreeNode({
  node,
  depth,
  activeFilePath,
  expandedPaths,
  forceExpanded,
  onToggleDirectory,
  onSelectFile,
}: FileTreeNodeProps) {
  const isDirectory = node.kind === 'directory'
  const isBinaryFile = node.kind === 'file' && !node.isText
  const isExpanded = forceExpanded || expandedPaths[node.path] || depth === 0

  return (
    <div className="code-tree__node">
      <button
        className={`code-tree__row ${activeFilePath === node.path ? 'is-active' : ''} ${isBinaryFile ? 'is-disabled' : ''}`}
        type="button"
        disabled={isBinaryFile}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(node.path)
            return
          }
          onSelectFile(node.path)
        }}
      >
        {isDirectory ? (
          <>
            <ChevronRight className={`code-tree__chevron ${isExpanded ? 'is-open' : ''}`} size={14} />
            {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          </>
        ) : (
          <>
            <span className="code-tree__spacer" />
            <FileCode2 size={15} />
          </>
        )}
        <span>{node.name}</span>
      </button>

      {isDirectory && isExpanded && node.children?.length ? (
        <div>
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              expandedPaths={expandedPaths}
              forceExpanded={forceExpanded}
              onToggleDirectory={onToggleDirectory}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
