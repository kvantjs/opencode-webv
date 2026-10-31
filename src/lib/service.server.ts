import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Service, type Endpoint } from '@opencode/client/service'

export function createServiceConnection(dependencies: {
  discover: () => Promise<Endpoint | undefined>
  start: () => Promise<unknown>
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}) {
  let pending: Promise<Endpoint> | undefined
  const endpoint = () =>
    (pending ??= (async () => {
      const found = await dependencies.discover()
      if (found) return found
      await dependencies.start()
      const started = await dependencies.discover()
      if (!started) throw new Error('OpenCode service did not start')
      return started
    })().catch((error) => {
      pending = undefined
      throw error
    }))

  return async (path: string, init?: RequestInit) => {
    const target = await endpoint()
    const send = (current: Endpoint) =>
      dependencies.fetch(new URL(path, current.url), {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          ...Service.headers(current),
        },
      })
    try {
      const response = await send(target)
      if (response.status !== 401) return response
      await response.body?.cancel()
    } catch (error) {
      if (init?.signal?.aborted) throw error
    }
    // A failed transport may have admitted a mutation before losing its response.
    pending = undefined
    const current = await endpoint()
    if (init?.method && !['GET', 'HEAD'].includes(init.method)) {
      throw new Error('OpenCode service restarted. Refresh and try again.')
    }
    return send(current)
  }
}

import { handleGeminiServiceRequest } from './gemini-service.server'

export const serviceFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  // If external OPENCODE_URL is explicitly configured, attempt to forward to it
  if (process.env.OPENCODE_URL) {
    try {
      const targetUrl = new URL(path, process.env.OPENCODE_URL)
      const headers = new Headers(init?.headers)
      if (process.env.OPENCODE_TOKEN) {
        headers.set('authorization', `Bearer ${process.env.OPENCODE_TOKEN}`)
      }
      return await fetch(targetUrl, { ...init, headers })
    } catch (err) {
      console.warn('OPENCODE_URL fetch failed, using built-in Gemini engine:', err)
    }
  }

  // Built-in Gemini service engine
  return handleGeminiServiceRequest(path, init)
}
