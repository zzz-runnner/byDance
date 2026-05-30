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
  sourceRootLabel?: string
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

type MonacoEditorInstance = import('monaco-editor').editor.IStandaloneCodeEditor

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
 * Renders the full-screen code workspace dialog for one project workspace.
 * Input: open state, project identity, and quote callback.
 * Output: file tree and read-only code browser dialog.
 */
export function CodeWorkspaceDialog({
  open,
  projectId,
  workspaceName,
  sourceRootLabel,
  onClose,
  onQuoteSelection,
}: CodeWorkspaceDialogProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const editorShellRef = useRef<HTMLDivElement | null>(null)
  const activeFilePathRef = useRef<string | undefined>(undefined)
  const activeLanguageRef = useRef<string | undefined>(undefined)
  const [fileTree, setFileTree] = useState<WorkspaceFileNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState('')
  const [fileQuery, setFileQuery] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({})
  const [activeFilePath, setActiveFilePath] = useState<string>()
  const [fileCache, setFileCache] = useState<Record<string, FileCacheEntry>>({})
  const [diffSnapshot, setDiffSnapshot] = useState<WorkspaceDiffSnapshot>()
  const [selectionState, setSelectionState] = useState<EditorSelectionState>()
  const [treeRootLabel, setTreeRootLabel] = useState(sourceRootLabel ?? '')
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
    setTreeRootLabel(sourceRootLabel ?? '')
  }, [sourceRootLabel])

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
      setTreeRootLabel(treeSnapshot.rootLabel || sourceRootLabel || '')
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
    setSelectionState(buildCodeSelection(editorRef.current, activeFilePath, activeFileContent?.language))
  }, [activeFileContent, activeFilePath])

  /**
   * Recomputes the structured code selection from the current editor state.
   * Input: none.
   * Output: updates the dialog selection state.
   */
  function syncSelectionState() {
    setSelectionState(buildCodeSelection(editorRef.current, activeFilePathRef.current, activeLanguageRef.current))
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
              <h2>{workspaceName ?? '代码工作区'}</h2>
              <span>
                {treeRootLabel ? `当前浏览真实源码根目录：${treeRootLabel}` : '当前浏览真实源码根目录'}
              </span>
              <span>
                {changedFileCount > 0 ? `当前工作区有 ${changedFileCount} 个本地变更文件` : '当前工作区还没有未提交改动'}
              </span>
            </div>
            <div className="code-dialog__actions">
              <button className="icon-button" type="button" onClick={() => void handleRefresh()} title="刷新文件树">
                <RefreshCcw className={treeLoading ? 'icon-spin' : ''} size={16} />
              </button>
              <button className="icon-button" type="button" onClick={onClose} title="关闭代码面板">
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
              <div className="code-editor-toolbar">
                <div className="code-editor-toolbar__meta">
                  <strong>{activeFileContent?.path ?? activeFilePath ?? '未选择文件'}</strong>
                  <span>
                    {activeFileContent
                      ? `${activeFileContent.language} · ${activeFileContent.lineCount} lines · ${activeFileContent.byteLength} bytes`
                      : '选择一个文本文件后即可查看代码'}
                  </span>
                </div>
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

              {selectionState ? (
                <div className="code-selection-banner">
                  <span>
                    {selectionState.filePath}:{selectionState.startLine}:{selectionState.startColumn} - {selectionState.endLine}:
                    {selectionState.endColumn}
                  </span>
                  <small>{compactLabel(selectionState.selectedText)}</small>
                </div>
              ) : null}

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
                    options={{
                      readOnly: true,
                      fontSize: 13,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      automaticLayout: true,
                      renderLineHighlight: 'line',
                      lineNumbersMinChars: 3,
                    }}
                    onMount={editor => {
                      editorRef.current = editor
                      editor.layout({
                        width: Math.max(editorViewport.width, 1),
                        height: Math.max(editorViewport.height, 1),
                      })
                      window.requestAnimationFrame(() => {
                        editor.layout()
                      })
                      window.setTimeout(() => {
                        editor.layout()
                      }, 140)
                      editor.onDidChangeCursorSelection(() => {
                        syncSelectionState()
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
