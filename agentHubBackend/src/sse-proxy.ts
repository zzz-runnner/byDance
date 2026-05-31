import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { FastifyReply } from 'fastify'

const BLOCKED_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'transfer-encoding',
])

/**
 * Returns upstream headers that are safe to forward downstream.
 * Input: upstream response headers.
 * Output: filtered header entries for the downstream response.
 */
function safeHeaderEntries(headers: Headers): Array<[string, string]> {
  return [...headers.entries()].filter(([name]) => !BLOCKED_HEADERS.has(name.toLowerCase()))
}

/**
 * Copies safe upstream headers onto a buffered Fastify reply.
 * Input: Fastify reply and upstream headers.
 * Output: reply headers updated in place.
 */
function applyReplyHeaders(reply: FastifyReply, headers: Headers): void {
  for (const [name, value] of safeHeaderEntries(headers)) {
    reply.header(name, value)
  }
}

/**
 * Copies safe upstream headers onto a hijacked raw HTTP response.
 * Input: Fastify reply and upstream headers.
 * Output: raw response headers written in place.
 */
function writeRawHeaders(reply: FastifyReply, upstream: Response): void {
  reply.raw.writeHead(upstream.status, Object.fromEntries(safeHeaderEntries(upstream.headers)))
}

/**
 * Buffers one upstream response before returning it to the caller.
 * Input: Fastify reply and upstream response.
 * Output: full response body sent through Fastify.
 */
export async function sendBufferedUpstreamResponse(reply: FastifyReply, upstream: Response): Promise<void> {
  reply.code(upstream.status)
  applyReplyHeaders(reply, upstream.headers)

  const body = Buffer.from(await upstream.arrayBuffer())
  reply.send(body)
}

/**
 * Streams one upstream SSE response to the browser without buffering.
 * Input: Fastify reply and upstream response.
 * Output: hijacked raw response that mirrors the upstream stream.
 */
export async function sendSseUpstreamResponse(reply: FastifyReply, upstream: Response): Promise<void> {
  reply.hijack()
  writeRawHeaders(reply, upstream)

  if (!upstream.body) {
    reply.raw.end(await upstream.text())
    return
  }

  const stream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream)
  await pipeline(stream, reply.raw)
}
