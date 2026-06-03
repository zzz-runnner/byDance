import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { unzipSync } from 'fflate'

const MAX_DOCUMENT_PREVIEW_BYTES = 16 * 1024 * 1024
const DOCUMENT_PREVIEW_SECTION_LIMIT = 80
const DOCUMENT_PREVIEW_TEXT_LIMIT = 24_000

export type WorkspaceDocumentPreview = {
  kind: 'pdf' | 'docx' | 'pptx'
  path: string
  name: string
  byteLength: number
  updatedAt: string
  sourceUrl: string
  summary: string
  textContent?: string
  sections?: Array<{
    title: string
    content: string
  }>
}

/**
 * Returns whether one repo-relative file path supports the document preview MVP.
 * Input: repo-relative file path.
 * Output: true when the file can be previewed locally.
 */
export function isWorkspaceDocumentPreviewable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.pdf' || ext === '.docx' || ext === '.pptx'
}

/**
 * Loads one preview payload for a supported PDF, Word, or PowerPoint file.
 * Input: absolute file path, repo-relative path, and browser-open URL.
 * Output: lightweight preview content for the frontend.
 */
export async function readWorkspaceDocumentPreview(
  absoluteFilePath: string,
  relativeFilePath: string,
  sourceUrl: string,
): Promise<WorkspaceDocumentPreview> {
  if (!isWorkspaceDocumentPreviewable(relativeFilePath)) {
    throw new Error('This file type is not supported by the document preview MVP.')
  }

  const fileStat = await stat(absoluteFilePath)
  if (!fileStat.isFile()) {
    throw new Error('Document preview target is not a regular file.')
  }
  if (fileStat.size > MAX_DOCUMENT_PREVIEW_BYTES) {
    throw new Error(`Document preview file is too large (${fileStat.size} bytes).`)
  }

  const ext = path.extname(relativeFilePath).toLowerCase()
  const base = {
    path: relativeFilePath.replace(/\\/g, '/'),
    name: path.basename(relativeFilePath),
    byteLength: fileStat.size,
    updatedAt: fileStat.mtime.toISOString(),
    sourceUrl,
  }

  if (ext === '.pdf') {
    return {
      ...base,
      kind: 'pdf',
      summary: 'PDF 预览支持原文件内嵌查看。',
    }
  }

  const archive = normalizeArchiveEntries(unzipSync(new Uint8Array(await readFile(absoluteFilePath))))
  if (ext === '.docx') {
    const documentXml = readArchiveText(archive, 'word/document.xml')
    const sections = buildDocxSections(documentXml)
    const textContent = sections.map(section => `${section.title}\n${section.content}`).join('\n\n').slice(0, DOCUMENT_PREVIEW_TEXT_LIMIT)
    return {
      ...base,
      kind: 'docx',
      summary: `Word 预览提取了 ${sections.length} 段正文内容。`,
      textContent,
      sections,
    }
  }

  const slideEntries = Object.keys(archive)
    .filter(entry => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const sections = slideEntries
    .map((entry, index) => {
      const content = buildPptSlideText(readArchiveText(archive, entry))
      return content
        ? {
            title: `Slide ${index + 1}`,
            content,
          }
        : undefined
    })
    .filter((section): section is { title: string; content: string } => Boolean(section))
    .slice(0, DOCUMENT_PREVIEW_SECTION_LIMIT)

  return {
    ...base,
    kind: 'pptx',
    summary: `PowerPoint 预览提取了 ${sections.length} 页幻灯片文本。`,
    textContent: sections.map(section => `${section.title}\n${section.content}`).join('\n\n').slice(0, DOCUMENT_PREVIEW_TEXT_LIMIT),
    sections,
  }
}

/**
 * Reads one UTF-8 XML payload from a zip entry and throws a readable error when absent.
 * Input: unzipped archive map and entry path.
 * Output: decoded XML text.
 */
function readArchiveText(archive: Record<string, Uint8Array>, entryPath: string): string {
  const content = archive[entryPath]
  if (!content) {
    throw new Error(`Document preview archive entry is missing: ${entryPath}`)
  }
  return new TextDecoder().decode(content)
}

/**
 * Normalizes zip entry keys to forward-slash paths so previews work with
 * archives created on Windows as well as Unix-like systems.
 * Input: raw unzipped archive map.
 * Output: archive map keyed by normalized forward-slash entry paths.
 */
function normalizeArchiveEntries(archive: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const normalized: Record<string, Uint8Array> = {}
  for (const [entryPath, content] of Object.entries(archive)) {
    normalized[entryPath.replace(/\\/g, '/')] = content
  }
  return normalized
}

/**
 * Decodes the XML entities commonly found in Office document text runs.
 * Input: XML text fragment.
 * Output: human-readable plain text.
 */
function decodeXmlText(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/**
 * Extracts readable Word paragraph sections from one DOCX document XML payload.
 * Input: `word/document.xml` text.
 * Output: ordered paragraph sections clipped for frontend display.
 */
function buildDocxSections(documentXml: string): Array<{ title: string; content: string }> {
  const paragraphs = documentXml
    .split(/<w:p\b[^>]*>/i)
    .map(chunk => decodeXmlText([...chunk.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)].map(match => match[1] ?? '').join('')))
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, DOCUMENT_PREVIEW_SECTION_LIMIT)

  return paragraphs.map((content, index) => ({
    title: `Paragraph ${index + 1}`,
    content: content.slice(0, DOCUMENT_PREVIEW_TEXT_LIMIT),
  }))
}

/**
 * Extracts readable slide text from one PPTX slide XML payload.
 * Input: slide XML text.
 * Output: concatenated slide text in reading order.
 */
function buildPptSlideText(slideXml: string): string {
  return decodeXmlText([...slideXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)].map(match => match[1] ?? '').join(' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DOCUMENT_PREVIEW_TEXT_LIMIT)
}
