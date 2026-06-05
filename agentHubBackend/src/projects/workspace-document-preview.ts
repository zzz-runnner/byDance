import path from 'node:path'
import { stat } from 'node:fs/promises'

const MAX_DOCUMENT_PREVIEW_BYTES = 16 * 1024 * 1024

export type WorkspaceDocumentPreviewKind = 'pdf' | 'docx' | 'pptx'

export type WorkspaceDocumentPreview = {
  kind: WorkspaceDocumentPreviewKind
  path: string
  name: string
  byteLength: number
  updatedAt: string
  sourceUrl: string
  summary: string
}

/**
 * Returns whether one repo-relative file path supports browser-side document preview.
 * Input: repo-relative file path.
 * Output: true when the frontend can preview the file in-browser.
 */
export function isWorkspaceDocumentPreviewable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.pdf' || ext === '.docx' || ext === '.pptx'
}

/**
 * Builds one lightweight preview descriptor for browser-side document rendering.
 * Input: absolute file path, repo-relative path, and browser-open URL.
 * Output: file metadata plus preview kind and source URL.
 */
export async function readWorkspaceDocumentPreview(
  absoluteFilePath: string,
  relativeFilePath: string,
  sourceUrl: string,
): Promise<WorkspaceDocumentPreview> {
  if (!isWorkspaceDocumentPreviewable(relativeFilePath)) {
    throw new Error('This file type is not supported by the document preview panel.')
  }

  const fileStat = await stat(absoluteFilePath)
  if (!fileStat.isFile()) {
    throw new Error('Document preview target is not a regular file.')
  }
  if (fileStat.size > MAX_DOCUMENT_PREVIEW_BYTES) {
    throw new Error(`Document preview file is too large (${fileStat.size} bytes).`)
  }

  const kind = path.extname(relativeFilePath).slice(1).toLowerCase() as WorkspaceDocumentPreviewKind
  const summary =
    kind === 'pdf'
      ? 'PDF 文件使用浏览器内嵌预览。'
      : kind === 'docx'
        ? 'DOCX 文件使用前端渲染预览。'
        : 'PPTX 文件使用前端渲染预览。'

  return {
    kind,
    path: relativeFilePath.replace(/\\/g, '/'),
    name: path.basename(relativeFilePath),
    byteLength: fileStat.size,
    updatedAt: fileStat.mtime.toISOString(),
    sourceUrl,
    summary,
  }
}
