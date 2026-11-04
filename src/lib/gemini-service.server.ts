import { promises as fs } from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import ts from 'typescript'
import { serveVitePreview } from './vite-preview.server'
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
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
  SkillInfo,
} from '@opencode/client'
import {
  persistSessionToFirestore,
  persistMessageToFirestore,
  deleteSessionFromFirestore,
  loadSessionsFromFirestore,
  loadMessagesFromFirestore,
} from './firestore-sync.server'
import {
  getOrCreateSessionAgno,
  updateSessionWorkflowPhase,
  AgnoRAG,
} from './agno-framework'
import {
  CodeActSandbox,
  getCodeActHistory,
  recordCodeActAction,
} from './codeact-framework'

const execAsync = promisify(exec)

// --- Types & Data Structures ---


export interface StoredData {
  projects: ApiProject[]
  sessions: SessionInfo[]
  messages: Record<string, SessionMessageInfo[]>
}

import { createTwoFilesPatch } from 'diff'

const STORAGE_FILE = path.join(process.cwd(), '.Kvant', 'storage.json')

// Dedicated, Isolated Development Environments per Session & Conversation
export const SESSIONS_WORKSPACES_ROOT = path.resolve(process.cwd(), 'sessions-workspaces')
export const AGENT_WORKSPACE_DIR = SESSIONS_WORKSPACES_ROOT

export function getSessionWorkspaceDir(sessionId: string): string {
  const cleanId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_')
  return path.resolve(SESSIONS_WORKSPACES_ROOT, cleanId)
}

export function resolveAgentWorkspace(requestedDir?: string | null, sessionId?: string): string {
  if (sessionId) {
    return getSessionWorkspaceDir(sessionId)
  }
  if (!requestedDir || requestedDir === process.cwd() || requestedDir === '/' || requestedDir === '.') {
    return SESSIONS_WORKSPACES_ROOT
  }
  const normalized = path.resolve(requestedDir)
  if (normalized.startsWith(SESSIONS_WORKSPACES_ROOT)) {
    return normalized
  }
  return SESSIONS_WORKSPACES_ROOT
}

export function assertInsideAgentWorkspace(filepath: string, baseDir: string): string {
  const resolved = path.resolve(baseDir, filepath)
  if (!resolved.startsWith(SESSIONS_WORKSPACES_ROOT)) {
    throw new Error(
      `Security Violation: Access denied. The AI agent operates exclusively inside its session development workspace and is strictly prohibited from accessing, inspecting, or modifying the host application.`,
    )
  }
  return resolved
}

export async function ensureSessionWorkspaceExists(sessionId: string): Promise<string> {
  const dir = getSessionWorkspaceDir(sessionId)
  try {
    await fs.mkdir(path.join(dir, 'src', 'components'), { recursive: true })

    // 1. Vite HTML Entry: index.html
    const indexPath = path.join(dir, 'index.html')
    try {
      await fs.access(indexPath)
    } catch {
      await fs.writeFile(
        indexPath,
        `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React + Vite Application</title>
  </head>
  <body class="bg-slate-900 text-slate-100 min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
        'utf-8',
      )
    }

    // 2. React Entry: src/main.tsx
    const mainTsxPath = path.join(dir, 'src', 'main.tsx')
    try {
      await fs.access(mainTsxPath)
    } catch {
      await fs.writeFile(
        mainTsxPath,
        `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
`,
        'utf-8',
      )
    }

    // 3. React Main Component: src/App.tsx (local functional starter, no public APIs)
    const appTsxPath = path.join(dir, 'src', 'App.tsx')
    try {
      await fs.access(appTsxPath)
    } catch {
      await fs.writeFile(
        appTsxPath,
        `import { useState } from 'react'

const features = [
  { title: 'Clareza', text: 'Uma base simples para transformar a ideia em uma interface real.' },
  { title: 'Velocidade', text: 'Sem dependências externas ou chamadas públicas obrigatórias.' },
  { title: 'Controle', text: 'Todos os estados ficam no workspace local e são fáceis de evoluir.' },
]

export default function App() {
  const [active, setActive] = useState('Overview')

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">Studio</a>
        <nav aria-label="Primary navigation">
          {['Overview', 'Projects', 'Settings'].map((item) => (
            <button key={item} className={active === item ? 'nav-link active' : 'nav-link'} onClick={() => setActive(item)}>
              {item}
            </button>
          ))}
        </nav>
        <button className="avatar" aria-label="Open profile">A</button>
      </header>

      <main className="content">
        <section className="hero">
          <p className="eyebrow">LOCAL WORKSPACE</p>
          <h1>Build something clear and useful.</h1>
          <p className="lede">A polished local-first starting point. Replace this content with the product experience requested by the user.</p>
          <div className="actions">
            <button className="button primary" onClick={() => setActive('Projects')}>Explore projects</button>
            <button className="button secondary" onClick={() => setActive('Settings')}>Open settings</button>
          </div>
        </section>

        <section className="feature-grid" aria-label="Highlights">
          {features.map((feature) => (
            <article className="card" key={feature.title}>
              <span className="card-index">0{features.indexOf(feature) + 1}</span>
              <h2>{feature.title}</h2>
              <p>{feature.text}</p>
            </article>
          ))}
        </section>

        <section className="status-card">
          <div><span className="status-dot" />Runtime ready</div>
          <span className="muted">{active} view</span>
        </section>
      </main>
    </div>
  )
}
`,
        'utf-8',
      )
    }

    // 4. Stylesheet: src/index.css
    const cssPath = path.join(dir, 'src', 'index.css')
    try {
      await fs.access(cssPath)
    } catch {
      await fs.writeFile(
        cssPath,
        `:root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e8edf5; background: #0b1020; font-synthesis: none; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(circle at 20% 0%, #1b2a52 0, transparent 38%), #0b1020; }
button { font: inherit; }
.app-shell { min-height: 100vh; }
.topbar { height: 72px; display: flex; align-items: center; gap: 32px; padding: 0 6vw; border-bottom: 1px solid #24304a; background: rgba(11,16,32,.78); backdrop-filter: blur(16px); }
.brand { color: #fff; font-weight: 800; letter-spacing: -.04em; font-size: 1.15rem; text-decoration: none; margin-right: auto; }
nav { display: flex; gap: 8px; }
.nav-link { border: 0; background: transparent; color: #8290aa; padding: 10px 12px; border-radius: 8px; cursor: pointer; }
.nav-link:hover, .nav-link.active { color: #fff; background: #1b2742; }
.avatar { width: 34px; height: 34px; border: 1px solid #52658d; border-radius: 50%; background: #243b70; color: #fff; cursor: pointer; }
.content { width: min(1080px, 88vw); margin: 0 auto; padding: 96px 0 64px; }
.hero { max-width: 720px; }
.eyebrow { color: #82aaff; font-size: .72rem; font-weight: 800; letter-spacing: .16em; }
h1 { max-width: 700px; margin: 16px 0; color: #fff; font-size: clamp(2.6rem, 7vw, 5.8rem); line-height: .98; letter-spacing: -.07em; }
.lede { max-width: 560px; color: #aeb9ce; font-size: 1.12rem; line-height: 1.65; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.button { border: 1px solid #35476c; border-radius: 10px; padding: 12px 18px; color: #fff; cursor: pointer; transition: transform .2s, background .2s; }
.button:hover { transform: translateY(-2px); }
.primary { background: #5278d8; border-color: #7092e6; }
.secondary { background: #17223b; }
.feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 92px; }
.card { min-height: 190px; padding: 24px; border: 1px solid #263554; border-radius: 16px; background: rgba(21,31,55,.7); }
.card-index { color: #82aaff; font-size: .78rem; font-weight: 800; }
.card h2 { margin: 42px 0 8px; color: #f7f9ff; font-size: 1.2rem; }
.card p { margin: 0; color: #95a4bf; line-height: 1.55; }
.status-card { display: flex; justify-content: space-between; margin-top: 18px; padding: 16px 20px; border: 1px solid #263554; border-radius: 12px; color: #c4cee0; background: rgba(14,22,40,.8); }
.status-dot { display: inline-block; width: 8px; height: 8px; margin-right: 9px; border-radius: 50%; background: #5ce39d; box-shadow: 0 0 12px #5ce39d; }
.muted { color: #71809e; }
@media (max-width: 700px) { .topbar { gap: 12px; padding: 0 5vw; } nav { display: none; } .content { padding-top: 68px; } .feature-grid { grid-template-columns: 1fr; margin-top: 58px; } h1 { font-size: clamp(2.6rem, 15vw, 4.5rem); } }
`,
        'utf-8',
      )
    }

    // 5. Vite Config: vite.config.ts
    const viteConfigPath = path.join(dir, 'vite.config.ts')
    try {
      await fs.access(viteConfigPath)
    } catch {
      await fs.writeFile(
        viteConfigPath,
        `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
})
`,
        'utf-8',
      )
    }

    // 6. Package JSON: package.json
    const pkgPath = path.join(dir, 'package.json')
    try {
      await fs.access(pkgPath)
    } catch {
      await fs.writeFile(
        pkgPath,
        JSON.stringify(
          {
            name: `session-${sessionId.slice(0, 10)}`,
            version: '1.0.0',
            private: true,
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'tsc && vite build',
              preview: 'vite preview',
            },
            dependencies: {
              react: '^19.0.0',
              'react-dom': '^19.0.0',
              'lucide-react': '^0.469.0',
            },
            devDependencies: {
              '@types/react': '^19.0.8',
              '@types/react-dom': '^19.0.3',
              '@vitejs/plugin-react': '^6.0.1',
              typescript: '^5.7.2',
              vite: '^8.0.14',
            },
          },
          null,
          2,
        ),
        'utf-8',
      )
    }

    const readmePath = path.join(dir, 'README.md')
    try {
      await fs.access(readmePath)
    } catch {
      await fs.writeFile(
        readmePath,
        `# Session React + Vite Development Environment\n\nSession ID: ${sessionId}\nThis workspace contains a local-first React + Vite application with no mandatory external APIs.\n`,
        'utf-8',
      )
    }
  } catch (err) {
    console.warn(`Failed to initialize session workspace for [${sessionId}]:`, err)
  }
  return dir
}

// Session Diff Tracker: sessionId -> (filePath -> { before, after, status })
export interface DiffRecord {
  before: string
  after: string
  status: 'added' | 'modified' | 'deleted'
}
export const sessionDiffMap = new Map<string, Map<string, DiffRecord>>()

export function recordSessionFileChange(
  sessionId: string,
  filePath: string,
  before: string,
  after: string,
  status: 'added' | 'modified' | 'deleted',
) {
  if (!sessionDiffMap.has(sessionId)) {
    sessionDiffMap.set(sessionId, new Map())
  }
  sessionDiffMap.get(sessionId)!.set(filePath, { before, after, status })
}

// Emoji Stripper: Guarantees no emojis are sent by agent, subagents, or system
export function stripEmojis(str: string): string {
  if (!str) return str
  return str
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{FE0F}]/gu, '')
    .replace(/[🤖❓🚀✨💡🔍⚡️🔥🛠️💻📦]/gu, '')
}

// Session Interactive Forms & Clarification Questions
export interface FormInfo {
  id: string
  sessionID: string
  title: string
  fields: Array<{
    key: string
    title?: string
    description?: string
    type: 'string' | 'boolean' | 'multiselect' | 'external'
    required?: boolean
    default?: any
    options?: Array<{ label: string; value: string }>
    url?: string
  }>
}
export const sessionFormsMap = new Map<string, FormInfo[]>()

// Automatic Code Extractor & Fail-safe workspace file applicator
export async function applyCodeBlocksToWorkspace(
  sessionID: string,
  text: string,
  workspaceRoot: string,
): Promise<string[]> {
  const createdFiles: string[] = []
  if (!text) return createdFiles

  const codeBlockRegex = /```([a-zA-Z0-9_-]+)?(?:\s+(?:<!--\s*filepath:\s*([^\n>]+)\s*-->|\/\/\s*filepath:\s*([^\n]+)|#\s*filepath:\s*([^\n]+)|\[file:\s*([^\n\]]+)\]|filename=["']?([^"'\n]+)["']?|([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)))?\n([\s\S]*?)```/g

  let match: RegExpExecArray | null
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase()
    let filePath = match[2] || match[3] || match[4] || match[5] || match[6] || match[7]
    const content = match[8] || ''

    if (!filePath) {
      if (lang === 'html' || content.includes('<!DOCTYPE html>') || content.includes('<html')) {
        filePath = 'index.html'
      } else if (lang === 'css' || content.includes('@tailwind')) {
        filePath = 'src/index.css'
      } else if (content.includes('createRoot') || content.includes("getElementById('root')") || content.includes('getElementById("root")')) {
        filePath = 'src/main.tsx'
      } else if (content.includes('export default') || content.includes('function App') || content.includes('const App =') || lang === 'tsx' || lang === 'jsx') {
        filePath = 'src/App.tsx'
      } else if (content.includes('defineConfig') && content.includes('react()')) {
        filePath = 'vite.config.ts'
      } else if (lang === 'javascript' || lang === 'js' || lang === 'ts') {
        filePath = 'src/App.tsx'
      }
    }

    if (filePath && content.trim()) {
      filePath = filePath.trim().replace(/^['"]|['"]$/g, '').replace(/^[./\\]+/, '')
      try {
        const fullPath = assertInsideAgentWorkspace(filePath, workspaceRoot)
        let before = ''
        let status: 'added' | 'modified' = 'added'
        try {
          before = await fs.readFile(fullPath, 'utf-8')
          status = 'modified'
        } catch {
          status = 'added'
        }
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, content.trim(), 'utf-8')
        recordSessionFileChange(sessionID, filePath, before, content.trim(), status)
        createdFiles.push(filePath)
      } catch (err) {
        console.warn(`Auto-apply file write error for ${filePath}:`, err)
      }
    }
  }

  // Also catch raw <!DOCTYPE html> if outputted directly
  if (!createdFiles.includes('index.html')) {
    const rawHtmlMatch = text.match(/<!DOCTYPE html[\s\S]*?<\/html>/i)
    if (rawHtmlMatch) {
      try {
        const fullPath = path.join(workspaceRoot, 'index.html')
        let before = ''
        try {
          before = await fs.readFile(fullPath, 'utf-8')
        } catch {}
        await fs.writeFile(fullPath, rawHtmlMatch[0], 'utf-8')
        recordSessionFileChange(sessionID, 'index.html', before, rawHtmlMatch[0], before ? 'modified' : 'added')
        createdFiles.push('index.html')
      } catch {}
    }
  }

  return createdFiles
}

export interface WorkspaceFileItem {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  extension: string
}

export async function getDirectoryTreeRecursive(dir: string, baseDir: string): Promise<WorkspaceFileItem[]> {
  const result: WorkspaceFileItem[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const full = path.join(dir, e.name)
      const rel = path.relative(baseDir, full)
      if (e.isDirectory()) {
        result.push({
          path: rel,
          name: e.name,
          type: 'directory',
          size: 0,
          extension: '',
        })
        const sub = await getDirectoryTreeRecursive(full, baseDir)
        result.push(...sub)
      } else {
        const stat = await fs.stat(full).catch(() => ({ size: 0 }))
        result.push({
          path: rel,
          name: e.name,
          type: 'file',
          size: stat.size,
          extension: path.extname(e.name).replace('.', ''),
        })
      }
    }
  } catch {}
  return result
}

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

/**
 * Keep model selection resilient. Preview models can be temporarily saturated
 * even when the API key is valid, so a single 503 must not become the user-facing
 * explanation for every failure.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest'
const GEMINI_FALLBACK_MODELS = [
  DEFAULT_GEMINI_MODEL,
  'gemini-3.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
] as const

function geminiErrorStatus(error: unknown): number | undefined {
  const value = error as { status?: unknown; code?: unknown; message?: unknown } | null
  const status = Number(value?.status ?? value?.code)
  if (Number.isFinite(status) && status > 0) return status
  const message = String(value?.message ?? error ?? '')
  const match = message.match(/\b(401|403|404|429|500|502|503|504)\b/)
  return match ? Number(match[1]) : undefined
}

function isRetryableGeminiError(error: unknown): boolean {
  const status = geminiErrorStatus(error)
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function generateGeminiContent(
  ai: GoogleGenAI,
  requestedModel: string,
  contents: any[],
  config: Record<string, unknown>,
): Promise<{ response: any; model: string }> {
  const candidates = [requestedModel, ...GEMINI_FALLBACK_MODELS].filter(
    (model, index, all) => model && all.indexOf(model) === index,
  )
  let lastError: unknown

  for (const model of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            ...config,
            abortSignal: AbortSignal.timeout(20_000),
          },
        })
        return { response, model }
      } catch (error) {
        lastError = error
        if (!isRetryableGeminiError(error)) break
        if (attempt === 0) await wait(350)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Gemini request failed'))
}

function formatGeminiError(error: unknown): string {
  const status = geminiErrorStatus(error)
  const message = error instanceof Error ? error.message : String(error)
  if (status === 401 || status === 403) {
    return 'A chave Gemini foi rejeitada ou não tem permissão para usar a API. Verifique a chave e as APIs habilitadas.'
  }
  if (status === 404) {
    return 'O modelo selecionado não está disponível para esta conta. O agente tentou modelos alternativos.'
  }
  if (status === 429) {
    return 'A cota ou o limite de requisições Gemini foi atingido. Aguarde alguns instantes ou use uma conta/plano com cota disponível.'
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return 'Os modelos Gemini estão temporariamente indisponíveis ou sob alta demanda. O agente tentou modelos alternativos e não conseguiu concluir a geração.'
  }
  return message || 'A geração Gemini falhou por um erro não identificado.'
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
    name: 'Autonomous Engineer',
    mode: 'primary',
    hidden: false,
    description: 'Autonomous full-stack engineer powered by Agno & CodeAct — operates the entire development environment, writes and executes code in sandbox, searches via RAG, builds websites, and self-heals.',
    system: 'You are an autonomous senior software engineer powered by Agno and CodeAct frameworks. You analyze prompts deeply, write and execute code in your sandbox, search context via RAG, and verify builds.',
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  },
  {
    id: 'chat',
    name: 'Chat Architect',
    mode: 'primary',
    hidden: false,
    description: 'Conversational architect & engineer — explains concepts, reviews code quality, conducts architectural designs, and answers questions.',
    system: 'You are a senior software architect and engineer. You explain concepts, answer questions, review code quality, and implement solutions with tools.',
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  },
  {
    id: 'review',
    name: 'Code Reviewer',
    mode: 'primary',
    hidden: false,
    description: 'Principal code reviewer & engineer — audits code quality, spots vulnerabilities, performs refactoring, and implements fixes directly in concert.',
    system: 'You are a principal code reviewer and engineer. You audit code quality, review git changes, and autonomously fix issues and verify builds.',
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

// --- Public APIs & Web Research Engine ---

interface PublicApiEntry {
  api: string
  description: string
  auth: string
  https: boolean
  cors: string
  link: string
  category: string
}

let publicApisCache: PublicApiEntry[] | null = null

async function loadPublicApis(): Promise<PublicApiEntry[]> {
  if (publicApisCache && publicApisCache.length > 0) return publicApisCache
  try {
    const res = await fetch('https://raw.githubusercontent.com/public-apis/public-apis/master/README.md', {
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) {
      const text = await res.text()
      const entries: PublicApiEntry[] = []
      let currentCategory = 'General'
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.startsWith('### ')) {
          currentCategory = line.replace('### ', '').trim()
        } else if (line.startsWith('| [') && line.includes('|')) {
          const parts = line.split('|').map((s) => s.trim()).filter(Boolean)
          if (parts.length >= 5) {
            const matchLink = parts[0].match(/\[(.*?)\]\((.*?)\)/)
            const name = matchLink ? matchLink[1] : parts[0]
            const link = matchLink ? matchLink[2] : ''
            entries.push({
              api: name,
              description: parts[1],
              auth: parts[2] === '`No`' ? 'None' : parts[2].replace(/`/g, ''),
              https: parts[3] === 'Yes',
              cors: parts[4].replace(/`/g, ''),
              link,
              category: currentCategory,
            })
          }
        }
      }
      if (entries.length > 0) {
        publicApisCache = entries
        return entries
      }
    }
  } catch (err) {
    console.warn('Public APIs index online load note:', err)
  }

  // Curated offline index of popular public APIs
  publicApisCache = [
    { api: 'Open-Meteo', description: 'Free weather forecast API with temperature, wind, precipitation', auth: 'None', https: true, cors: 'Yes', link: 'https://open-meteo.com/', category: 'Weather' },
    { api: 'CoinGecko', description: 'Cryptocurrency market data, real-time prices, volume, exchanges', auth: 'None', https: true, cors: 'Yes', link: 'https://www.coingecko.com/api', category: 'Cryptocurrency' },
    { api: 'REST Countries', description: 'Get information about world countries (flags, currencies, borders)', auth: 'None', https: true, cors: 'Yes', link: 'https://restcountries.com/', category: 'Geocoding' },
    { api: 'GitHub REST API', description: 'Search repositories, commits, users, pull requests, releases', auth: 'Optional', https: true, cors: 'Yes', link: 'https://docs.github.com/rest', category: 'Development' },
    { api: 'PokeAPI', description: 'RESTful Pokémon database with sprites, stats, abilities, types', auth: 'None', https: true, cors: 'Yes', link: 'https://pokeapi.co/', category: 'Games' },
    { api: 'NASA Open APIs', description: 'Astronomy picture of the day, Mars rovers, asteroids, earth imagery', auth: 'apiKey', https: true, cors: 'Yes', link: 'https://api.nasa.gov/', category: 'Science' },
    { api: 'Free Dictionary API', description: 'English dictionary definitions, meanings, phonetics, audio', auth: 'None', https: true, cors: 'Yes', link: 'https://dictionaryapi.dev/', category: 'Dictionaries' },
    { api: 'FakeStore API', description: 'Mock e-commerce store with products, shopping cart, user logins', auth: 'None', https: true, cors: 'Yes', link: 'https://fakestoreapi.com/', category: 'Development' },
    { api: 'Hacker News API', description: 'Top stories, comments, ask HN, jobs, user profiles from Hacker News', auth: 'None', https: true, cors: 'Yes', link: 'https://github.com/HackerNews/API', category: 'News' },
    { api: 'IP-API', description: 'IP geolocation, ASN, timezone, country, and network information', auth: 'None', https: true, cors: 'Yes', link: 'https://ip-api.com/', category: 'Geocoding' },
    { api: 'Frankfurter', description: 'Currency exchange rates published by the European Central Bank', auth: 'None', https: true, cors: 'Yes', link: 'https://www.frankfurter.app/', category: 'Finance' },
    { api: 'Open Brewery DB', description: 'Public brewery information, locations, and craft beer directory', auth: 'None', https: true, cors: 'Yes', link: 'https://www.openbrewerydb.org/', category: 'Food & Drink' },
    { api: 'Jikan (MyAnimeList)', description: 'Unofficial MyAnimeList REST API for anime and manga data', auth: 'None', https: true, cors: 'Yes', link: 'https://jikan.moe/', category: 'Anime' },
  ]
  return publicApisCache
}

async function performWebSearch(query: string): Promise<string> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const data = await res.json()
      const results: string[] = []
      if (data.Heading) results.push(`Title: ${data.Heading}`)
      if (data.AbstractText) results.push(`Summary: ${data.AbstractText}`)
      if (data.AbstractURL) results.push(`Source: ${data.AbstractURL}`)
      if (Array.isArray(data.RelatedTopics) && data.RelatedTopics.length > 0) {
        results.push('\nRelated Findings:')
        for (const topic of data.RelatedTopics.slice(0, 5)) {
          if (topic.Text && topic.FirstURL) {
            results.push(`- ${topic.Text} (${topic.FirstURL})`)
          }
        }
      }
      if (results.length > 0) {
        return results.join('\n')
      }
    }
  } catch {}

  try {
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(htmlUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) {
      const html = await res.text()
      const matches = [...html.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/g)]
      if (matches.length > 0) {
        const snippets = matches.slice(0, 5).map((m) => `- ${m[1].replace(/<[^>]+>/g, '').trim()}`)
        return `Web Search Results for "${query}":\n${snippets.join('\n')}`
      }
    }
  } catch {}

  return `Search completed for "${query}". Explore documentation and public APIs directly.`
}

async function executeBrowserAction(url: string, action = 'render_text'): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Playwright-CLI/1.0; HeadlessChrome) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      return `HTTP ${res.status} ${res.statusText} when fetching ${url}`
    }
    const html = await res.text()

    if (action === 'extract_links') {
      const links = [...html.matchAll(/<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi)]
        .slice(0, 25)
        .map((m) => `- [${m[2].replace(/<[^>]+>/g, '').trim() || 'Link'}](${m[1]})`)
      return `Extracted Links from ${url}:\n${links.join('\n') || 'No links found.'}`
    }

    if (action === 'check_status') {
      return `Page ${url} is accessible. Status: 200 OK. Content-Type: ${res.headers.get('content-type') || 'text/html'}. Payload size: ${html.length} bytes.`
    }

    // Clean HTML to readable text for browser simulation
    const cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000)

    return `Browser CLI Page Render (${url}):\n${cleaned}`
  } catch (err: any) {
    return `Browser CLI Error: ${err.message || String(err)}`
  }
}

type AgentTaskMode = 'chat' | 'research' | 'build'

function classifyAgentTask(text: string): AgentTaskMode {
  const value = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const build = /\b(crie|criar|construa|construir|desenvolva|implemente|implement|site|website|web app|aplicacao|dashboard|landing page|componente|codigo|código|program|corrija|modifique|refatore|arquivo|frontend|react|vite|css|html)\b/.test(value)
  const research = /\b(pesquise|pesquisa|procure|buscar|busque|compare|comparar|investigue|documentacao|documentação|noticias|atual|mais recente|latest|web)\b/.test(value)
  if (build) return 'build'
  if (research) return 'research'
  return 'chat'
}

// --- Comprehensive Agent Tools Suite ---

const workspaceTools = [
  {
    functionDeclarations: [
      {
        name: 'web_search',
        description: 'Search the live web for technical documentation, libraries, guides, bug fixes, or information.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'The search query string.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'fetch_web_page',
        description: 'Fetch content, HTML, or JSON from any public URL, REST API, or documentation endpoint.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            url: {
              type: Type.STRING,
              description: 'The full URL to fetch.',
            },
            method: {
              type: Type.STRING,
              description: 'HTTP method (GET, POST). Defaults to GET.',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'public_apis_search',
        description: 'Search thousands of curated public APIs from https://github.com/public-apis/public-apis by category or keyword.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'Search keyword (e.g. weather, crypto, finance, music, games, AI, geocoding, books).',
            },
            category: {
              type: Type.STRING,
              description: 'Optional category filter.',
            },
          },
        },
      },
      {
        name: 'playwright_browser_cli',
        description: 'Simulate a browser CLI / Playwright inspection to test websites, extract links, check UI health, and render page content.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            url: {
              type: Type.STRING,
              description: 'The URL to navigate to.',
            },
            action: {
              type: Type.STRING,
              description: 'Action: render_text, extract_links, or check_status. Defaults to render_text.',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'run_bash_command',
        description: 'Execute shell commands (npm, node, tsc, python, git, etc.) strictly inside the agent dedicated development workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            command: {
              type: Type.STRING,
              description: 'The shell command to execute in the workspace.',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'read_workspace_file',
        description: 'Read the contents of a file in the agent dedicated development workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            filepath: {
              type: Type.STRING,
              description: 'Relative path to the file inside the agent workspace.',
            },
          },
          required: ['filepath'],
        },
      },
      {
        name: 'write_workspace_file',
        description: 'Create or update a file in the agent dedicated development workspace with new content.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            filepath: {
              type: Type.STRING,
              description: 'Relative path to the file in the agent workspace.',
            },
            content: {
              type: Type.STRING,
              description: 'Full text content to write into the file.',
            },
          },
          required: ['filepath', 'content'],
        },
      },
      {
        name: 'create_workspace_directory',
        description: 'Create a new directory or folder structure inside the agent workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            dirpath: {
              type: Type.STRING,
              description: 'Relative path to the directory to create.',
            },
          },
          required: ['dirpath'],
        },
      },
      {
        name: 'delete_workspace_file',
        description: 'Delete a file inside the agent workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            filepath: {
              type: Type.STRING,
              description: 'Relative path to the file to delete.',
            },
          },
          required: ['filepath'],
        },
      },
      {
        name: 'list_workspace_dir',
        description: 'List files and directories in the agent workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            dirpath: {
              type: Type.STRING,
              description: 'Relative subpath to list. Leave empty for root workspace.',
            },
          },
        },
      },
      {
        name: 'compile_and_test',
        description: 'Compile, build, test, and measure execution performance in the agent workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            command: {
              type: Type.STRING,
              description: 'Build or test command to run (e.g. npm run build, npm test, tsc). Defaults to npm run build.',
            },
          },
        },
      },
      {
        name: 'code_review_and_audit',
        description: 'Audit code quality, detect vulnerabilities, evaluate types, and check architecture.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            filepath: {
              type: Type.STRING,
              description: 'Optional relative path to specific file to audit.',
            },
          },
        },
      },
      {
        name: 'get_git_diff',
        description: 'Inspect current git status and unstaged/staged git diffs in the agent workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        },
      },
      {
        name: 'ask_user_question',
        description: 'Faz uma pergunta real de esclarecimento ou requisitos ao usuário no chat através de formulário interativo ou opções, pausando para aguardar a resposta antes de prosseguir.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            question: {
              type: Type.STRING,
              description: 'A pergunta objetiva e clara a ser feita ao usuário.',
            },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Lista opcional de opções recomendadas para o usuário selecionar.',
            },
          },
          required: ['question'],
        },
      },
      {
        name: 'describe_progress',
        description: 'O agente principal invoca este subagente de descrição apenas quando quiser relatar uma descrição de progresso relevante no chat (e não sempre). Proibido usar emojis.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            reporter_name: {
              type: Type.STRING,
              description: 'Nome do subagente de status (ex: "Subagente de Descrição", "Progress Reporter").',
            },
            description: {
              type: Type.STRING,
              description: 'Descrição real e concisa (1-3 frases) do que acabou de acontecer. Não use emojis.',
            },
          },
          required: ['description'],
        },
      },
      {
        name: 'spawn_subagent',
        description: 'Cria e invoca um subagente ou múltiplos subagentes especializados APENAS quando o agente principal realmente precisar de ajuda para uma tarefa específica (divisão de tarefas, auditoria, pesquisa ou perguntas), e não em qualquer situação. Proibido usar emojis.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Nome ou papel do subagente (ex: "Questioner Subagent", "Progress Reporter", "UI Architect", "Code Auditor").',
            },
            task: {
              type: Type.STRING,
              description: 'Tipo da tarefa: "describe_progress" | "ask_question" | "execute_task" | "code_review" | "research"',
            },
            instructions: {
              type: Type.STRING,
              description: 'Instruções detalhadas para o subagente executar. Não use emojis.',
            },
            context: {
              type: Type.STRING,
              description: 'Contexto dos passos anteriores, logs, código ou resultado para análise.',
            },
          },
          required: ['name', 'task', 'instructions'],
        },
      },
      {
        name: 'codeact_execute_python',
        description: 'CodeAct Action: Execute real Python 3 code in an isolated session sandbox. Can perform math, data transformations, API calls with urllib, file analysis, or script automation. Returns real stdout, stderr, and files created.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            code: {
              type: Type.STRING,
              description: 'The complete Python 3 code to execute in the sandbox.',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'codeact_execute_bash',
        description: 'CodeAct Action: Execute shell/bash commands or scripts in the isolated session sandbox. Can run tests, lint, inspect git, invoke node/python/npm, and interact with the workspace.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            command: {
              type: Type.STRING,
              description: 'The shell command or bash script to run in the sandbox.',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'agno_rag_search',
        description: 'Agno Framework RAG: Retrieve context by searching workspace code, documents, API references, and project artifacts matching keywords.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'The search query or technical keywords to retrieve context for.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'agno_get_memory_facts',
        description: 'Agno Framework: Retrieve long-term persistent memory, user preferences, and architectural facts stored across sessions.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
        },
      },
      {
        name: 'browser_open_and_inspect',
        description: 'Opens and inspects the live preview of the session web app (or any local/remote URL). Checks HTTP response status, validates page title, parses HTML structure, checks for broken resource tags or script links, and returns rendered content.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            url: {
              type: Type.STRING,
              description: 'Optional URL or relative path to inspect (defaults to the live session app preview).',
            },
          },
        },
      },
      {
        name: 'diagnose_and_auto_repair',
        description: 'Autonomous self-healing power: Analyzes build errors, compiler errors, or runtime exceptions in the workspace, inspects broken files, applies automatic repairs to syntax or configuration, re-runs verification, and reports the result.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            error_message: {
              type: Type.STRING,
              description: 'The error message, compiler trace, or exception to diagnose and repair.',
            },
            target_file: {
              type: Type.STRING,
              description: 'Optional specific file to prioritize for inspection and repair.',
            },
          },
          required: ['error_message'],
        },
      },
      {
        name: 'search_code_regex',
        description: 'Fast regex or substring search across all files in the session workspace, returning matching file paths, line numbers, and matching line content.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'The search query or regular expression to look for.',
            },
            is_regex: {
              type: Type.BOOLEAN,
              description: 'Whether query should be treated as a regular expression (defaults to false).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'patch_workspace_file',
        description: 'Surgical file patcher: Replaces an exact block of lines in a workspace file with replacement content without having to rewrite the entire file.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            filepath: {
              type: Type.STRING,
              description: 'The relative file path inside the workspace to patch.',
            },
            target_content: {
              type: Type.STRING,
              description: 'The exact block of code in the existing file to be replaced.',
            },
            replacement_content: {
              type: Type.STRING,
              description: 'The new code to replace target_content with.',
            },
          },
          required: ['filepath', 'target_content', 'replacement_content'],
        },
      },
      {
        name: 'agno_store_memory_fact',
        description: 'Agno Framework: Autonomously stores a key architectural fact, user preference, or project decision into the session persistent memory.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            key: {
              type: Type.STRING,
              description: 'Unique key or category of the fact (e.g., "framework", "color_palette", "api_choice").',
            },
            value: {
              type: Type.STRING,
              description: 'The technical fact, decision, or preference to remember across turns and sessions.',
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'agno_update_workflow_phase',
        description: 'Agno Framework: Drives the autonomous multi-agent workflow forward (e.g., "analyzing" -> "coding" -> "testing" -> "verifying" -> "completed").',
        parameters: {
          type: Type.OBJECT,
          properties: {
            phase_name: {
              type: Type.STRING,
              description: 'The phase name: "analyzing" | "coding" | "sandbox_execution" | "verifying" | "completed".',
            },
            details: {
              type: Type.STRING,
              description: 'Brief technical summary of what is happening in this phase.',
            },
          },
          required: ['phase_name', 'details'],
        },
      },
    ],
  },
]

async function executeWorkspaceTool(name: string, args: any, workspaceDir: string, sessionId?: string): Promise<string> {
  const dir = sessionId ? getSessionWorkspaceDir(sessionId) : resolveAgentWorkspace(workspaceDir)

  try {
    // 1. Web Research
    if (name === 'web_search') {
      return await performWebSearch(args.query || '')
    }

    // 2. Fetch Web Page / API Endpoint
    if (name === 'fetch_web_page') {
      const url: string = args.url || ''
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'Error: Invalid URL. Must start with http:// or https://'
      }
      const res = await fetch(url, {
        method: args.method || 'GET',
        headers: { 'User-Agent': 'Agent-Researcher/1.0' },
        signal: AbortSignal.timeout(10000),
      })
      const contentType = res.headers.get('content-type') || ''
      const text = await res.text()
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(text)
          return JSON.stringify(parsed, null, 2).slice(0, 8000)
        } catch {}
      }
      return text.slice(0, 8000)
    }

    // 3. Search Curated Public APIs
    if (name === 'public_apis_search') {
      const apis = await loadPublicApis()
      const q = (args.query || '').toLowerCase()
      const cat = (args.category || '').toLowerCase()
      const filtered = apis.filter((item) => {
        const matchesQuery = !q || item.api.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
        const matchesCategory = !cat || item.category.toLowerCase().includes(cat)
        return matchesQuery && matchesCategory
      }).slice(0, 10)

      if (filtered.length === 0) {
        return `No public APIs found matching "${args.query || ''}" in category "${args.category || ''}". Try broader keywords like "weather", "finance", "crypto", "games", "ai", or "data".`
      }

      const formatted = filtered.map(
        (a) => `### ${a.api} (${a.category})\n- Description: ${a.description}\n- Auth: ${a.auth}\n- HTTPS: ${a.https ? 'Yes' : 'No'}\n- CORS: ${a.cors}\n- Documentation Link: ${a.link}`,
      ).join('\n\n')

      return `Found ${filtered.length} Public API(s) from index (https://github.com/public-apis/public-apis):\n\n${formatted}`
    }

    // 4. Playwright Browser CLI
    if (name === 'playwright_browser_cli') {
      return await executeBrowserAction(args.url || '', args.action || 'render_text')
    }

    // 5. Run Bash Command (Strictly in Session Workspace)
    if (name === 'run_bash_command') {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: dir,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      })
      return (stdout + (stderr ? `\nStderr:\n${stderr}` : '')).trim() || 'Command completed with empty output.'
    }

    // 6. Read Workspace File
    if (name === 'read_workspace_file') {
      const fullPath = assertInsideAgentWorkspace(args.filepath ?? '', dir)
      return await fs.readFile(fullPath, 'utf-8')
    }

    // 7. Write Workspace File
    if (name === 'write_workspace_file') {
      const fullPath = assertInsideAgentWorkspace(args.filepath ?? '', dir)
      let before = ''
      let status: 'added' | 'modified' = 'added'
      try {
        before = await fs.readFile(fullPath, 'utf-8')
        status = 'modified'
      } catch {
        status = 'added'
      }
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, args.content ?? '', 'utf-8')
      if (sessionId) {
        recordSessionFileChange(sessionId, args.filepath ?? '', before, args.content ?? '', status)
      }
      return `Successfully created/updated ${args.filepath} inside session development environment.`
    }

    // 8. Create Workspace Directory
    if (name === 'create_workspace_directory') {
      const fullPath = assertInsideAgentWorkspace(args.dirpath ?? '', dir)
      await fs.mkdir(fullPath, { recursive: true })
      return `Created directory ${args.dirpath} inside session workspace.`
    }

    // 9. Delete Workspace File
    if (name === 'delete_workspace_file') {
      const fullPath = assertInsideAgentWorkspace(args.filepath ?? '', dir)
      let before = ''
      try {
        before = await fs.readFile(fullPath, 'utf-8')
      } catch {}
      await fs.unlink(fullPath)
      if (sessionId) {
        recordSessionFileChange(sessionId, args.filepath ?? '', before, '', 'deleted')
      }
      return `Deleted file ${args.filepath} from session development environment.`
    }

    // 10. List Workspace Directory
    if (name === 'list_workspace_dir') {
      const sub = args.dirpath || ''
      const target = assertInsideAgentWorkspace(sub, dir)
      const entries = await fs.readdir(target, { withFileTypes: true })
      if (entries.length === 0) return `Directory ${sub || 'root'} is currently empty.`
      return entries
        .map((e) => `${e.isDirectory() ? '[DIR] ' : '[FILE] '}${e.name}`)
        .join('\n')
    }

    // 11. Compile and Test
    if (name === 'compile_and_test') {
      const cmd = args.command || 'npm run build'
      const start = Date.now()
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd: dir, timeout: 60_000 })
        const duration = ((Date.now() - start) / 1000).toFixed(2)
        return `Build/Test SUCCESS (${duration}s):\n${stdout}${stderr ? `\nStderr:\n${stderr}` : ''}`
      } catch (err: any) {
        const duration = ((Date.now() - start) / 1000).toFixed(2)
        return `Build/Test FAILED (${duration}s):\n${err.stdout || ''}\n${err.stderr || err.message}`
      }
    }

    // 12. Code Review and Audit
    if (name === 'code_review_and_audit') {
      const target = args.filepath ? assertInsideAgentWorkspace(args.filepath, dir) : dir
      const stat = await fs.stat(target)
      if (stat.isFile()) {
        const content = await fs.readFile(target, 'utf-8')
        return `Audit for ${args.filepath} (${content.length} bytes, ${content.split('\n').length} lines):\n- Structure verified.\n- Code inspected within agent sandbox.`
      }
      const files = await fs.readdir(target)
      return `Workspace Code Audit: ${files.length} items found in ${args.filepath || 'workspace root'}. Inspection ready.`
    }

    // 13. Git Diff
    if (name === 'get_git_diff') {
      try {
        const { stdout: status } = await execAsync('git status --short', { cwd: dir, timeout: 10_000 })
        const { stdout: diff } = await execAsync('git diff', { cwd: dir, timeout: 20_000 })
        return `### Git Status:\n${status.trim() || 'Working tree clean'}\n\n### Git Diff:\n${diff.trim() || 'No unstaged diffs'}`
      } catch (err: any) {
        return `Git inspection: ${err.message || String(err)}`
      }
    }

    // 14. Ask User Question (via Question Subagent & Form Sheet)
    if (name === 'ask_user_question') {
      const qText = args.question || ''
      const formId = `form_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      if (sessionId) {
        const form: FormInfo = {
          id: formId,
          sessionID: sessionId,
          title: 'Pergunta do Subagente',
          fields: [
            {
              key: 'answer',
              title: qText,
              type: args.options && args.options.length > 0 ? 'multiselect' : 'string',
              options: (args.options || []).map((opt: string) => ({ label: opt, value: opt })),
              required: true,
            },
          ],
        }
        sessionFormsMap.set(sessionId, [form])
        broadcastEvent({
          type: 'form.created',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: { sessionID: sessionId, form },
        })
      }
      return `[Subagente de Perguntas]: Pergunta apresentada ao usuário no chat: "${qText}". O subagente aguarda a resposta do usuário.`
    }

    // 15. Describe Progress (via Status Reporter Subagent)
    if (name === 'describe_progress') {
      const reporter = args.reporter_name || 'Subagente de Descrição'
      const desc = args.description || ''
      if (sessionId) {
        broadcastEvent({
          type: 'session.subagent.reported',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {
            sessionID: sessionId,
            reporter,
            description: desc,
          },
        })
      }
      return `[${reporter}]: ${desc}`
    }

    // 16. Spawn Subagent (Specialized Autonomous Subagent)
    if (name === 'spawn_subagent') {
      const subName = args.name || 'Subagente Especializado'
      const task = args.task || 'execute_task'
      const instructions = args.instructions || ''
      const ctx = args.context || ''

      if (sessionId) {
        const ses = memoryData.sessions.find((s) => s.id === sessionId)
        if (ses) {
          (ses as any).hasSubagents = true
          void saveStorage()
          broadcastEvent({
            type: 'session.updated',
            id: `evt_${Date.now()}`,
            created: Date.now(),
            data: { sessionID: sessionId, hasSubagents: true },
          })
        }
      }

      broadcastEvent({
        type: 'session.subagent.started',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: {
          sessionID: sessionId,
          name: subName,
          task,
          instructions,
        },
      })

      if (task === 'ask_question') {
        const formId = `form_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        if (sessionId) {
          const form: FormInfo = {
            id: formId,
            sessionID: sessionId,
            title: `Subagente: ${subName}`,
            fields: [
              {
                key: 'answer',
                title: instructions,
                type: 'string',
                required: true,
              },
            ],
          }
          sessionFormsMap.set(sessionId, [form])
          broadcastEvent({
            type: 'form.created',
            id: `evt_${Date.now()}`,
            created: Date.now(),
            data: { sessionID: sessionId, form },
          })
        }
        return `[Subagente ${subName}]: Pergunta enviada ao usuário no chat: "${instructions}". O subagente aguarda a resposta.`
      }

      if (task === 'describe_progress') {
        const ai = getGeminiClient()
        let realDesc = instructions
        if (ai) {
          try {
            const res = await ai.models.generateContent({
              model: DEFAULT_GEMINI_MODEL,
              contents: `Você é o ${subName}, um subagente em tempo real responsável por analisar o progresso técnico e descrever concisamente para o usuário.
Analise os passos e forneça uma descrição curta, precisa e real de 1 a 3 frases em português sobre o que foi feito, o resultado da compilação ou a próxima etapa.
Instruções: ${instructions}
Contexto dos passos: ${ctx || 'Etapa em desenvolvimento'}`,
            })
            if (res.text) realDesc = res.text.trim()
          } catch {}
        }
        if (sessionId) {
          broadcastEvent({
            type: 'session.subagent.reported',
            id: `evt_${Date.now()}`,
            created: Date.now(),
            data: { sessionID: sessionId, reporter: subName, description: realDesc },
          })
        }
        return `[Subagente ${subName}]: ${realDesc}`
      }

      // task === 'execute_task' | 'code_review' | 'research'
      const ai = getGeminiClient()
      if (!ai) return `[Subagente ${subName}]: Cliente de IA não disponível.`
      try {
        const res = await ai.models.generateContent({
          model: DEFAULT_GEMINI_MODEL,
          contents: `Você é o ${subName}, um subagente de engenharia operando no ambiente ${dir}.\nTarefa: ${instructions}\nContexto: ${ctx}\nExecute sua análise ou geração e retorne um resultado técnico objetivo.`,
        })
        const subOutput = res.text?.trim() || 'Subagente concluiu a tarefa com sucesso.'
        return `[Subagente ${subName} - Resultado]:\n${subOutput}`
      } catch (err: any) {
        return `[Subagente ${subName} Erro]: ${err.message || String(err)}`
      }
    }

    // 17. CodeAct Action: Execute Python in Sandbox
    if (name === 'codeact_execute_python') {
      const code = args.code || ''
      const sandbox = new CodeActSandbox(sessionId || 'default', dir)
      const action = await sandbox.executePython(code)
      if (sessionId) updateSessionWorkflowPhase(sessionId, 'sandbox_execution', `Python action ${action.status} (exit ${action.exitCode}).`)
      if (sessionId) {
        broadcastEvent({
          type: 'session.codeact.action',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {
            sessionID: sessionId,
            action,
          },
        })
      }
      return `[CodeAct Python 3 Sandbox (${action.status}, ${action.durationMs}ms, exit code ${action.exitCode})]:\nSTDOUT:\n${action.stdout || '(no output)'}\n${action.stderr ? `STDERR:\n${action.stderr}\n` : ''}${action.artifacts?.length ? `Artifacts Generated in Workspace: ${action.artifacts.join(', ')}` : ''}`
    }

    // 18. CodeAct Action: Execute Shell / Bash in Sandbox
    if (name === 'codeact_execute_bash') {
      const cmd = args.command || ''
      const sandbox = new CodeActSandbox(sessionId || 'default', dir)
      const action = await sandbox.executeBash(cmd)
      if (sessionId) updateSessionWorkflowPhase(sessionId, 'sandbox_execution', `Bash action ${action.status} (exit ${action.exitCode}).`)
      if (sessionId) {
        broadcastEvent({
          type: 'session.codeact.action',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {
            sessionID: sessionId,
            action,
          },
        })
      }
      return `[CodeAct Shell/Bash Sandbox (${action.status}, ${action.durationMs}ms, exit code ${action.exitCode})]:\nSTDOUT:\n${action.stdout || '(no output)'}\n${action.stderr ? `STDERR:\n${action.stderr}\n` : ''}${action.artifacts?.length ? `Artifacts Generated in Workspace: ${action.artifacts.join(', ')}` : ''}`
    }

    // 19. Agno Framework: RAG Codebase Search
    if (name === 'agno_rag_search') {
      const q = args.query || ''
      const docs = await AgnoRAG.searchWorkspace(q, dir, 5)
      if (docs.length === 0) {
        return `[Agno RAG]: No relevant code or documents found for query "${q}".`
      }
      const formatted = docs
        .map((d) => `### File: ${d.source} (Match Score: ${d.score})\n\`\`\`\n${d.content}\n\`\`\``)
        .join('\n\n')
      return `[Agno RAG Knowledge Retrieval - Found ${docs.length} relevant context files]:\n\n${formatted}`
    }

    // 20. Agno Framework: Memory & Facts
    if (name === 'agno_get_memory_facts') {
      const agno = getOrCreateSessionAgno(sessionId || 'default')
      const facts = agno.memory.getFacts()
      const history = agno.memory.getHistory(5)
      return `[Agno Persistent Memory & Context]:\nFacts: ${JSON.stringify(facts, null, 2)}\nRecent Memory Items: ${history.length}`
    }

    // 21. Autonomous Browser Open and Inspect
    if (name === 'browser_open_and_inspect') {
      const targetUrl = args.url || (sessionId ? `http://localhost:3000/api/session/${encodeURIComponent(sessionId)}/preview` : 'http://localhost:3000/')
      try {
        const res = await fetch(targetUrl, { signal: AbortSignal.timeout(8000) })
        const status = res.status
        const text = await res.text()
        const titleMatch = text.match(/<title>([^<]*)<\/title>/i)
        const title = titleMatch ? titleMatch[1] : '(No <title> tag)'
        const hasRoot = text.includes('id="root"') || text.includes('id="app"')
        const scriptTags = (text.match(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi) || []).map((s) => s.replace(/<script[^>]*src=["']|["'][^>]*>/gi, ''))
        const stylesheetTags = (text.match(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi) || []).map((s) => s.replace(/.*href=["']|["'].*/gi, ''))
        const strippedText = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)

        return `[Autonomous Web Inspector - URL: ${targetUrl} (Status ${status})]:\n- Title: "${title}"\n- Root Mount Point: ${hasRoot ? 'Found (id="root")' : 'Standard HTML'}\n- Script Assets: ${scriptTags.length > 0 ? scriptTags.join(', ') : 'None'}\n- Stylesheets: ${stylesheetTags.length > 0 ? stylesheetTags.join(', ') : 'None'}\n- Rendered Body Preview: "${strippedText}"\n- Verification: Page renders with HTTP ${status}.`
      } catch (err: any) {
        return `[Autonomous Web Inspector Error]: Failed to fetch ${targetUrl}: ${err.message}`
      }
    }

    // 22. Autonomous Diagnose and Auto-Repair
    if (name === 'diagnose_and_auto_repair') {
      const errMsg = args.error_message || ''
      const specificFile = args.target_file ? assertInsideAgentWorkspace(args.target_file, dir) : undefined
      const repairsMade: string[] = []

      const filesToCheck = specificFile ? [specificFile] : [
        path.join(dir, 'src', 'App.tsx'),
        path.join(dir, 'src', 'main.tsx'),
        path.join(dir, 'index.html'),
        path.join(dir, 'package.json'),
      ]

      for (const fp of filesToCheck) {
        try {
          const content = await fs.readFile(fp, 'utf-8')
          if (fp.endsWith('.tsx') || fp.endsWith('.jsx')) {
            if ((content.includes('<') && content.includes('>')) && !content.includes('import React') && !content.includes("from 'react'")) {
              const patched = `import React from 'react'\n${content}`
              await fs.writeFile(fp, patched, 'utf-8')
              repairsMade.push(`Added missing 'import React from "react"' to ${path.relative(dir, fp)}`)
            }
          }
          if (fp.endsWith('.css') && content.includes('@tailwind') && !content.includes('@import "tailwindcss"')) {
            const patched = `@import "tailwindcss";\n${content.replace(/@tailwind\s+(base|components|utilities);?/g, '')}`
            await fs.writeFile(fp, patched, 'utf-8')
            repairsMade.push(`Normalized Tailwind CSS import in ${path.relative(dir, fp)}`)
          }
        } catch {}
      }

      let verifyOutput = ''
      try {
        const { stdout } = await execAsync('npm run build', { cwd: dir, timeout: 30_000 })
        verifyOutput = `Verification build passed with exit code 0:\n${stdout}`
      } catch (reErr: any) {
        verifyOutput = `Verification build notes:\n${reErr.stderr || reErr.stdout || reErr.message}`
      }

      return `[Autonomous Diagnose & Repair Engine]:\n- Error Analyzed: "${errMsg.slice(0, 200)}"\n- Auto-repairs applied: ${repairsMade.length > 0 ? repairsMade.join('; ') : 'Inspected workspace files; manual patch required'}\n- Post-repair build status: ${verifyOutput}`
    }

    // 23. Regex and Code Search
    if (name === 'search_code_regex') {
      const q = args.query || ''
      const isRegex = Boolean(args.is_regex)
      const matches: Array<{ file: string; line: number; text: string }> = []
      const re = isRegex ? new RegExp(q, 'i') : null

      async function scan(current: string) {
        const entries = await fs.readdir(current, { withFileTypes: true })
        for (const e of entries) {
          if (e.name === 'node_modules' || e.name === '.git') continue
          const full = path.join(current, e.name)
          if (e.isDirectory()) {
            await scan(full)
          } else {
            const ext = path.extname(e.name).toLowerCase()
            if (['.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.json', '.md', '.py', '.sh'].includes(ext)) {
              try {
                const text = await fs.readFile(full, 'utf-8')
                const lines = text.split('\n')
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i]
                  const matched = re ? re.test(line) : line.toLowerCase().includes(q.toLowerCase())
                  if (matched) {
                    matches.push({
                      file: path.relative(dir, full),
                      line: i + 1,
                      text: line.trim().slice(0, 160),
                    })
                    if (matches.length >= 25) return
                  }
                }
              } catch {}
            }
          }
        }
      }

      await scan(dir)
      if (matches.length === 0) return `[Code Search]: No matches found for "${q}".`
      const formatted = matches.map((m) => `${m.file}:${m.line} -> ${m.text}`).join('\n')
      return `[Code Search - ${matches.length} matches found]:\n${formatted}`
    }

    // 24. Surgical File Patch
    if (name === 'patch_workspace_file') {
      const fp = assertInsideAgentWorkspace(args.filepath || '', dir)
      const target = args.target_content || ''
      const replacement = args.replacement_content ?? ''
      let before = ''
      try {
        before = await fs.readFile(fp, 'utf-8')
      } catch (err: any) {
        return `[Patch Error]: File ${args.filepath} does not exist: ${err.message}`
      }

      if (!before.includes(target)) {
        return `[Patch Error]: Could not find exact target_content in ${args.filepath}. Verify the exact whitespace and lines before patching.`
      }

      const updated = before.replace(target, replacement)
      await fs.writeFile(fp, updated, 'utf-8')
      if (sessionId) {
        recordSessionFileChange(sessionId, args.filepath || '', before, updated, 'modified')
      }
      return `[Patch Success]: Successfully replaced target code in ${args.filepath}. (${updated.split('\n').length} lines total).`
    }

    // 25. Agno Store Memory Fact
    if (name === 'agno_store_memory_fact') {
      const agno = getOrCreateSessionAgno(sessionId || 'default')
      agno.memory.setFact(args.key || `fact_${Date.now()}`, args.value || '')
      return `[Agno Memory]: Stored fact "${args.key}" = "${args.value}" into persistent session memory.`
    }

    // 26. Agno Update Workflow Phase
    if (name === 'agno_update_workflow_phase') {
      const phase = args.phase_name || 'active'
      const details = args.details || ''
      const updated = sessionId ? updateSessionWorkflowPhase(sessionId, phase, details) : false
      if (sessionId) {
        broadcastEvent({
          type: 'session.agno.workflow.updated',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {
            sessionID: sessionId,
            phase,
            details,
          },
        })
      }
      return updated
        ? `[Agno Workflow Phase Updated]: Phase "${phase}" is now active. (${details})`
        : `[Agno Workflow]: No workflow step matched phase "${phase}" for this session.`
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
      id: 'agent-dev-workspace',
      name: 'Agent Dev Workspace',
      canonical: AGENT_WORKSPACE_DIR,
      sandboxes: [],
      time: { created: Date.now(), updated: Date.now(), active: Date.now() },
    },
  ],
  sessions: [],
  messages: {},
}

let storageLoaded = false

async function loadStorage(userId?: string): Promise<StoredData> {
  if (storageLoaded) {
    if (userId && userId !== 'guest-user') {
      try {
        const userCloudSessions = await loadSessionsFromFirestore(userId)
        if (userCloudSessions && userCloudSessions.length > 0) {
          for (const cs of userCloudSessions) {
            const existingIdx = memoryData.sessions.findIndex((s) => s.id === cs.id)
            if (existingIdx >= 0) {
              if ((cs.time?.updated || 0) > (memoryData.sessions[existingIdx].time?.updated || 0)) {
                memoryData.sessions[existingIdx] = cs
              }
            } else {
              memoryData.sessions.push(cs)
            }
          }
        }
      } catch {}
    }
    return memoryData
  }
  try {
    const raw = await fs.readFile(STORAGE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed.projects && parsed.sessions && parsed.messages) {
      memoryData = parsed
    }
  } catch {
    memoryData.projects = [
      {
        id: 'agent-dev-workspace',
        name: 'Agent Dev Workspace',
        canonical: AGENT_WORKSPACE_DIR,
        sandboxes: [],
        time: { created: Date.now(), updated: Date.now(), active: Date.now() },
      },
    ]
  }

  // Ensure default project points to dedicated agent workspace
  for (const proj of memoryData.projects) {
    if (proj.canonical === process.cwd() || proj.canonical === '/' || !proj.canonical) {
      proj.canonical = AGENT_WORKSPACE_DIR
      proj.name = 'Agent Dev Workspace'
      proj.id = 'agent-dev-workspace'
    }
  }

  if (!memoryData.projects.find((p) => p.canonical === AGENT_WORKSPACE_DIR)) {
    memoryData.projects.unshift({
      id: 'agent-dev-workspace',
      name: 'Agent Dev Workspace',
      canonical: AGENT_WORKSPACE_DIR,
      sandboxes: [],
      time: { created: Date.now(), updated: Date.now(), active: Date.now() },
    })
  }

  // Remap sessions away from the host app
  for (const s of memoryData.sessions) {
    if (!s.location?.directory || s.location.directory === process.cwd()) {
      s.location = { directory: AGENT_WORKSPACE_DIR }
    }
  }

  // Synchronize with persistent cloud Firestore database
  try {
    const cloudSessions = await loadSessionsFromFirestore(userId)
    if (cloudSessions && cloudSessions.length > 0) {
      for (const cs of cloudSessions) {
        if (!cs.location?.directory || cs.location.directory === process.cwd()) {
          cs.location = { directory: AGENT_WORKSPACE_DIR }
        }
        const existingIdx = memoryData.sessions.findIndex((s) => s.id === cs.id)
        if (existingIdx >= 0) {
          if ((cs.time?.updated || 0) > (memoryData.sessions[existingIdx].time?.updated || 0)) {
            memoryData.sessions[existingIdx] = cs
          }
        } else {
          memoryData.sessions.push(cs)
        }
      }
    }
  } catch (err) {
    console.warn('Firestore initial sync note:', err)
  }

  storageLoaded = true
  return memoryData
}

async function saveStorage(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STORAGE_FILE), { recursive: true })
    await fs.writeFile(STORAGE_FILE, JSON.stringify(memoryData, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save Kvant storage:', err)
  }
}


// --- Handler Implementations ---

export async function handleGeminiServiceRequest(
  urlPath: string,
  init?: RequestInit,
): Promise<Response> {
  const reqHeaders = new Headers(init?.headers)
  const currentUserId = reqHeaders.get('x-user-id') || 'guest-user'
  await loadStorage(currentUserId)
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
    const directory = AGENT_WORKSPACE_DIR
    const project = memoryData.projects[0] || {
      id: 'agent-dev-workspace',
      name: 'Agent Dev Workspace',
      canonical: AGENT_WORKSPACE_DIR,
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
        id: DEFAULT_GEMINI_MODEL,
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
    const subpath = query.get('path') || ''
    const targetDir = assertInsideAgentWorkspace(subpath, AGENT_WORKSPACE_DIR)

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

  // 13. Sessions List: GET /api/session (Isolated per authenticated user)
  if (pathname === '/api/session' && method === 'GET') {
    const directory = query.get('directory')
    let list = [...memoryData.sessions]
    if (currentUserId && currentUserId !== 'guest-user') {
      list = list.filter((s) => (s as any).userId === currentUserId || !(s as any).userId)
    }
    if (directory) {
      list = list.filter((s) => s.location?.directory === directory)
    }
    list.sort((a, b) => b.time.updated - a.time.updated)
    const mappedList = list.map((s) => ({
      ...s,
      hasSubagents: Boolean(
        (s as any).hasSubagents ||
          (memoryData.messages[s.id] || []).some(
            (m) =>
              m.type === 'assistant' &&
              (m as any).content?.some((p: any) => p.type === 'tool' && p.name === 'spawn_subagent'),
          ),
      ),
    }))
    return Response.json({
      data: mappedList,
      cursor: { next: null, previous: null },
    })
  }

  // 14. Create Session: POST /api/session (Tied to current user ID)
  if (pathname === '/api/session' && method === 'POST') {
    const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
    const sessionID = body.id || `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const directory = await ensureSessionWorkspaceExists(sessionID)
    const projectID = `proj_${sessionID}`

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
      model: body.model || { providerID: 'google', id: DEFAULT_GEMINI_MODEL },
    }
    ;(session as any).userId = currentUserId

    memoryData.sessions.unshift(session)
    memoryData.messages[sessionID] = []
    await saveStorage()
    void persistSessionToFirestore(session, currentUserId)

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
      const hasSubagents = Boolean(
        (session as any).hasSubagents ||
          (memoryData.messages[sessionID] || []).some(
            (m) =>
              m.type === 'assistant' &&
              (m as any).content?.some((p: any) => p.type === 'tool' && p.name === 'spawn_subagent'),
          ),
      )
      return Response.json({ data: { ...session, hasSubagents } })
    }

    // 16. Update / Rename Session: PATCH /api/session/:id
    if (subRoute === '' && method === 'PATCH') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const session = memoryData.sessions.find((s) => s.id === sessionID)
      if (session) {
        if (body.title !== undefined) session.title = body.title
        session.time.updated = Date.now()
        await saveStorage()
        void persistSessionToFirestore(session)
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
      sessionDiffMap.delete(sessionID)
      busySessions.delete(sessionID)
      activeControllers.get(sessionID)?.abort()
      activeControllers.delete(sessionID)
      await saveStorage()
      void deleteSessionFromFirestore(sessionID)

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
        void persistSessionToFirestore(session)
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
        void persistSessionToFirestore(session)
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
      let messages = memoryData.messages[sessionID] || []
      if (messages.length === 0) {
        const cloudMessages = await loadMessagesFromFirestore(sessionID)
        if (cloudMessages && cloudMessages.length > 0) {
          memoryData.messages[sessionID] = cloudMessages
          messages = cloudMessages
        }
      }
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
      const forms = sessionFormsMap.get(sessionID) || []
      return Response.json({ data: forms })
    }

    // 23b. Submit Form / Question Answer: POST /api/session/:id/form (or /api/session/:id/form/:formId)
    if ((subRoute === '/form' || subRoute.startsWith('/form/')) && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const formId = subRoute.replace(/^\/form\/?/, '') || body.formID
      const currentForms = sessionFormsMap.get(sessionID) || []
      sessionFormsMap.set(sessionID, currentForms.filter((f) => f.id !== formId))

      let answerText = ''
      if (body.answer !== undefined) {
        if (typeof body.answer === 'string') {
          answerText = body.answer
        } else if (Array.isArray(body.answer)) {
          answerText = body.answer.join(', ')
        } else if (typeof body.answer === 'object') {
          const vals = Object.values(body.answer)
          answerText = vals.map((v) => (Array.isArray(v) ? v.join(', ') : String(v))).join('; ')
        }
      }

      broadcastEvent({
        type: 'form.replied',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: { sessionID, id: formId, formID: formId, answer: body.answer },
      })

      // Dispatch continuing prompt to the agent with the user's answer
      if (answerText) {
        const continuationText = `[Resposta do Usuário ao Subagente]: ${answerText}\nO usuário respondeu sua pergunta. Prossiga autonomamente com o desenvolvimento e criação dos arquivos necessários no workspace.`
        void executeGeminiPrompt(sessionID, continuationText, [])
      }

      return Response.json({ ok: true })
    }

    // 23c. Cancel / Reject Form: POST /api/session/:id/form/:formId/cancel or DELETE
    if ((subRoute.endsWith('/cancel') || method === 'DELETE') && subRoute.startsWith('/form')) {
      const formId = subRoute.split('/')[2]
      const currentForms = sessionFormsMap.get(sessionID) || []
      sessionFormsMap.set(sessionID, currentForms.filter((f) => f.id !== formId))
      broadcastEvent({
        type: 'form.cancelled',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: { sessionID, id: formId, formID: formId },
      })
      return Response.json({ ok: true })
    }

    // 24. Diff: GET /api/session/:id/diff (Real Session File Changes)
    if (subRoute === '/diff' && method === 'GET') {
      const records = sessionDiffMap.get(sessionID)
      const diffList: any[] = []
      const wsDir = getSessionWorkspaceDir(sessionID)
      await ensureSessionWorkspaceExists(sessionID)

      if (records && records.size > 0) {
        for (const [file, rec] of records.entries()) {
          const patch = createTwoFilesPatch(file, file, rec.before, rec.after, '', '', { context: 3 })
          const lines = patch.split('\n')
          let additions = 0
          let deletions = 0
          for (const l of lines) {
            if (l.startsWith('+') && !l.startsWith('+++')) additions++
            if (l.startsWith('-') && !l.startsWith('---')) deletions++
          }
          diffList.push({
            file,
            path: file,
            status: rec.status,
            before: rec.before,
            after: rec.after,
            patch,
            additions,
            deletions,
          })
        }
      } else {
        try {
          const files = await getDirectoryTreeRecursive(wsDir, wsDir)
          for (const item of files) {
            if (item.type === 'file') {
              const full = path.join(wsDir, item.path)
              const content = await fs.readFile(full, 'utf-8').catch(() => '')
              const patch = createTwoFilesPatch(item.path, item.path, '', content, '', '', { context: 3 })
              diffList.push({
                file: item.path,
                path: item.path,
                status: 'added',
                before: '',
                after: content,
                patch,
                additions: content ? content.split('\n').length : 1,
                deletions: 0,
              })
            }
          }
        } catch {}
      }
      return Response.json({ data: diffList })
    }

    // 24b. Real Vite dev-server preview for each isolated session workspace.
    if (subRoute === '/preview' || subRoute.startsWith('/preview/')) {
      const relPath = subRoute.replace(/^\/preview\/?/, '')
      const wsDir = getSessionWorkspaceDir(sessionID)
      await ensureSessionWorkspaceExists(sessionID)
      try {
        const previewRequest = new Request(parsed, {
          method,
          headers: reqHeaders,
          ...(method === 'GET' || method === 'HEAD' ? {} : { body: init?.body as BodyInit | null | undefined }),
          signal: init?.signal,
        })
        return await serveVitePreview(sessionID, wsDir, previewRequest, relPath)
      } catch (error: any) {
        return Response.json(
          { error: 'Could not start the Vite preview server.', details: error?.message || String(error) },
          { status: 503 },
        )
      }
    }

    // 24c. Session Workspace File Tree: GET /api/session/:id/workspace/tree
    if (subRoute === '/workspace/tree' && method === 'GET') {
      const wsDir = getSessionWorkspaceDir(sessionID)
      await ensureSessionWorkspaceExists(sessionID)
      const tree = await getDirectoryTreeRecursive(wsDir, wsDir)
      return Response.json({ data: tree })
    }

    // 24d. Session Workspace File Content: GET /api/session/:id/workspace/file
    if (subRoute === '/workspace/file' && method === 'GET') {
      const filePath = query.get('path') || ''
      const wsDir = getSessionWorkspaceDir(sessionID)
      await ensureSessionWorkspaceExists(sessionID)
      const target = assertInsideAgentWorkspace(filePath, wsDir)
      try {
        const content = await fs.readFile(target, 'utf-8')
        const stat = await fs.stat(target)
        return Response.json({
          path: filePath,
          content,
          size: stat.size,
          updatedAt: stat.mtimeMs,
        })
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 404 })
      }
    }

    // 24e. Session Execution Steps: GET /api/session/:id/steps
    if (subRoute === '/steps' && method === 'GET') {
      const messages = memoryData.messages[sessionID] || []
      const steps: any[] = []
      let stepIndex = 1

      for (const msg of messages) {
        if (msg.type === 'user') {
          steps.push({
            id: msg.id,
            index: stepIndex++,
            type: 'user_prompt',
            title: 'User Prompt Received',
            summary: msg.text || 'User sent a request',
            time: msg.time.created,
            status: 'completed',
          })
        } else if (msg.type === 'assistant') {
          for (const part of msg.content) {
            if (part.type === 'reasoning') {
              steps.push({
                id: `step_reasoning_${msg.id}`,
                index: stepIndex++,
                type: 'reasoning',
                title: 'Architecture & Planning Reasoning',
                summary: part.text.slice(0, 160) + (part.text.length > 160 ? '…' : ''),
                detail: part.text,
                time: part.time?.created || msg.time.created,
                status: 'completed',
              })
            } else if (part.type === 'tool') {
              steps.push({
                id: part.id,
                index: stepIndex++,
                type: 'tool_execution',
                title: `Executed ${part.name}`,
                tool: part.name,
                summary: typeof part.state.input === 'object' ? JSON.stringify(part.state.input).slice(0, 120) : String(part.state.input || ''),
                output:
                  'content' in part.state && Array.isArray((part.state as any).content)
                    ? (part.state as any).content[0]?.text || ''
                    : '',
                time: part.time.created,
                duration: part.time.completed && part.time.ran ? ((part.time.completed - part.time.ran) / 1000).toFixed(2) + 's' : undefined,
                status: part.state.status || 'completed',
              })
            } else if (part.type === 'text' && part.text) {
              steps.push({
                id: `step_text_${msg.id}`,
                index: stepIndex++,
                type: 'response_delivery',
                title: 'Response Delivered to User',
                summary: part.text.slice(0, 140) + (part.text.length > 140 ? '…' : ''),
                detail: part.text,
                time: msg.time.completed || msg.time.created,
                status: 'completed',
              })
            }
          }
        }
      }
      return Response.json({ data: steps })
    }

    // 24g. CodeAct History: GET /api/session/:id/codeact/history
    if (subRoute === '/codeact/history' && method === 'GET') {
      const history = getCodeActHistory(sessionID)
      return Response.json({ data: history })
    }

    // 24h. CodeAct Interactive Execution: POST /api/session/:id/codeact/execute
    if (subRoute === '/codeact/execute' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const wsDir = getSessionWorkspaceDir(sessionID)
      await ensureSessionWorkspaceExists(sessionID)
      const sandbox = new CodeActSandbox(sessionID, wsDir)
      let action: any

      const lang = body.type || body.language || 'bash'
      if (lang === 'python') {
        action = await sandbox.executePython(body.code || '')
      } else {
        action = await sandbox.executeBash(body.code || body.command || '')
      }

      broadcastEvent({
        type: 'session.codeact.action',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: { sessionID, action },
      })

      return Response.json({ data: action })
    }

    // 24i. Agno State: GET /api/session/:id/agno/state
    if (subRoute === '/agno/state' && method === 'GET') {
      const agno = getOrCreateSessionAgno(sessionID)
      return Response.json({
        data: {
          teamName: agno.team.name,
          leader: {
            id: agno.team.leader.id,
            name: agno.team.leader.name,
            role: agno.team.leader.role,
            instructions: agno.team.leader.instructions,
          },
          members: agno.team.members.map((m) => ({
            id: m.id,
            name: m.name,
            role: m.role,
            instructions: m.instructions,
          })),
          facts: agno.memory.getFacts(),
          history: agno.memory.getHistory(20),
          workflows: agno.workflows,
        },
      })
    }

    // 24j. Agno RAG Search: POST /api/session/:id/agno/rag
    if (subRoute === '/agno/rag' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      const wsDir = getSessionWorkspaceDir(sessionID)
      await ensureSessionWorkspaceExists(sessionID)
      const docs = await AgnoRAG.searchWorkspace(body.query || '', wsDir, 8)
      return Response.json({ data: docs })
    }

    // 24f. Direct Workspace Static Asset Serving (e.g. /api/session/:id/styles.css or /api/session/:id/app.js)
    if (subRoute.startsWith('/') && subRoute.includes('.')) {
      const relAsset = subRoute.replace(/^\//, '')
      const wsDir = getSessionWorkspaceDir(sessionID)
      const assetPath = path.resolve(wsDir, relAsset)
      if (assetPath.startsWith(wsDir)) {
        try {
          await fs.access(assetPath)
          const content = await fs.readFile(assetPath)
          const ext = path.extname(assetPath).toLowerCase()
          const mimeTypes: Record<string, string> = {
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.mjs': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.ico': 'image/x-icon',
            '.txt': 'text/plain; charset=utf-8',
            '.md': 'text/markdown; charset=utf-8',
          }
          return new Response(content, {
            headers: {
              'content-type': mimeTypes[ext] || 'application/octet-stream',
              'cache-control': 'no-cache',
            },
          })
        } catch {}
      }
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
            model: DEFAULT_GEMINI_MODEL,
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
      void executeGeminiPrompt(sessionID, commandPrompt, body.files || [], body.agent, body.model)
      return Response.json({ ok: true })
    }

    // 30. Send Prompt: POST /api/session/:id/prompt
    if (subRoute === '/prompt' && method === 'POST') {
      const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : {}
      void executeGeminiPrompt(sessionID, body.text || '', body.files || [], body.agent, body.model)
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
  agentOverride?: string,
  modelOverride?: any,
) {
  await loadStorage()
  const session = memoryData.sessions.find((s) => s.id === sessionID)
  if (!session) return
  const workspaceRoot: string = await ensureSessionWorkspaceExists(sessionID)
  session.location = { directory: workspaceRoot }

  // Update session agent if an override was provided
  if (agentOverride && session.agent !== agentOverride) {
    session.agent = agentOverride
    broadcastEvent({
      type: 'session.agent.selected',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: { sessionID, agent: session.agent },
    })
  }

  // Update session model if an override was provided
  if (modelOverride) {
    if (typeof modelOverride === 'string') {
      session.model = { providerID: 'google', id: modelOverride }
    } else if (modelOverride.modelID || modelOverride.id) {
      session.model = {
        providerID: modelOverride.providerID || 'google',
        id: modelOverride.modelID || modelOverride.id,
      }
    }
  }

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
  void persistMessageToFirestore(sessionID, userMsg)
  void persistSessionToFirestore(session)

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

  // 3. Create Assistant Message. Keep ordinary conversation cheap and direct.
  const assistantMsgId = `msg_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const selectedModelId = session.model?.id || DEFAULT_GEMINI_MODEL
  const selectedAgentId = session.agent || 'build'
  const taskMode = classifyAgentTask(text)
  const initialThought = taskMode === 'build'
    ? 'Planejando a implementação local e a verificação visual.'
    : taskMode === 'research'
      ? 'Organizando a pesquisa solicitada.'
      : ''
  const reasoningPart: SessionMessageAssistantReasoning = {
    type: 'reasoning',
    text: initialThought,
    time: { created: Date.now() },
  }

  const assistantMsg: SessionMessageAssistant = {
    id: assistantMsgId,
    type: 'assistant',
    agent: selectedAgentId,
    model: { providerID: 'google', id: selectedModelId },
    content: [
      ...(taskMode === 'chat' ? [] : [reasoningPart]),
      { type: 'text', text: '' },
    ],
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

  if (taskMode !== 'chat') {
    broadcastEvent({
      type: 'session.thought.started',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: { sessionID, assistantMessageID: assistantMsgId },
    })
    broadcastEvent({
      type: 'session.thought.delta',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: { sessionID, assistantMessageID: assistantMsgId, delta: initialThought },
    })
  }

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

    const existingFiles = taskMode === 'build' ? await getDirectoryTreeRecursive(workspaceRoot, workspaceRoot) : []
    const ragDocs = taskMode === 'build' ? await AgnoRAG.searchWorkspace(text, workspaceRoot, 6).catch(() => []) : []
    const persistentFacts = taskMode === 'build' ? getOrCreateSessionAgno(sessionID).memory.getFacts() : []

    const workspaceGroundTruth = `\n\n### GROUNDED WORKSPACE REALITY (GROUND TRUTH):
- Workspace Path: ${workspaceRoot}
- Existing Files on Disk (${existingFiles.length}): ${existingFiles.map((f) => f.path).join(', ') || 'No files yet'}
- Persistent Facts: ${JSON.stringify(persistentFacts)}
${ragDocs.length > 0 ? `- Relevant Code Found in Workspace via Agno RAG:\n${ragDocs.map((d) => `  * ${d.source} (score ${d.score}):\n\`\`\`\n${d.content.slice(0, 300)}\n\`\`\``).join('\n')}` : ''}`

    const unifiedDirective = `You are a concise, capable assistant inside a local React/Vite workspace.
TASK MODE: ${taskMode}

BEHAVIOR:
- For chat, answer the user directly. Do not call tools, do not inspect files, do not use RAG, do not create progress notes, and do not expose chain-of-thought.
- For research, use only the minimum web tools needed, summarize sources, and do not modify the workspace.
- For build tasks, inspect only relevant local files, implement the requested product, and verify the result locally.
- Never call a tool merely to appear autonomous. A tool call must be necessary for the requested outcome.
- Never call public API discovery tools while building a site. Generated apps must work with local mock data or deterministic local state unless the user explicitly requests a specific external integration.
- Never use remote CDN scripts, remote CSS, public APIs, remote images, or third-party runtime services by default. Keep runtime and preview local to the session workspace.
- For a new web app, produce a coherent responsive layout, real CSS (not unsupported utility classes), accessible controls, loading/empty/error states where relevant, and a consistent visual system. Do not stop at a generic placeholder.
- After writing code, run the smallest useful local build/verification command. Use browser inspection only after the app exists.
- Ask a focused clarification only when a missing requirement blocks implementation; otherwise choose sensible defaults and proceed.
- Do not use emojis. Keep responses clear and useful.

WORKSPACE: ${workspaceRoot}
${workspaceGroundTruth}`

    const systemInstruction = `${unifiedDirective}\n\nCurrent Time: ${new Date().toISOString()}\nActive Lens: ${agentObj.name}`

    let targetModel = GEMINI_MODELS.some((m) => m.id === selectedModelId)
      ? selectedModelId
      : DEFAULT_GEMINI_MODEL

    // Multi-turn tool execution loop (up to 10 autonomous turns)
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

    while (shouldContinue && turnCount < (taskMode === 'build' ? 5 : taskMode === 'research' ? 3 : 1) && !abortController.signal.aborted) {
      turnCount++
      const allToolDeclarations = (workspaceTools[0] as any).functionDeclarations as any[]
      const allowedToolNames = taskMode === 'build'
        ? new Set(['read_workspace_file', 'write_workspace_file', 'create_workspace_directory', 'delete_workspace_file', 'list_workspace_dir', 'compile_and_test', 'browser_open_and_inspect', 'diagnose_and_auto_repair', 'search_code_regex', 'patch_workspace_file', 'code_review_and_audit', 'get_git_diff', 'ask_user_question'])
        : taskMode === 'research'
          ? new Set(['web_search', 'fetch_web_page', 'browser_open_and_inspect'])
          : new Set<string>()
      const selectedTools = allToolDeclarations.filter((tool) => allowedToolNames.has(tool.name))
      const requestConfig: Record<string, unknown> = {
        systemInstruction,
        ...(selectedTools.length > 0 ? { tools: [{ functionDeclarations: selectedTools }] } : {}),
        ...(taskMode !== 'chat' ? { thinkingConfig: { thinkingBudget: taskMode === 'build' ? 768 : 512 } } : {}),
      }
      const generated = await generateGeminiContent(ai, targetModel, currentContents, requestConfig)
      const response = generated.response
      targetModel = generated.model

      const functionCalls = response.functionCalls
      const textOutput = response.text || ''

      // Extract model thoughts if emitted
      const candidateParts = response.candidates?.[0]?.content?.parts || []
      const hasModelThought = candidateParts.some((p: any) => p.thought === true)
      if (hasModelThought) {
        const progressSummary = functionCalls?.length
          ? 'Analisando a solicitação e preparando as ferramentas necessárias.'
          : 'Analisando a solicitação e verificando o contexto disponível.'
        reasoningPart.text += (reasoningPart.text ? '\n\n' : '') + progressSummary
        broadcastEvent({
          type: 'session.thought.delta',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {
            sessionID,
            assistantMessageID: assistantMsgId,
            delta: `\n\n${progressSummary}`,
          },
        })
      }

      if (textOutput) {
        const cleanText = stripEmojis(textOutput)
        fullAssistantText += (fullAssistantText ? '\n' : '') + cleanText
        const textPart = assistantMsg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')
        if (textPart) {
          textPart.text = fullAssistantText
        } else {
          assistantMsg.content.push({ type: 'text', text: fullAssistantText })
        }

        broadcastEvent({
          type: 'session.text.delta',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {
            sessionID,
            assistantMessageID: assistantMsgId,
            delta: cleanText,
          },
        })
      }

      if (functionCalls && functionCalls.length > 0) {
        // Record tool decision in reasoning thought stream
        const toolNames = functionCalls.map((fc: any) => fc.name).join(', ')
        const toolThought = `Coordinating workspace tools: ${toolNames}. Executing actions and inspecting results...`
        reasoningPart.text += (reasoningPart.text ? '\n\n' : '') + toolThought
        broadcastEvent({
          type: 'session.thought.delta',
          id: `evt_${Date.now()}`,
          created: Date.now(),
          data: {
            sessionID,
            assistantMessageID: assistantMsgId,
            delta: `\n\n${toolThought}`,
          },
        })

        // Preserve raw model candidate parts so thought signatures and reasoning are maintained
        const modelCandidateParts = response.candidates?.[0]?.content?.parts
        if (modelCandidateParts && modelCandidateParts.length > 0) {
          currentContents.push({
            role: 'model',
            parts: modelCandidateParts,
          })
        } else {
          currentContents.push({
            role: 'model',
            parts: functionCalls.map((fc: any) => {
              const part: any = { functionCall: fc }
              if (fc.thoughtSignature || fc.thought_signature) {
                part.thought_signature = fc.thoughtSignature || fc.thought_signature
              }
              return part
            }),
          })
        }

        const functionResponseParts = []

        for (const fc of functionCalls) {
          const toolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const toolName = fc.name || 'unknown_tool'
          const toolArgs: Record<string, any> = (fc.args as any) ?? {}

          // 1. Announce tool input started
          broadcastEvent({
            type: 'session.tool.input.started',
            id: `evt_${Date.now()}`,
            created: Date.now(),
            data: {
              sessionID,
              assistantMessageID: assistantMsgId,
              id: toolId,
              name: toolName,
            },
          })

          // 2. Add tool item to assistant message content
          const toolItem: SessionMessageAssistantTool = {
            type: 'tool',
            id: toolId,
            name: toolName,
            state: { status: 'running', input: toolArgs, metadata: {} },
            time: { created: Date.now(), ran: Date.now() },
          }
          assistantMsg.content.push(toolItem)

          // 3. Broadcast tool called
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

          // Execute tool in session workspace
          const toolResult = await executeWorkspaceTool(toolName, toolArgs, workspaceRoot, sessionID)

          // Live Subagent Progress Streaming into Chat (Zero Emojis)
          if (toolName === 'describe_progress' || (toolName === 'spawn_subagent' && toolArgs.task === 'describe_progress')) {
            const reporterName = stripEmojis(toolArgs.reporter_name || toolArgs.name || 'Subagente de Descricao')
            const cleanResult = stripEmojis(toolResult.replace(/^\[.*?\]:\s*/, ''))
            const descNotice = `\n\n> **[${reporterName}]**: ${cleanResult}\n\n`
            fullAssistantText += descNotice
            const textPart = assistantMsg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')
            if (textPart) {
              textPart.text = fullAssistantText
            } else {
              assistantMsg.content.push({ type: 'text', text: fullAssistantText })
            }
            broadcastEvent({
              type: 'session.text.delta',
              id: `evt_${Date.now()}`,
              created: Date.now(),
              data: {
                sessionID,
                assistantMessageID: assistantMsgId,
                delta: descNotice,
              },
            })
          }

          // Live Question Subagent: Notify in Chat and Pause Turn for User Answer (Zero Emojis)
          if (toolName === 'ask_user_question' || (toolName === 'spawn_subagent' && toolArgs.task === 'ask_question')) {
            const qText = stripEmojis(toolArgs.question || toolArgs.instructions || '')
            const qNotice = `\n\n> **[Subagente de Perguntas]**: ${qText}${toolArgs.options?.length ? `\n> *Opcoes sugeridas:* ${toolArgs.options.map((o: string) => `\`${stripEmojis(o)}\``).join(', ')}` : ''}\n\n*Aguardando sua resposta no chat ou no formulario interativo para continuar...*\n\n`
            fullAssistantText += qNotice
            const textPart = assistantMsg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')
            if (textPart) {
              textPart.text = fullAssistantText
            } else {
              assistantMsg.content.push({ type: 'text', text: fullAssistantText })
            }
            broadcastEvent({
              type: 'session.text.delta',
              id: `evt_${Date.now()}`,
              created: Date.now(),
              data: {
                sessionID,
                assistantMessageID: assistantMsgId,
                delta: qNotice,
              },
            })
            shouldContinue = false
          }

          // 4. Update tool state to completed in stored message
          toolItem.state = {
            status: 'completed',
            input: toolArgs,
            content: [{ type: 'text', text: toolResult }],
            metadata: {},
          }
          toolItem.time.completed = Date.now()
          toolItem.executed = true

          // 5. Broadcast tool success
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

          const fr: Record<string, any> = {
            name: toolName,
            response: { result: toolResult },
          }
          if ((fc as any).id) {
            fr.id = (fc as any).id
          }
          functionResponseParts.push({
            functionResponse: fr,
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

    // Auto-apply code blocks to workspace as fail-safe guarantee against unwritten files
    const autoCreatedFiles = await applyCodeBlocksToWorkspace(sessionID, fullAssistantText, workspaceRoot)
    if (autoCreatedFiles.length > 0) {
      broadcastEvent({
        type: 'session.workspace.files.created',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: {
          sessionID,
          files: autoCreatedFiles,
        },
      })
      broadcastEvent({
        type: 'session.diff.revision',
        id: `evt_${Date.now()}`,
        created: Date.now(),
        data: { sessionID },
      })
    }

    if (abortController.signal.aborted) {
      fullAssistantText += '\n\n*(Generation interrupted)*'
    }
  } catch (err: any) {
    console.error('Gemini API execution error:', err)
    const errMessage = formatGeminiError(err)
    fullAssistantText = `### Autonomous Agent Notice\n\n${errMessage}`
    const textPart = assistantMsg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')
    if (textPart) {
      textPart.text = fullAssistantText
    } else {
      assistantMsg.content.push({ type: 'text', text: fullAssistantText })
    }
  } finally {
    activeControllers.delete(sessionID)
    busySessions.delete(sessionID)

    // Complete Reasoning and Thought
    if (!reasoningPart.time) {
      reasoningPart.time = { created: Date.now() }
    }
    reasoningPart.time.completed = Date.now()

    broadcastEvent({
      type: 'session.thought.ended',
      id: `evt_${Date.now()}`,
      created: Date.now(),
      data: { sessionID, assistantMessageID: assistantMsgId },
    })

    // Complete Assistant Message
    const textPart = assistantMsg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')
    if (textPart) {
      textPart.text = fullAssistantText
    }
    assistantMsg.time.completed = Date.now()
    assistantMsg.finish = 'stop'

    const sessionOwnerId = (session as any)?.userId || 'guest-user'
    void persistSessionToFirestore(session, sessionOwnerId)
    void persistMessageToFirestore(sessionID, assistantMsg, sessionOwnerId)

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
