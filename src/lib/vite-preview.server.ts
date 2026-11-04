import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

interface PreviewInstance {
  server: ViteDevServer
  port: number
  lastUsed: number
}

const previewInstances = new Map<string, Promise<PreviewInstance>>()
const PREVIEW_IDLE_TTL_MS = 30 * 60 * 1000

function basePathFor(sessionId: string) {
  return `/api/proxy/api/session/${encodeURIComponent(sessionId)}/preview/`
}

async function closeIdlePreviews() {
  const cutoff = Date.now() - PREVIEW_IDLE_TTL_MS
  for (const [sessionId, instancePromise] of previewInstances) {
    const instance = await instancePromise.catch(() => undefined)
    if (instance && instance.lastUsed < cutoff) {
      previewInstances.delete(sessionId)
      await instance.server.close().catch(() => {})
    }
  }
}

async function getPreviewInstance(sessionId: string, workspaceDir: string): Promise<PreviewInstance> {
  await closeIdlePreviews()
  const existing = previewInstances.get(sessionId)
  if (existing) {
    const instance = await existing
    instance.lastUsed = Date.now()
    return instance
  }

  const starting = (async () => {
    await fs.mkdir(workspaceDir, { recursive: true })
    let configPath: string | undefined
    for (const configName of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cts', 'vite.config.cjs']) {
      const candidate = path.join(workspaceDir, configName)
      try {
        await fs.access(candidate)
        configPath = candidate
        break
      } catch {}
    }

    const server = await createServer({
      root: workspaceDir,
      base: basePathFor(sessionId),
      // Honor an agent-generated Vite config; for bare React workspaces supply
      // the official Vite React plugin rather than a hand-written JSX transpiler.
      configFile: configPath || false,
      plugins: configPath ? [] : [react()],
      appType: 'spa',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        hmr: false,
        cors: true,
      },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') {
      await server.close()
      throw new Error('Vite did not expose a local HTTP port for this session.')
    }
    return { server, port: address.port, lastUsed: Date.now() }
  })()
  previewInstances.set(sessionId, starting)

  try {
    return await starting
  } catch (error) {
    if (previewInstances.get(sessionId) === starting) previewInstances.delete(sessionId)
    throw error
  }
}

export async function serveVitePreview(
  sessionId: string,
  workspaceDir: string,
  request: Request,
  relativePath: string,
): Promise<Response> {
  const instance = await getPreviewInstance(sessionId, workspaceDir)
  instance.lastUsed = Date.now()

  const pathname = relativePath.replace(/^\/+/, '')
  const upstreamUrl = new URL(
    `${basePathFor(sessionId)}${pathname}${new URL(request.url).search}`,
    `http://127.0.0.1:${instance.port}`,
  )
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('connection')

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal,
  })
  const responseHeaders = new Headers(upstream.headers)
  responseHeaders.delete('connection')
  responseHeaders.delete('transfer-encoding')
  responseHeaders.delete('content-length')
  responseHeaders.set('cache-control', 'no-store')
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export async function closeVitePreview(sessionId: string) {
  const instancePromise = previewInstances.get(sessionId)
  if (!instancePromise) return
  previewInstances.delete(sessionId)
  const instance = await instancePromise.catch(() => undefined)
  await instance?.server.close()
}
