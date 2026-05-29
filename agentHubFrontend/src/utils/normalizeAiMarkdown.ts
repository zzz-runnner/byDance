const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g
const EMPTY_BULLET_PATTERN = /^\s*(?:[-*+]|(?:\d+\.))\s*$/
const EMPTY_HEADING_PATTERN = /^\s*#{1,6}\s*$/
const THEMATIC_BREAK_PATTERN = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)$/

type FenceState = {
  char: '`' | '~'
  length: number
}

/**
 * Normalizes AI-authored Markdown for stable chat rendering.
 * Input: raw AI response text that may contain malformed spacing or separators.
 * Output: Markdown text with lightweight cleanup while preserving valid syntax.
 */
export function normalizeAiMarkdown(content: string): string {
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

    if (EMPTY_BULLET_PATTERN.test(line)) {
      continue
    }

    if (EMPTY_HEADING_PATTERN.test(line)) {
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

  return cleanedLines.join('\n')
}
