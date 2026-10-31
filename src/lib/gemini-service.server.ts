import { promises as fs } from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { GoogleGenAI, Type } from '@google/genai'
import type {
  AgentInfo,
  CommandInfo,
  ModelInfo,
  Project as ApiProject,
  PromptFileAttachment,
  ProviderInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
  SkillInfo,
} from '@opencode/client'

const execAsync = promisify(exec)

// --- Types & Data Structures ---

export interface StoredData {
  projects: ApiProject[]
  sessions: SessionInfo[]
  messages: Record<string, SessionMessageInfo[]>
}

const STORAGE_FILE = path.join(process.cwd(), '.opencode', 'storage.json')

// Gemini AI Client
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  })
}

// Active Generation Abort Controllers
const activeControllers = new Map<string, AbortController>()
// Active Busy Sessions Set
const busySessions = new Set<string>()

// SSE Subscribers
type EventSubscriber = (event: Record<string, any>) => void
const eventSubscribers = new Set<EventSubscriber>()

export function broadcastEvent(event: Record<string, any>) {
  for (const subscriber of eventSubscribers) {
    try {
      subscriber(event)
    } catch {
      // ignore dropped subscribers
    }
  }
}

// Default Gemini Models
export const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.8-flash',
    modelID: 'gemini-3.8-flash',
    providerID: 'google',
    name: 'Gemini 3.8 Flash',
    family: 'gemini',
    status: 'active',
    enabled: true,
    capabilities: {
      input: ['text', 'image', 'audio', 'video'],
      output: ['text'],
      tools: true,
    },
    variants: [],
    time: { released: 1730000000000 },
    cost: [],
    limit: { context: 1048576, output: 8192 },
  },
  {
    id: 'gemini-3.1-flash-lite',
    modelID: 'gemini-3.1-flash-lite',
    providerID: 'google',
    name: 'Gemini 3.1 Flash Lite',
    family: 'gemini',
    status: 'active',
    enabled: true,
    capabilities: {
      input: ['text', 'image', 'audio', 'video'],
      output: ['text'],
      tools: true,
    },
    variants: [],
    time: { released: 1730000000000 },
    cost: [],
    limit: { context: 1048576, output: 8192 },
  },
  {
    id: 'gemini-4-argon',
    modelID: 'gemini-4-argon',
    providerID: 'google',
    name: 'Gemini 4 Argon',
    family: 'gemini',
    status: 'active',
    enabled: true,
    capabilities: {
      input: ['text', 'image', 'audio', 'video'],
      output: ['text'],
      tools: true,
    },
    variants: [],
    time: { released: 1730000000000 },
    cost: [],
    limit: { context: 1048576, output: 8192 },
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    modelID: 'gemini-3.1-flash-lite-image',
    providerID: 'google',
    name: 'Gemini 3.1 Flash Lite Image',
    family: 'gemini',
    status: 'active',
    enabled: true,
    capabilities: {
      input: ['text', 'image', 'audio', 'video'],
      output: ['text'],
      tools: true,
    },
    variants: [],
    time: { released: 1730000000000 },
    cost: [],
    limit: { context: 1048576, output: 8192 },
  },
]

export const GEMINI_PROVIDER: ProviderInfo = {
  id: 'google',
  name: 'Google Gemini',
  activation: 'auto',
  package: '@google/genai',
}

export const AGENTS: AgentInfo[] = [
  {
    id: 'build',
    name: 'Build Agent',
    mode: 'primary',
    hidden: false,
    description: 'Autonomous full-stack engineer for writing code, executing builds, running tests, and refactoring.',
    system: 'You are the autonomous Build Agent, an elite full-stack software engineer. You analyze codebases, execute terminal commands (like npm run build, tests, git), read and write files, write unit tests, and implement robust features with production-grade code.',
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  },
  {
    id: 'chat',
    name: 'Chat Agent',
    mode: 'primary',
    hidden: false,
    description: 'Conversational coding assistant for architecture discussions, code explanation, and Q&A.',
    system: 'You are the Chat Agent, a knowledgeable software engineering assistant. You help explain concepts, design architectures, and answer technical questions clearly and thoroughly.',
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  },
  {
    id: 'review',
    name: 'Code Reviewer',
    mode: 'primary',
    hidden: false,
    description: 'Specialized code review agent inspecting code quality, security vulnerabilities, performance, and best practices.',
    system: 'You are the Code Reviewer Agent, a principal software engineer. You perform rigorous, constructive code reviews, identifying security flaws, performance bottlenecks, code smells, type errors, and maintainability improvements.',
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  },
]

export const COMMANDS: CommandInfo[] = [
  { name: 'explain', description: 'Explain code logic, syntax, or architecture in detail' },
  { name: 'refactor', description: 'Refactor code for clean architecture, clarity, and performance' },
  { name: 'fix', description: 'Analyze and resolve errors or bug reports' },
  { name: 'test', description: 'Write and execute automated unit and integration tests' },
  { name: 'review', description: 'Perform thorough code review with prioritized suggestions' },
  { name: 'init', description: 'Inspect workspace structure, files, and project setup' },
]

export const SKILLS: SkillInfo[] = [
  { id: 'gemini-coder', name: 'gemini-coder', description: 'Autonomous coding with Gemini models & tools', path: 'skills/gemini-coder', content: '' },
  { id: 'diff-viewer', name: 'diff-viewer', description: 'Interactive visual diff inspector', path: 'skills/diff-viewer', content: '' },
]

// --- Workspace Tools Definitions for Gemini ---

const workspaceTools = [
  {
    functionDeclarations: [
      {
        name: 'run_bash_command',
        description: 'Execute a bash command in the workspace directory (e.g. npm run build, npm test, git status, ls).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            command: {
              type: Type.STRING,
              description: 'The shell command to execute.',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'read_workspace_file',
        description: 'Read the contents of a file in the workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            filepath: {
              type: Type.STRING,
              description: 'Relative path to the file to read.',
            },
          },
          required: ['filepath'],
        },
      },
      {
        name: 'write_workspace_file',
        description: 'Create or update a file in the workspace with new content.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            filepath: {
              type: Type.STRING,
              description: 'Relative path to the file to write.',
            },
            content: {
              type: Type.STRING,
              description: 'Full text content to write into the file.',
            },
          },
          required: ['filepath', 'content'],
        },
      },
    ],
  },
]

async function executeWorkspaceTool(name: string, args: any, workspaceDir: string): Promise<string> {
  const dir = workspaceDir
  try {
    if (name === 'run_bash_command') {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: dir,
        timeout: 45_000,
        maxBuffer: 2 * 1024 * 1024,
      })
      return stdout + (stderr ? `\nStderr:\n${stderr}` : '')
    }
    if (name === 'read_workspace_file') {
      const targetPath: string = args.filepath ?? ''
      const fullPath = path.resolve(dir, targetPath)
      if (!fullPath.startsWith(dir)) {
        return 'Error: Access denied outside workspace directory.'
      }
      return await fs.readFile(fullPath, 'utf-8')
    }
    if (name === 'write_workspace_file') {
      const targetPath: string = args.filepath ?? ''
      const fullPath = path.resolve(dir, targetPath)
      if (!fullPath.startsWith(dir)) {
        return 'Error: Access denied outside workspace directory.'
      }
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, args.content ?? '', 'utf-8')
      return `Successfully wrote to ${targetPath}`
    }
    return `Unknown tool: ${name}`
  } catch (err: any) {
    return `Tool execution error: ${err.message || String(err)}`
  }
}

// --- In-Memory State & Disk Persistence ---

let memoryData: StoredData = {
  projects: [
    {
      id: 'opencode-web',
      name: 'opencode-web',
      canonical: process.cwd(),
      sandboxes: [],
      time: { created: Date.now(), updated: Date.now(), active: Date.now() },
    },
  ],
  sessions: [],
  messages: {},
}

let storageLoaded = false

async function loadStorage(): Promise<StoredData> {
  if (storageLoaded) return memoryData
  try {
    const raw = await fs.readFile(STORAGE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed.projects && parsed.sessions && parsed.messages) {
      memoryData = parsed
    }
  } catch {
    memoryData.projects = [
      {
        id: 'opencode-web',
        name: 'opencode-web',
        canonical: process.cwd(),
        sandboxes: [],
        time: { created: Date.now(), updated: Date.now(), active: Date.now() },
      },
    ]
  }
  storageLoaded = true
  return memoryData
}

async function saveStorage(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STORAGE_FILE), { recursive: true })
    await fs.writeFile(STORAGE_FILE, JSON.stringify(memoryData, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save OpenCode storage:', err)
  }
}

// --- Handler Implementations ---

export async function handleGeminiServiceRequest(
  urlPath: string,
  init?: RequestInit,
): Promise<Response> {
  await loadStorage()
  const method = (init?.method || 'GET').toUpperCase()
  const parsed = new URL(urlPath, 'http://service.local')
  const pathname = parsed.pathname
  const query = parsed.searchParams

  // 1. SSE Events: GET /api/event
  if (pathname === '/api/event' && method === 'GET') {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (data: Record<string, any>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch {}
        }

        send({
          type: 'server.connected',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {},
        })

        eventSubscribers.add(send)

        init?.signal?.addEventListener('abort', () => {
          eventSubscribers.delete(send)
          try {
            controller.close()
          } catch {}
        })
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  }

  // 2. Location: GET /api/location
  if (pathname === '/api/location' && method === 'GET') {
    const directory = query.get('location[directory]') || query.get('directory') || process.cwd()
    const project = memoryData.projects[0] || {
      id: 'opencode-web',
      name: 'opencode-web',
      canonical: process.cwd(),
    }
    return Response.json({
      project: {
        id: project.id,
        name: project.name,
        canonical: project.canonical,
      },
      directory,
    })
  }

  // 3. Projects: GET /api/project
  if (pathname === '/api/project' && method === 'GET') {
    return Response.json(memoryData.projects)
  }

  // 4. Providers: GET /api/provider
  if (pathname === '/api/provider' && method === 'GET') {
    return Response.json({
      data: [GEMINI_PROVIDER],
    })
  }

  // 5. Models: GET /api/model
  if (pathname === '/api/model' && method === 'GET') {
    return Response.json({
      data: GEMINI_MODELS,
    })
  }

  // 6. Default Model: GET /api/model/default
  if (pathname === '/api/model/default' && method === 'GET') {
    return Response.json({
      data: {
        providerID: 'google',
        id: 'gemini-3.1-flash-lite',
      },
    })
  }

  // 7. Agents: GET /api/agent
  if (pathname === '/api/agent' && method === 'GET') {
    return Response.json({
      data: AGENTS,
    })
  }

  // 8. Commands: GET /api/command
  if (pathname === '/api/command' && method === 'GET') {
    return Response.json({
      data: COMMANDS,
    })
  }

  // 9. Skills: GET /api/skill
  if (pathname === '/api/skill' && method === 'GET') {
    return Response.json({
      data: SKILLS,
    })
  }

  // 10. Integrations: GET /api/integration
  if (pathname === '/api/integration' && method === 'GET') {
    return Response.json({
      data: [],
    })
  }

  // 11. Filesystem List: GET /api/fs/list
  if (pathname === '/api/fs/list' && method === 'GET') {
    const dir = query.get('location[directory]') || query.get('directory') || process.cwd()
    const subpath = query.get('path') || ''
    const targetDir = path.resolve(dir, subpath)

    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true })
      const data = entries.map((e) => ({
        path: subpath ? `${subpath.replace(/\/$/, '')}/${e.name}${e.isDirectory() ? '/' : ''}` : `${e.name}${e.isDirectory() ? '/' : ''}`,
        type: e.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
      return Response.json({ data })
    } catch {
      return Response.json({ data: [] })
    }
  }

  // 12. Active Sessions: GET /api/session/active
  if (pathname === '/api/session/active' && method === 'GET') {
    const active: Record<string, boolean> = {}
    for (const id of busySessions) {
      active[id] = true
    }
    return Response.json({ data: active })
  }

  // 13. Sessions List: GET /api/session
  if (pathname === '/api/session' && method === 'GET') {
    const directory = query.get('directory')
    let list = [...memoryData.sessions]
    if (directory) {
      list = list.filter((s) => s.location?.directory === directory)
    }
    list.sort((a, b) => b.time.updated - a.time.updated)
    return Response.json({
      data: list,
      cursor: { next: null, previous: null },
    })
  }

  // 14. Create Session: POST /api/session
  if (pathname === '/api/session' && method === 'POST') {
    const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
    const sessionID = body.id || `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const directory = body.location?.directory || process.cwd()
    const projectID = memoryData.projects[0]?.id || 'opencode-web'

    const session: SessionInfo = {
      id: sessionID,
      parentID: body.parentID,
      projectID,
      title: body.title || 'New session',
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      agent: body.agent || 'build',
      model: body.model || { providerID: 'google', id: 'gemini-3.1-flash-lite' },
    }

    memoryData.sessions.unshift(session)
    memoryData.messages[sessionID] = []
    await saveStorage()

    broadcastEvent({
      type: 'session.created',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: { sessionID, session },
    })

    return Response.json({ data: session })
  }

  // Session-specific sub-routes: /api/session/:id/...
  const sessionMatch = pathname.match(/^\/api\/session\/([^/]+)(.*)$/)
  if (sessionMatch) {
    const sessionID = decodeURIComponent(sessionMatch[1])
    const subRoute = sessionMatch[2] || ''

    // 15. Get Session: GET /api/session/:id
    if (subRoute === '' && method === 'GET') {
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      if (!session) {
        return new Response('Session not found', { status: 404 })
      }
      return Response.json({ data: session })
    }

    // 16. Update / Rename Session: PATCH /api/session/:id
    if (subRoute === '' && method === 'PATCH') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      if (session) {
        if (body.title !== undefined) session.title = body.title
        session.time.updated = Date.now()
        await saveStorage()
        broadcastEvent({
          type: 'session.renamed',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: { sessionID, title: session.title },
        })
      }
      return new Response(null, { status: 204 })
    }

    // 17. Delete Session: DELETE /api/session/:id
    if (subRoute === '' && method === 'DELETE') {
      memoryData.sessions = memoryData.sessions.filter((s) => s.id !== sessionID)
      delete memoryData.messages[sessionID]
      busySessions.delete(sessionID)
      activeControllers.get(sessionID)?.abort()
      activeControllers.delete(sessionID)
      await saveStorage()

      broadcastEvent({
        type: 'session.deleted',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: { sessionID },
      })
      return new Response(null, { status: 204 })
    }

    // 18. Switch Model: POST /api/session/:id/model
    if (subRoute === '/model' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      if (session && body.model) {
        session.model = body.model
        session.time.updated = Date.now()
        await saveStorage()
        broadcastEvent({
          type: 'session.model.selected',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: { sessionID, model: session.model },
        })
      }
      return new Response(null, { status: 204 })
    }

    // 19. Switch Agent: POST /api/session/:id/agent
    if (subRoute === '/agent' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      if (session && body.agent) {
        session.agent = body.agent
        session.time.updated = Date.now()
        await saveStorage()
        broadcastEvent({
          type: 'session.agent.selected',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: { sessionID, agent: session.agent },
        })
      }
      return new Response(null, { status: 204 })
    }

    // 20. List Messages: GET /api/session/:id/message
    if (subRoute === '/message' && method === 'GET') {
      const messages = memoryData.messages[sessionID] || []
      return Response.json({
        data: messages,
        cursor: { next: null, previous: null },
      })
    }

    // 21. Inbox: GET /api/session/:id/inbox
    if (subRoute === '/inbox' && method === 'GET') {
      return Response.json({ data: [] })
    }

    // 22. Permissions: GET /api/session/:id/permission
    if (subRoute === '/permission' && method === 'GET') {
      return Response.json({ data: [] })
    }

    // 23. Forms / Questions: GET /api/session/:id/form
    if (subRoute === '/form' && method === 'GET') {
      return Response.json({ data: [] })
    }

    // 24. Diff: GET /api/session/:id/diff
    if (subRoute === '/diff' && method === 'GET') {
      return Response.json({ data: [] })
    }

    // 25. Interrupt: POST /api/session/:id/interrupt
    if (subRoute === '/interrupt' && method === 'POST') {
      const controller = activeControllers.get(sessionID)
      if (controller) {
        controller.abort()
        activeControllers.delete(sessionID)
      }
      busySessions.delete(sessionID)
      broadcastEvent({
        type: 'session.execution.interrupted',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: { sessionID, reason: 'user' },
      })
      return new Response(null, { status: 204 })
    }

    // 26. Fork Session: POST /api/session/:id/fork
    if (subRoute === '/fork' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const original = memoryData.sessions.find((s) => s.id === sessionID)
      if (!original) return new Response('Session not found', { status: 404 })

      const newId = `ses_${Date.now()}_fork_${Math.random().toString(36).slice(2, 6)}`
      const forkedSession: SessionInfo = {
        ...original,
        id: newId,
        title: `${original.title} (Fork)`,
        time: { created: Date.now(), updated: Date.now() },
      }

      const allMsgs = memoryData.messages[sessionID] || []
      const boundary = body.before
      const msgsToKeep = boundary ? allMsgs.filter((m) => m.id < boundary) : [...allMsgs]

      memoryData.sessions.unshift(forkedSession)
      memoryData.messages[newId] = structuredClone(msgsToKeep)
      await saveStorage()

      broadcastEvent({
        type: 'session.created',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: { sessionID: newId, session: forkedSession },
      })

      return Response.json({ data: forkedSession })
    }

    // 27. Revert Controls: /revert/stage, /revert/commit, /revert
    if (subRoute === '/revert/stage' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      if (session) {
        session.revert = { messageID: body.messageID }
        await saveStorage()
        broadcastEvent({
          type: 'session.revert.staged',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: { sessionID, messageID: body.messageID },
        })
      }
      return Response.json({ data: session })
    }

    if (subRoute === '/revert/commit' && method === 'POST') {
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      if (session?.revert) {
        const toId = session.revert.messageID
        session.revert = undefined
        if (toId && memoryData.messages[sessionID]) {
          memoryData.messages[sessionID] = memoryData.messages[sessionID].filter((m) => m.id < toId)
        }
        await saveStorage()
        broadcastEvent({
          type: 'session.revert.committed',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: { sessionID, to: toId },
        })
      }
      return new Response(null, { status: 204 })
    }

    if (subRoute === '/revert' && method === 'POST') {
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      if (session) {
        session.revert = undefined
        await saveStorage()
        broadcastEvent({
          type: 'session.revert.cleared',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: { sessionID },
        })
      }
      return Response.json({ data: session })
    }

    // 28. Compact / Summarize Session: POST /api/session/:id/compact
    if (subRoute === '/compact' && method === 'POST') {
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      const messages = memoryData.messages[sessionID] || []
      const ai = getGeminiClient()

      let summaryText = 'Session conversation history summarized.'
      if (ai && messages.length > 0) {
        try {
          const transcript = messages.map((m) => `${m.type.toUpperCase()}: ${'text' in m ? m.text : ''}`).join('\n')
          const res = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: `Summarize the key points, decisions, and code discussed in this development session concisely:\n\n${transcript}`,
          })
          if (res.text) summaryText = res.text
        } catch {}
      }

      const compactionMsg: SessionMessageInfo = {
        id: `msg_comp_${Date.now()}`,
        type: 'compaction',
        status: 'completed',
        reason: 'manual',
        summary: summaryText,
        recent: '',
        time: { created: Date.now() },
      }

      memoryData.messages[sessionID] = [compactionMsg]
      await saveStorage()

      broadcastEvent({
        type: 'session.compaction.ended',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: {
          sessionID,
          text: summaryText,
        },
      })

      return Response.json({ ok: true })
    }

    // 29. Run Command: POST /api/session/:id/command
    if (subRoute === '/command' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const commandPrompt = `/${body.name} ${body.text || ''}`.trim()
      void executeGeminiPrompt(sessionID, commandPrompt, body.files || [])
      return Response.json({ ok: true })
    }

    // 30. Send Prompt: POST /api/session/:id/prompt
    if (subRoute === '/prompt' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      void executeGeminiPrompt(sessionID, body.text || '', body.files || [])
      return Response.json({ ok: true })
    }
  }

  // 31. Export Session: GET /api/experimental/session/:id/export
  const exportMatch = pathname.match(/^\/api\/experimental\/session\/([^/]+)\/export$/)
  if (exportMatch && method === 'GET') {
    const sessionID = decodeURIComponent(exportMatch[1])
    const session = memoryData.sessions.find((s) => s.id === sessionID)
    const messages = memoryData.messages[sessionID] || []
    return Response.json({
      info: session,
      messages,
    })
  }

  // Default fallback
  return new Response(JSON.stringify({ error: 'Endpoint not implemented' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
}

// --- Gemini Prompt Execution Engine with Autonomous Tools ---

async function executeGeminiPrompt(
  sessionID: string,
  text: string,
  files: Array<{ name?: string; uri?: string; filename?: string; url?: string }>,
) {
  await loadStorage()
  const session = memoryData.sessions.find((s) => s.id === sessionID)
  if (!session) return
  const workspaceRoot: string = (session.location?.directory as string) || process.cwd()

  // Auto-generate title if this is the first message
  if (session.title === 'New session' || !session.title) {
    session.title = text.slice(0, 40) || 'Active session'
    broadcastEvent({
      type: 'session.renamed',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: { sessionID, title: session.title },
    })
  }
  session.time.updated = Date.now()

  // 1. Store User Message
  const userMsgId = `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const attachments: PromptFileAttachment[] = files.map((f) => ({
    name: f.name || f.filename || 'attachment',
    data: f.uri || f.url || '',
    mime: f.uri?.startsWith('data:') ? (f.uri.split(';')[0]?.split(':')[1] || 'application/octet-stream') : 'application/octet-stream',
    source: { type: 'inline' },
  }))

  const userMsg: SessionMessageUser = {
    id: userMsgId,
    type: 'user',
    text,
    files: attachments,
    time: { created: Date.now() },
  }

  if (!memoryData.messages[sessionID]) {
    memoryData.messages[sessionID] = []
  }
  memoryData.messages[sessionID].push(userMsg)
  await saveStorage()

  // Broadcast Inbox & User Events
  broadcastEvent({
    type: 'session.inbox.enqueued',
    id: `evt_${Date.now()}`,
    created: Date.now(),
    data: {
      sessionID,
      inboxID: userMsgId,
      item: {
        type: 'user',
        payload: { text, files: userMsg.files },
        time: { created: Date.now() },
      },
    },
  })

  broadcastEvent({
    type: 'session.inbox.delivered',
    id: `evt_${Date.now()}`,
    created: Date.now(),
    data: { sessionID, inboxID: userMsgId },
  })

  // 2. Set Session Busy
  busySessions.add(sessionID)
  broadcastEvent({
    type: 'session.execution.started',
    id: `evt_${Date.now()}`,
    created: Date.now(),
    data: { sessionID },
  })

  // 3. Create Assistant Message
  const assistantMsgId = `msg_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const selectedModelId = session.model?.id || 'gemini-3.1-flash-lite'
  const selectedAgentId = session.agent || 'build'

  const assistantMsg: SessionMessageAssistant = {
    id: assistantMsgId,
    type: 'assistant',
    agent: selectedAgentId,
    model: { providerID: 'google', id: selectedModelId },
    content: [{ type: 'text', text: '' }],
    time: { created: Date.now() },
  }

  memoryData.messages[sessionID].push(assistantMsg)

  broadcastEvent({
    type: 'session.step.started',
    id: `evt_${Date.now()}`,
    created: Date.now(),
    data: {
      sessionID,
      assistantMessageID: assistantMsgId,
      agent: selectedAgentId,
      model: { providerID: 'google', id: selectedModelId },
      started: Date.now(),
    },
  })

  broadcastEvent({
    type: 'session.text.started',
    id: `evt_${Date.now()}`,
    created: Date.now(),
    data: { sessionID, assistantMessageID: assistantMsgId },
  })

  // 4. Setup Abort Controller
  const abortController = new AbortController()
  activeControllers.set(sessionID, abortController)

  // 5. Build Gemini API Request & Autonomous Tool Loop
  const ai = getGeminiClient()
  let fullAssistantText = ''

  try {
    if (!ai) {
      throw new Error(
        'Gemini API key is not configured in GEMINI_API_KEY. Please provide your API key in the environment or Settings > Secrets.',
      )
    }

    const agentObj = AGENTS.find((a) => a.id === selectedAgentId) || AGENTS[0]
    const systemInstruction = `${agentObj.system}\n\nWorkspace Directory: ${workspaceRoot}\nCurrent Time: ${new Date().toISOString()}\nYou have access to workspace tools (run_bash_command, read_workspace_file, write_workspace_file). When asked to build, run tests, fix bugs, or inspect files, actively use these tools to execute tasks autonomously and provide production-ready solutions.`

    let targetModel = GEMINI_MODELS.some((m) => m.id === selectedModelId)
      ? selectedModelId
      : 'gemini-3.1-flash-lite'

    // Multi-turn tool execution loop (up to 5 turns)
    let currentContents: any[] = []
    const conversationHistory = memoryData.messages[sessionID].slice(-12)

    for (const msg of conversationHistory) {
      if (msg.id === assistantMsgId) continue

      if (msg.type === 'user') {
        const parts: any[] = []
        if (msg.text) parts.push({ text: msg.text })
        if (msg.files) {
          for (const file of msg.files) {
            const dataStr = file.data
            if (dataStr && dataStr.startsWith('data:')) {
              const match = dataStr.match(/^data:([^;]+);base64,(.+)$/)
              if (match) {
                parts.push({
                  inlineData: {
                    mimeType: match[1],
                    data: match[2],
                  },
                })
              }
            } else if (file.name) {
              parts.push({ text: `[Attachment: ${file.name}]` })
            }
          }
        }
        if (parts.length > 0) {
          currentContents.push({ role: 'user', parts })
        }
      } else if (msg.type === 'assistant') {
        const textPart = msg.content.find((c) => c.type === 'text')
        if (textPart && textPart.type === 'text' && textPart.text) {
          currentContents.push({ role: 'model', parts: [{ text: textPart.text }] })
        }
      }
    }

    let turnCount = 0
    let shouldContinue = true

    while (shouldContinue && turnCount < 5 && !abortController.signal.aborted) {
      turnCount++
      const response = await ai.models.generateContent({
        model: targetModel,
        contents: currentContents,
        config: {
          systemInstruction,
          tools: workspaceTools as any,
        },
      })

      const functionCalls = response.functionCalls
      const textOutput = response.text || ''

      if (textOutput) {
        fullAssistantText += (fullAssistantText ? '\n' : '') + textOutput
        assistantMsg.content[0] = { type: 'text', text: fullAssistantText }

        broadcastEvent({
          type: 'session.text.delta',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {
            sessionID,
            assistantMessageID: assistantMsgId,
            delta: textOutput,
          },
        })
      }

      if (functionCalls && functionCalls.length > 0) {
        // Add model response with function call
        currentContents.push({
          role: 'model',
          parts: functionCalls.map((fc: any) => ({ functionCall: fc })),
        })

        const functionResponseParts = []

        for (const fc of functionCalls) {
          const toolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const toolName = fc.name
          const toolArgs: Record<string, any> = (fc.args as any) ?? {}

          // Broadcast tool start / called event
          assistantMsg.content.push({
            type: 'tool',
            id: toolId,
            name: toolName,
            state: { status: 'running', input: toolArgs, metadata: {} },
            time: { created: Date.now() },
          } as SessionMessageAssistantTool)

          broadcastEvent({
            type: 'session.tool.called',
            id: `evt_${Date.now()}`,
            created: Date.now(),
            data: {
              sessionID,
              assistantMessageID: assistantMsgId,
              id: toolId,
              name: toolName,
              input: toolArgs,
              executed: true,
            },
          })

          const toolResult = await executeWorkspaceTool(toolName, toolArgs as any, workspaceRoot || process.cwd())

          broadcastEvent({
            type: 'session.tool.success',
            id: `evt_${Date.now()}`,
            created: Date.now(),
            data: {
              sessionID,
              assistantMessageID: assistantMsgId,
              id: toolId,
              executed: true,
              content: [{ type: 'text', text: toolResult }],
            },
          })

          functionResponseParts.push({
            functionResponse: {
              name: toolName,
              response: { result: toolResult },
            },
          })
        }

        // Add function response back to contents for next turn
        currentContents.push({
          role: 'user',
          parts: functionResponseParts,
        })
      } else {
        shouldContinue = false
      }
    }

    if (abortController.signal.aborted) {
      fullAssistantText += '\n\n*(Generation interrupted)*'
    }
  } catch (err: any) {
    console.error('Gemini API execution error:', err)
    const errMessage = err?.message || String(err)
    fullAssistantText = `### Autonomous Agent Notice\n\n${errMessage}\n\n> **Tip**: Verify your \`GEMINI_API_KEY\` in your environment or Settings > Secrets panel.`
    assistantMsg.content[0] = { type: 'text', text: fullAssistantText }

    broadcastEvent({
      type: 'session.text.delta',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: {
        sessionID,
        assistantMessageID: assistantMsgId,
        delta: fullAssistantText,
      },
    })
  } finally {
    activeControllers.delete(sessionID)
    busySessions.delete(sessionID)

    // Complete Assistant Message
    assistantMsg.content[0] = { type: 'text', text: fullAssistantText }
    assistantMsg.time.completed = Date.now()
    assistantMsg.finish = 'stop'
    await saveStorage()

    broadcastEvent({
      type: 'session.text.ended',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: {
        sessionID,
        assistantMessageID: assistantMsgId,
        text: fullAssistantText,
      },
    })

    broadcastEvent({
      type: 'session.step.ended',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: {
        sessionID,
        assistantMessageID: assistantMsgId,
        finish: 'stop',
      },
    })

    broadcastEvent({
      type: 'session.execution.succeeded',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: { sessionID, outcome: 'succeeded' },
    })
  }
}
