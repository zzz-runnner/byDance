const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g
const EMPTY_BULLET_PATTERN = /^\s*(?:[-*+]|(?:\d+\.))\s*$/
const EMPTY_HEADING_PATTERN = /^\s*#{1,6}\s*$/
const THEMATIC_BREAK_PATTERN = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)$/
const TABLE_SEPARATOR_PATTERN = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/
const MARKDOWN_BLOCK_PATTERN =
  /^\s{0,3}(?:#{1,6}\s|>\s?|[-*+]\s|\d+\.\s|```|~~~|\|.+\||-{3,}|\*{3,}|_{3,})/

type FenceState = {
  char: '`' | '~'
  length: number
}

export type NormalizeAiMarkdownMode = 'bubble' | 'compact' | 'panel' | 'process' | 'document'

type NormalizeAiMarkdownOptions = {
  mode?: NormalizeAiMarkdownMode
}

export function normalizeAiMarkdown(content: string, options: NormalizeAiMarkdownOptions = {}): string {
  if (!content.trim()) {
    return ''
  }

  const normalizedLineEndings = content
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH_PATTERN, '')
    .replace(/\u00A0/g, ' ')

  const lines = normalizedLineEndings.split('\n')
  const cleanedLines: string[] = []
  let previousWasBreak = false
  let blankLineCount = 0
  let openFenceState: FenceState | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, '')

    if (!line.trim()) {
      blankLineCount += 1
      if (blankLineCount <= 2) {
        cleanedLines.push('')
      }
      previousWasBreak = false
      continue
    }

    blankLineCount = 0

    if (EMPTY_BULLET_PATTERN.test(line) || EMPTY_HEADING_PATTERN.test(line)) {
      continue
    }

    if (THEMATIC_BREAK_PATTERN.test(line)) {
      if (previousWasBreak) {
        continue
      }
      cleanedLines.push('---')
      previousWasBreak = true
      continue
    }

    previousWasBreak = false

    const fenceMatch = line.match(FENCE_PATTERN)
    if (fenceMatch) {
      const marker = fenceMatch[2]
      const markerChar = marker[0] as FenceState['char']
      if (openFenceState && openFenceState.char === markerChar && marker.length >= openFenceState.length) {
        openFenceState = null
      } else {
        openFenceState = { char: markerChar, length: marker.length }
      }
      cleanedLines.push(line)
      continue
    }

    cleanedLines.push(line)
  }

  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] === '') {
    cleanedLines.pop()
  }

  if (openFenceState) {
    if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== '') {
      cleanedLines.push('')
    }
    cleanedLines.push(openFenceState.char.repeat(openFenceState.length))
  }

  const normalizedText = cleanedLines.join('\n')

  if (!shouldPreserveSoftBreaks(options.mode)) {
    return normalizedText
  }

  return preserveSoftBreaks(normalizedText)
}

function shouldPreserveSoftBreaks(mode: NormalizeAiMarkdownMode | undefined): boolean {
  return mode === 'bubble' || mode === 'process' || mode === 'document'
}

function preserveSoftBreaks(content: string): string {
  const lines = content.split('\n')
  const nextLines = lines.slice()
  let openFence: FenceState | null = null

  for (let index = 0; index < lines.length - 1; index += 1) {
    const currentLine = nextLines[index]
    const nextLine = nextLines[index + 1]

    const fenceMatch = currentLine.match(FENCE_PATTERN)
    if (fenceMatch) {
      const marker = fenceMatch[2]
      const markerChar = marker[0] as FenceState['char']
      if (openFence && openFence.char === markerChar && marker.length >= openFence.length) {
        openFence = null
      } else {
        openFence = { char: markerChar, length: marker.length }
      }
      continue
    }

    if (openFence) {
      continue
    }

    if (!isPlainMarkdownLine(currentLine) || !isPlainMarkdownLine(nextLine)) {
      continue
    }

    nextLines[index] = `${currentLine}  `
  }

  return nextLines.join('\n')
}

function isPlainMarkdownLine(line: string): boolean {
  const trimmed = line.trim()

  if (!trimmed) {
    return false
  }

  if (MARKDOWN_BLOCK_PATTERN.test(line) || TABLE_SEPARATOR_PATTERN.test(line)) {
    return false
  }

  return true
}
