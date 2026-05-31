import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import {
  Braces,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  LoaderCircle,
  Quote,
  RefreshCcw,
  Search,
  X,
} from 'lucide-react'
import {
  fetchBusinessProjectDiff,
  fetchBusinessProjectFileContent,
  fetchBusinessProjectFiles,
} from '../api/businessBackend'
import type { CodeSelectionReference, WorkspaceDiffSnapshot, WorkspaceFileContent, WorkspaceFileNode } from '../types'
import { GlassPanel } from './GlassPanel'

type CodeWorkspaceDialogProps = {
  open: boolean
  projectId?: string
  workspaceName?: string
  onClose: () => void
  onQuoteSelection: (selection: CodeSelectionReference) => void
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

type MonacoEditorInstance = import('monaco-editor').editor.IStandaloneCodeEditor
type MonacoNamespace = typeof import('monaco-editor')
type MonacoThemeData = import('monaco-editor').editor.IStandaloneThemeData
type MonacoDisposable = import('monaco-editor').IDisposable

const CODE_EDITOR_THEME = 'agenthub-dark'

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
 * Clips one long text fragment for compact labels.
 * Input: raw text and max length. Output: one compact single-line label.
 */
function compactLabel(text: string, maxLength = 90): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
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
 * Renders the full-screen code workspace dialog for one project workspace.
 * Input: open state, project identity, and quote callback.
 * Output: file tree and read-only code browser dialog.
 */
export function CodeWorkspaceDialog({
  open,
  projectId,
  workspaceName,
  onClose,
  onQuoteSelection,
}: CodeWorkspaceDialogProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const editorShellRef = useRef<HTMLDivElement | null>(null)
  const activeFilePathRef = useRef<string | undefined>(undefined)
  const activeLanguageRef = useRef<string | undefined>(undefined)
  const editorDisposablesRef = useRef<MonacoDisposable[]>([])
  const selectionDraftRef = useRef<EditorSelectionState | undefined>(undefined)
  const selectionCommitTimerRef = useRef<number | undefined>(undefined)
  const pointerSelectionRef = useRef(false)
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

  useEffect(() => {
    activeFilePathRef.current = activeFilePath
    activeLanguageRef.current = activeFileContent?.language
  }, [activeFileContent?.language, activeFilePath])

  useEffect(() => {
    return () => {
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
   * Loads the current project file browser snapshot from the local backend.
   * Input: optional preferred active file path.
   * Output: updates file tree, diff state, and active file selection.
   */
  async function loadWorkspaceBrowser(preferredActiveFilePath?: string) {
    if (!projectId) {
      return
    }

    setTreeLoading(true)
    setTreeError('')

    try {
      const [treeSnapshot, nextDiff] = await Promise.all([
        fetchBusinessProjectFiles(projectId),
        fetchBusinessProjectDiff(projectId).catch(() => undefined),
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
      setExpandedPaths(previous => ({
        ...previous,
        ...expandAncestors(nextActiveFilePath),
      }))
      setActiveFilePath(nextActiveFilePath)
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : 'Failed to load workspace files.')
    } finally {
      setTreeLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      clearSelectionCommitTimer()
      disposeEditorListeners()
      pointerSelectionRef.current = false
      selectionDraftRef.current = undefined
      editorRef.current = null
      setEditorViewport({
        width: 0,
        height: 0,
      })
      return
    }
    if (!projectId) {
      return
    }

    setFileTree([])
    setFileCache({})
    setDiffSnapshot(undefined)
    setSelectionState(undefined)
    setExpandedPaths({})
    setActiveFilePath(undefined)
    setFileQuery('')
    setWrapMode('on')
    selectionDraftRef.current = undefined
    pointerSelectionRef.current = false

    void loadWorkspaceBrowser()
  }, [open, projectId])

  useEffect(() => {
    if (!open) {
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
  }, [open, activeFilePath, activeFileContent?.path])

  useEffect(() => {
    if (!open || !projectId || !activeFilePath) {
      return
    }
    const cachedEntry = fileCache[activeFilePath]
    if (cachedEntry?.content || cachedEntry?.error) {
      return
    }

    let cancelled = false
    const currentProjectId: string = projectId
    const currentFilePath: string = activeFilePath

    async function loadFileContent() {
      setSelectionState(undefined)
      setFileCache(previous => ({
        ...previous,
        [currentFilePath]: {
          loading: true,
        },
      }))

      try {
        const content = await fetchBusinessProjectFileContent(currentProjectId, currentFilePath)
        if (cancelled) {
          return
        }
        setFileCache(previous => ({
          ...previous,
          [currentFilePath]: {
            loading: false,
            content,
          },
        }))
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
   * Refreshes the tree and diff state for the current workspace.
   * Input: none.
   * Output: reloads browser data from the local backend.
   */
  async function handleRefresh() {
    await loadWorkspaceBrowser(activeFilePath)
  }

  if (!open) {
    return null
  }

  return (
    <div className="code-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="code-dialog__surface" role="presentation" onClick={event => event.stopPropagation()}>
        <GlassPanel className="code-dialog">
          <header className="code-dialog__header">
            <div>
              <p className="eyebrow">Workspace Code</p>
              <h2>{workspaceName ?? '当前工作区代码'}</h2>
              <span>
                {treeRootLabel ? `当前工作区范围：${treeRootLabel}` : '当前工作区范围：repo'}
              </span>
              <span>
                {changedFileCount > 0 ? `当前工作区有 ${changedFileCount} 个本地变更文件` : '当前工作区当前没有本地变更文件'}
              </span>
            </div>
            <div className="code-dialog__actions">
              <button className="icon-button code-dialog__icon-button" type="button" onClick={() => void handleRefresh()} title="刷新文件树">
                <RefreshCcw className={treeLoading ? 'icon-spin' : ''} size={16} />
              </button>
              <button className="icon-button code-dialog__icon-button" type="button" onClick={onClose} title="关闭代码面板">
                <X size={16} />
              </button>
            </div>
          </header>

          <div className="code-dialog__layout">
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
                      setActiveFilePath(filePath)
                      setExpandedPaths(previous => ({
                        ...previous,
                        ...expandAncestors(filePath),
                      }))
                    }}
                  />
                ) : (
                  <div className="code-tree__empty">没有匹配的文件。</div>
                )}
              </div>
            </aside>

            <section className="code-editor-panel">
              <div className="code-editor-panel__top">
                <div className="code-editor-toolbar">
                  <div className="code-editor-toolbar__meta">
                    <strong>{activeFileContent?.path ?? activeFilePath ?? '未选择文件'}</strong>
                    <span>
                      {activeFileContent
                        ? `${activeFileContent.language} · ${activeFileContent.lineCount} lines · ${activeFileContent.byteLength} bytes`
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

              </div>

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

                {selectionState ? (
                  <div className="code-selection-banner code-selection-banner--floating" role="status" aria-live="polite">
                    <span>
                      {selectionState.filePath}:{selectionState.startLine}:{selectionState.startColumn} - {selectionState.endLine}:
                      {selectionState.endColumn}
                    </span>
                    <small>{compactLabel(selectionState.selectedText)}</small>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </GlassPanel>
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
