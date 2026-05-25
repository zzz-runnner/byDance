import type { ReviewVerdictResult } from './types'

/**
 * Extracts a compact issue list from reviewer text.
 * Input: reviewer output text. Output: up to six issue summaries.
 */
function extractIssues(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*#\s\d.]+/, '').trim())
    .filter(line => line.length > 0)
    .filter(line => /(issue|problem|missing|failed|fail|partial|blocker|risk|not implemented|not delivered)/i.test(line))
    .slice(0, 6)
}

/**
 * Parses PASS, PARTIAL, or FAIL from a reviewer report.
 * Input: reviewer output text. Output: structured reviewer verdict.
 */
export function parseReviewVerdict(content: string): ReviewVerdictResult {
  const normalized = content.replace(/\s+/g, ' ').trim()
  const upper = normalized.toUpperCase()
  const verdict = /\bFAIL\b|VERDICT[:\s*]+FAIL|CONCLUSION[:\s*]+FAIL/.test(upper)
    ? 'fail'
    : /\bPARTIAL\b|VERDICT[:\s*]+PARTIAL|CONCLUSION[:\s*]+PARTIAL/.test(upper)
      ? 'partial'
      : /\bPASS\b|VERDICT[:\s*]+PASS|CONCLUSION[:\s*]+PASS/.test(upper)
        ? 'pass'
        : 'unknown'

  return {
    verdict,
    summary: normalized.slice(0, 360) || 'Reviewer did not return readable output.',
    issues: extractIssues(content),
  }
}
