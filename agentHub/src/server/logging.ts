import { randomUUID } from 'node:crypto'
import type { DiagnosticLog } from '@shared/contracts'
import { isoNow } from '@shared/contracts'

export type DiagnosticLogInput = Omit<DiagnosticLog, 'id' | 'createdAt'>

/**
 * Creates a structured diagnostic log row.
 * Input: diagnostic log fields without id and timestamp. Output: complete diagnostic log.
 */
export function createDiagnosticLog(input: DiagnosticLogInput): DiagnosticLog {
  return {
    ...input,
    id: `diag-${randomUUID()}`,
    createdAt: isoNow(),
  }
}
