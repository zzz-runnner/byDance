import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { checkCodexBridge } from '../../src/server/adapters/codex-bridge'

let server: net.Server | undefined

afterEach(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve())
  server = undefined
})

/**
 * Starts a local TCP server for bridge availability checks.
 * Input: none. Output: listening port.
 */
async function startTcpServer(): Promise<number> {
  server = net.createServer(socket => socket.end())
  await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('TCP test server did not return a port.')
  }
  return address.port
}

describe('checkCodexBridge', () => {
  it('passes when the configured bridge port accepts TCP connections', async () => {
    const port = await startTcpServer()
    const result = await checkCodexBridge(`http://127.0.0.1:${port}/v1`, 500)

    expect(result.ok).toBe(true)
  })

  it('fails quickly when the bridge URL is invalid', async () => {
    const result = await checkCodexBridge('not a url', 500)

    expect(result.ok).toBe(false)
    expect(result.ok || result.reason).toBe('invalid_url')
  })
})
