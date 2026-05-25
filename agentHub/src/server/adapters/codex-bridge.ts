import net from 'node:net'

export type CodexBridgeCheckResult =
  | { ok: true; host: string; port: number }
  | { ok: false; host: string; port: number; reason: 'invalid_url' | 'unreachable'; message: string }

/**
 * Opens a short TCP connection to the configured Codex bridge.
 * Input: bridge URL and timeout in milliseconds. Output: bridge availability result.
 */
export async function checkCodexBridge(url: string, timeoutMs = 1500): Promise<CodexBridgeCheckResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return {
      ok: false,
      host: '',
      port: 0,
      reason: 'invalid_url',
      message: `Invalid Codex bridge URL: ${url}`,
    }
  }

  const host = parsed.hostname
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
  if (!host || !Number.isFinite(port) || port <= 0) {
    return {
      ok: false,
      host,
      port,
      reason: 'invalid_url',
      message: `Invalid Codex bridge host or port: ${url}`,
    }
  }

  return new Promise(resolve => {
    const socket = net.createConnection({ host, port })
    const finish = (result: CodexBridgeCheckResult): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ ok: true, host, port }))
    socket.once('timeout', () => finish({
      ok: false,
      host,
      port,
      reason: 'unreachable',
      message: `Codex bridge is not reachable at ${host}:${port}. Run npm run codex:bridge first.`,
    }))
    socket.once('error', error => finish({
      ok: false,
      host,
      port,
      reason: 'unreachable',
      message: `Codex bridge is not reachable at ${host}:${port}. Run npm run codex:bridge first. ${error.message}`,
    }))
  })
}
