import * as React from 'react'
import type { SessionDiffController } from '~/lib/session-diff-client'
import SessionDiffPanel from './SessionDiffPanel'
import {
  EyeIcon,
  StepsIcon,
  FolderIcon,
  FileIcon,
  DiffIcon,
  XIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
  DesktopIcon,
  TabletIcon,
  SmartphoneIcon,
  CopyIcon,
  DownloadIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  TerminalIcon,
  NetworkIcon,
  PlayIcon,
  BrainIcon,
  SearchIcon,
  BotIcon,
} from './icons'
import styles from './SessionStudioPanel.module.css'

export type StudioTab = 'preview' | 'codeact' | 'agno' | 'files' | 'steps' | 'diff'

interface WorkspaceFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  extension: string
}

interface StepItem {
  id: string
  index: number
  type: 'user_prompt' | 'reasoning' | 'tool_execution' | 'response_delivery'
  title: string
  summary: string
  detail?: string
  tool?: string
  input?: any
  output?: string
  duration?: string
  time: number
  status: string
}

interface CodeActActionItem {
  id: string
  type: 'python' | 'bash'
  code: string
  status: 'pending' | 'running' | 'success' | 'failed'
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timestamp: number
  artifacts?: string[]
}

interface AgnoState {
  teamName: string
  leader: { id: string; name: string; role: string; instructions: string[] }
  members: Array<{ id: string; name: string; role: string; instructions: string[] }>
  facts: Record<string, string>
  history: Array<{ id: string; role: string; content: string; timestamp: number }>
  workflows: Array<{
    id: string
    name: string
    description: string
    status: string
    steps: Array<{ name: string; agentId: string; status: string; durationMs?: number }>
  }>
}

interface SessionStudioPanelProps {
  sessionId: string
  activeTab: StudioTab
  onTabChange: (tab: StudioTab) => void
  onClose: () => void
  diff: SessionDiffController
  isBusy?: boolean
}

export function SessionStudioPanel({
  sessionId,
  activeTab,
  onTabChange,
  onClose,
  diff,
  isBusy,
}: SessionStudioPanelProps) {
  // Preview State
  const [device, setDevice] = React.useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [refreshKey, setRefreshKey] = React.useState(0)

  // Files State
  const [files, setFiles] = React.useState<WorkspaceFile[]>([])
  const [filesLoading, setFilesLoading] = React.useState(false)
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
  const [fileContent, setFileContent] = React.useState<string>('')
  const [fileLoading, setFileLoading] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  // Steps State
  const [steps, setSteps] = React.useState<StepItem[]>([])
  const [stepsLoading, setStepsLoading] = React.useState(false)
  const [expandedSteps, setExpandedSteps] = React.useState<Set<string>>(new Set())

  // CodeAct State
  const [codeActLang, setCodeActLang] = React.useState<'python' | 'bash'>('python')
  const [codeActCode, setCodeActCode] = React.useState(
    `# CodeAct Python 3 Sandbox Action\nimport json, math, os\n\nprint("CodeAct Action Sandbox Initialized.")\nprint(f"Workspace directory files: {len(os.listdir('.'))}")\n`,
  )
  const [codeActRunning, setCodeActRunning] = React.useState(false)
  const [latestCodeActResult, setLatestCodeActResult] = React.useState<CodeActActionItem | null>(null)
  const [codeActHistory, setCodeActHistory] = React.useState<CodeActActionItem[]>([])
  const [showManualConsole, setShowManualConsole] = React.useState(false)

  // Agno State
  const [agnoState, setAgnoState] = React.useState<AgnoState | null>(null)
  const [agnoLoading, setAgnoLoading] = React.useState(false)
  const [ragQuery, setRagQuery] = React.useState('')
  const [ragResults, setRagResults] = React.useState<Array<{ id: string; source: string; content: string; score: number }>>([])
  const [ragSearching, setRagSearching] = React.useState(false)

  // Auto-reload preview and files when agent turn completes
  React.useEffect(() => {
    if (!isBusy) {
      setRefreshKey((k) => k + 1)
      void loadCodeActHistory()
      void loadAgnoState()
    }
  }, [isBusy])

  // Load files when Files tab is opened
  const loadFiles = React.useCallback(async () => {
    setFilesLoading(true)
    try {
      const res = await fetch(`/api/proxy/api/session/${encodeURIComponent(sessionId)}/workspace/tree`)
      if (res.ok) {
        const json = await res.json()
        const items: WorkspaceFile[] = json.data || []
        setFiles(items)
        if (!selectedFile && items.length > 0) {
          const firstFile = items.find((f) => f.type === 'file')
          if (firstFile) setSelectedFile(firstFile.path)
        }
      }
    } catch (err) {
      console.warn('Failed to load session files:', err)
    } finally {
      setFilesLoading(false)
    }
  }, [sessionId, selectedFile])

  React.useEffect(() => {
    if (activeTab === 'files') {
      void loadFiles()
    }
  }, [activeTab, loadFiles, refreshKey])

  // Load single file content
  React.useEffect(() => {
    if (!selectedFile) return
    let active = true
    setFileLoading(true)
    fetch(`/api/proxy/api/session/${encodeURIComponent(sessionId)}/workspace/file?path=${encodeURIComponent(selectedFile)}`)
      .then((r) => r.json())
      .then((data) => {
        if (active) {
          setFileContent(data.content ?? '')
        }
      })
      .catch(() => {
        if (active) setFileContent('// Error loading file content')
      })
      .finally(() => {
        if (active) setFileLoading(false)
      })

    return () => {
      active = false
    }
  }, [sessionId, selectedFile, refreshKey])

  // Load steps when Steps tab is opened
  const loadSteps = React.useCallback(async () => {
    setStepsLoading(true)
    try {
      const res = await fetch(`/api/proxy/api/session/${encodeURIComponent(sessionId)}/steps`)
      if (res.ok) {
        const json = await res.json()
        setSteps(json.data || [])
      }
    } catch (err) {
      console.warn('Failed to load session execution steps:', err)
    } finally {
      setStepsLoading(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (activeTab === 'steps') {
      void loadSteps()
    }
  }, [activeTab, loadSteps, isBusy])

  // CodeAct: load history
  const loadCodeActHistory = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/api/session/${encodeURIComponent(sessionId)}/codeact/history`)
      if (res.ok) {
        const json = await res.json()
        setCodeActHistory(json.data || [])
      }
    } catch {}
  }, [sessionId])

  React.useEffect(() => {
    if (activeTab === 'codeact') {
      void loadCodeActHistory()
    }
  }, [activeTab, loadCodeActHistory])

  // CodeAct: execute code interactively
  const runCodeActAction = async () => {
    if (!codeActCode.trim() || codeActRunning) return
    setCodeActRunning(true)
    try {
      const res = await fetch(`/api/proxy/api/session/${encodeURIComponent(sessionId)}/codeact/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: codeActLang,
          code: codeActCode,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        setLatestCodeActResult(json.data)
        void loadCodeActHistory()
        setRefreshKey((k) => k + 1)
      }
    } catch (err: any) {
      setLatestCodeActResult({
        id: `err_${Date.now()}`,
        type: codeActLang,
        code: codeActCode,
        status: 'failed',
        stdout: '',
        stderr: err.message || String(err),
        exitCode: 1,
        durationMs: 0,
        timestamp: Date.now(),
      })
    } finally {
      setCodeActRunning(false)
    }
  }

  // Agno: load state
  const loadAgnoState = React.useCallback(async () => {
    setAgnoLoading(true)
    try {
      const res = await fetch(`/api/proxy/api/session/${encodeURIComponent(sessionId)}/agno/state`)
      if (res.ok) {
        const json = await res.json()
        setAgnoState(json.data)
      }
    } catch {}
    finally {
      setAgnoLoading(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (activeTab === 'agno') {
      void loadAgnoState()
    }
  }, [activeTab, loadAgnoState])

  // Agno: run RAG search
  const handleRagSearch = async () => {
    if (!ragQuery.trim()) return
    setRagSearching(true)
    try {
      const res = await fetch(`/api/proxy/api/session/${encodeURIComponent(sessionId)}/agno/rag`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: ragQuery }),
      })
      if (res.ok) {
        const json = await res.json()
        setRagResults(json.data || [])
      }
    } catch {}
    finally {
      setRagSearching(false)
    }
  }

  const copyCode = () => {
    if (!fileContent) return
    void navigator.clipboard.writeText(fileContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadCode = () => {
    if (!fileContent || !selectedFile) return
    const blob = new Blob([fileContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedFile.split('/').pop() || 'file'
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleStep = (id: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const previewUrl = `/api/proxy/api/session/${encodeURIComponent(sessionId)}/preview/?t=${refreshKey}`
  const displayUrl = `/session/${sessionId.slice(0, 10)}/preview`
  const deviceWidth =
    device === 'mobile' ? '375px' : device === 'tablet' ? '768px' : '100%'

  return (
    <div className={styles.panel}>
      <header className={styles.panelHeader}>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'preview' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('preview')}
            role="tab"
            aria-selected={activeTab === 'preview'}
            title="Live Web Preview"
          >
            <EyeIcon size={14} />
            <span>Preview</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'codeact' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('codeact')}
            role="tab"
            aria-selected={activeTab === 'codeact'}
            title="CodeAct Sandbox: Python 3 & Bash Execution"
          >
            <TerminalIcon size={14} />
            <span>CodeAct</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'agno' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('agno')}
            role="tab"
            aria-selected={activeTab === 'agno'}
            title="Agno Ecosystem: Multi-Agent Teams, Memory & RAG"
          >
            <NetworkIcon size={14} />
            <span>Agno</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'files' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('files')}
            role="tab"
            aria-selected={activeTab === 'files'}
            title="Workspace Files & Source Code"
          >
            <FolderIcon size={14} />
            <span>Files</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'steps' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('steps')}
            role="tab"
            aria-selected={activeTab === 'steps'}
            title="Agent Execution Steps Timeline"
          >
            <StepsIcon size={14} />
            <span>Steps</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'diff' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('diff')}
            role="tab"
            aria-selected={activeTab === 'diff'}
            title="Workspace Changes (Diff)"
          >
            <DiffIcon size={14} />
            <span>Changes</span>
          </button>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close panel"
          >
            <XIcon size={16} />
          </button>
        </div>
      </header>

      <div className={styles.content}>
        {/* --- 1. Live Web Preview Tab --- */}
        {activeTab === 'preview' && (
          <div className={styles.previewWrap}>
            <div className={styles.previewToolbar}>
              <div className={styles.previewUrlBar}>
                <span>{displayUrl}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className={styles.deviceSelector}>
                  <button
                    type="button"
                    className={`${styles.deviceBtn} ${device === 'desktop' ? styles.deviceActive : ''}`}
                    onClick={() => setDevice('desktop')}
                    title="Desktop (100%)"
                  >
                    <DesktopIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.deviceBtn} ${device === 'tablet' ? styles.deviceActive : ''}`}
                    onClick={() => setDevice('tablet')}
                    title="Tablet (768px)"
                  >
                    <TabletIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.deviceBtn} ${device === 'mobile' ? styles.deviceActive : ''}`}
                    onClick={() => setDevice('mobile')}
                    title="Mobile (375px)"
                  >
                    <SmartphoneIcon size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.deviceBtn}
                  onClick={() => setRefreshKey((k) => k + 1)}
                  title="Reload preview"
                >
                  <RefreshCwIcon size={14} />
                </button>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.deviceBtn}
                  title="Open in new window"
                >
                  <ExternalLinkIcon size={14} />
                </a>
              </div>
            </div>
            <div className={styles.iframeContainer}>
              <iframe
                key={refreshKey}
                src={`${previewUrl}?t=${refreshKey}`}
                className={styles.previewIframe}
                style={{ width: deviceWidth }}
                title="Session Web Application Preview"
                sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
              />
            </div>
          </div>
        )}

        {/* --- 2. CodeAct Sandbox & Action Environment Tab (Operated by Agent) --- */}
        {activeTab === 'codeact' && (
          <div className={styles.codeactWrap}>
            <div className={styles.codeactHeader}>
              <div className={styles.codeactTitle}>
                <TerminalIcon size={16} />
                <span>Monitor de Ações CodeAct</span>
              </div>
              <div className={styles.codeactStatusPill}>
                <span className={styles.codeactPulse}></span>
                <span>Operado Autonomamente pelo Agente</span>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, padding: '0 2px' }}>
              Ambiente de ação do agente: scripts Python 3 e comandos Shell são gerados, executados no sandbox e autocorrigidos pelo próprio agente conforme necessário.
            </div>

            {/* Latest Execution Card */}
            {latestCodeActResult ? (
              <div className={styles.terminalOutput}>
                <div className={styles.terminalHeader}>
                  <span>Última Ação do Agente ({latestCodeActResult.type.toUpperCase()})</span>
                  <span>
                    Status: {latestCodeActResult.status} • {latestCodeActResult.durationMs}ms • Código: {latestCodeActResult.exitCode}
                  </span>
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--bg-raised)', borderBottom: '1px solid var(--border)', fontSize: 11.5, fontFamily: 'monospace' }}>
                  {latestCodeActResult.code}
                </div>
                <pre className={styles.terminalBody}>
                  {latestCodeActResult.stdout || '(Sem saída stdout)'}
                  {latestCodeActResult.stderr && (
                    <div className={styles.terminalError}>{latestCodeActResult.stderr}</div>
                  )}
                </pre>
                {latestCodeActResult.artifacts && latestCodeActResult.artifacts.length > 0 && (
                  <div className={styles.artifactsRow}>
                    <span>Artefatos Criados pelo Agente:</span>
                    {latestCodeActResult.artifacts.map((a) => (
                      <span key={a} className={styles.artifactBadge}>
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.agnoCard} style={{ textAlign: 'center', padding: '24px 16px' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                  Aguardando Ação Autônoma do Agente
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.5 }}>
                  O agente aciona o CodeAct de forma autônoma para escrever e executar códigos Python 3 e comandos Bash quando você solicitar cálculos, criação de arquivos, testes de API pública ou compilação.
                </div>
              </div>
            )}

            {/* Execution History */}
            {codeActHistory.length > 0 && (
              <div className={styles.agnoCard}>
                <div className={styles.agnoCardHeader}>
                  <h4 className={styles.agnoCardTitle}>
                    <TerminalIcon size={14} />
                    <span>Histórico de Execuções do Agente ({codeActHistory.length})</span>
                  </h4>
                </div>
                <div className={styles.workflowList}>
                  {codeActHistory.map((act) => (
                    <div key={act.id} className={styles.workflowStep}>
                      <span className={`${styles.stepDot} ${act.status === 'success' ? styles.stepDotDone : ''}`} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>
                          [{act.type.toUpperCase()}] {act.code.slice(0, 60)}{act.code.length > 60 ? '…' : ''}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Status: {act.status} • {act.durationMs}ms • {new Date(act.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optional Manual Developer Console Toggle */}
            <div style={{ marginTop: 'auto', paddingTop: 10 }}>
              <button
                type="button"
                onClick={() => setShowManualConsole(!showManualConsole)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 0',
                }}
              >
                <span>{showManualConsole ? '− Ocultar Console Manual' : '+ Console Manual de Suporte (Desenvolvedor)'}</span>
              </button>

              {showManualConsole && (
                <div className={styles.codeactBox} style={{ marginTop: 8 }}>
                  <div className={styles.codeactToolbar}>
                    <div className={styles.codeactLangSelector}>
                      <button
                        type="button"
                        className={`${styles.langBtn} ${codeActLang === 'python' ? styles.langBtnActive : ''}`}
                        onClick={() => setCodeActLang('python')}
                      >
                        Python 3
                      </button>
                      <button
                        type="button"
                        className={`${styles.langBtn} ${codeActLang === 'bash' ? styles.langBtnActive : ''}`}
                        onClick={() => setCodeActLang('bash')}
                      >
                        Bash / Shell
                      </button>
                    </div>

                    <select
                      className={styles.templateSelect}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === 'math') {
                          setCodeActLang('python')
                          setCodeActCode(`import json, math\n\ndata = {\n  "pi": math.pi,\n  "euler": math.e,\n  "primes": [2, 3, 5, 7, 11, 13, 17, 19, 23],\n  "sin_45": math.sin(math.radians(45))\n}\nprint(json.dumps(data, indent=2))\n`)
                        } else if (val === 'api') {
                          setCodeActLang('python')
                          setCodeActCode(`import urllib.request, json\n\nurl = "https://api.open-meteo.com/v1/forecast?latitude=-23.55&longitude=-46.63&current_weather=true"\nwith urllib.request.urlopen(url) as res:\n    data = json.loads(res.read().decode('utf-8'))\n    print(f"Weather in Sao Paulo: {data.get('current_weather', {}).get('temperature')}°C")\n`)
                        } else if (val === 'files') {
                          setCodeActLang('python')
                          setCodeActCode(`import os\n\nfiles = os.listdir('.')\nprint(f"Current workspace directory contains {len(files)} items:")\nfor f in sorted(files):\n    print(f" - {f}")\n`)
                        } else if (val === 'npm') {
                          setCodeActLang('bash')
                          setCodeActCode(`ls -la\nnode -v\npython3 --version\n`)
                        }
                      }}
                    >
                      <option value="">Templates Rápidos…</option>
                      <option value="math">Python: Cálculo Matemático & JSON</option>
                      <option value="api">Python: Teste de API Pública de Clima</option>
                      <option value="files">Python: Inspecionar Arquivos do Workspace</option>
                      <option value="npm">Bash: Verificação de Ferramentas do Sistema</option>
                    </select>
                  </div>

                  <textarea
                    className={styles.codeactEditor}
                    value={codeActCode}
                    onChange={(e) => setCodeActCode(e.target.value)}
                    placeholder="Digite código Python 3 ou comando Bash para teste..."
                    rows={5}
                    spellCheck={false}
                  />

                  <div className={styles.codeactActions}>
                    <button
                      type="button"
                      className={styles.runBtn}
                      onClick={runCodeActAction}
                      disabled={codeActRunning}
                    >
                      <PlayIcon size={14} />
                      <span>{codeActRunning ? 'Executando…' : 'Executar Teste'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- 3. Agno Multi-Agent Ecosystem Tab (Operated by Agent) --- */}
        {activeTab === 'agno' && (
          <div className={styles.agnoWrap}>
            <div className={styles.agnoCard}>
              <div className={styles.agnoCardHeader}>
                <h4 className={styles.agnoCardTitle}>
                  <NetworkIcon size={16} />
                  <span>Orquestração Autônoma Agno</span>
                </h4>
                <span className={styles.codeactStatusPill}>
                  <span className={styles.codeactPulse}></span>
                  <span>Decisão Automatizada</span>
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 4 }}>
                Coordenação neural interna do agente: alocação dinâmica de subagentes, síntese de memória persistente e busca RAG sobre os arquivos do projeto.
              </div>

              {agnoLoading ? (
                <div className={styles.emptyState}>Loading Agno ecosystem…</div>
              ) : (
                <div className={styles.agentGrid}>
                  {agnoState?.leader && (
                    <div className={styles.agentItem}>
                      <div className={styles.agentItemName}>{agnoState.leader.name} (Lead)</div>
                      <div className={styles.agentItemRole}>{agnoState.leader.role}</div>
                    </div>
                  )}
                  {agnoState?.members?.map((m) => (
                    <div key={m.id} className={styles.agentItem}>
                      <div className={styles.agentItemName}>{m.name}</div>
                      <div className={styles.agentItemRole}>{m.role}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Agno RAG Search */}
            <div className={styles.agnoCard}>
              <div className={styles.agnoCardHeader}>
                <h4 className={styles.agnoCardTitle}>
                  <SearchIcon size={14} />
                  <span>Agno RAG Knowledge Search</span>
                </h4>
              </div>
              <div className={styles.ragSearchRow}>
                <input
                  type="text"
                  className={styles.ragInput}
                  placeholder="Search codebase, schemas, and indexed context..."
                  value={ragQuery}
                  onChange={(e) => setRagQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRagSearch()
                  }}
                />
                <button
                  type="button"
                  className={styles.ragBtn}
                  onClick={handleRagSearch}
                  disabled={ragSearching}
                >
                  {ragSearching ? 'Searching…' : 'Query RAG'}
                </button>
              </div>

              {ragResults.length > 0 && (
                <div className={styles.ragResults}>
                  {ragResults.map((doc) => (
                    <div key={doc.id} className={styles.ragDoc}>
                      <div className={styles.ragDocTitle}>{doc.source}</div>
                      <div className={styles.ragDocSnippet}>{doc.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Agno Memory & Facts */}
            <div className={styles.agnoCard}>
              <div className={styles.agnoCardHeader}>
                <h4 className={styles.agnoCardTitle}>
                  <BrainIcon size={14} />
                  <span>Agno Persistent Memory & Context</span>
                </h4>
              </div>
              {agnoState?.facts && Object.keys(agnoState.facts).length > 0 ? (
                <div className={styles.workflowList}>
                  {Object.entries(agnoState.facts).map(([k, v]) => (
                    <div key={k} className={styles.workflowStep}>
                      <span className={styles.stepDotDone} style={{ width: 6, height: 6, borderRadius: '50%' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{k}:</span> {v}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                  Continuous session memory is actively recording architectural decisions and user facts.
                </p>
              )}
            </div>

            {/* Active Workflow Pipelines */}
            {agnoState?.workflows && agnoState.workflows.length > 0 && (
              <div className={styles.agnoCard}>
                <div className={styles.agnoCardHeader}>
                  <h4 className={styles.agnoCardTitle}>
                    <BotIcon size={14} />
                    <span>Agno Workflow Pipelines</span>
                  </h4>
                </div>
                {agnoState.workflows.map((wf) => (
                  <div key={wf.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 650 }}>{wf.name} ({wf.status})</div>
                    <div className={styles.workflowList}>
                      {wf.steps.map((st, i) => (
                        <div key={i} className={styles.workflowStep}>
                          <span className={`${styles.stepDot} ${st.status === 'completed' ? styles.stepDotDone : ''}`} />
                          <span style={{ flex: 1 }}>{st.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{st.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- 4. Files & Code Viewer Tab --- */}
        {activeTab === 'files' && (
          <div className={styles.filesWrap}>
            <div className={styles.fileTree}>
              <div className={styles.treeHeader}>
                <span>Workspace Files ({files.filter((f) => f.type === 'file').length})</span>
              </div>
              <ul className={styles.treeList}>
                {filesLoading && <li className={styles.emptyState}>Loading files…</li>}
                {!filesLoading && files.length === 0 && (
                  <li className={styles.emptyState}>No files in workspace yet.</li>
                )}
                {files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={`${styles.treeItem} ${selectedFile === file.path ? styles.treeItemActive : ''}`}
                      onClick={() => {
                        if (file.type === 'file') setSelectedFile(file.path)
                      }}
                    >
                      {file.type === 'directory' ? (
                        <FolderIcon size={14} />
                      ) : (
                        <FileIcon size={14} />
                      )}
                      <span>{file.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.codeViewer}>
              <div className={styles.codeHeader}>
                <span className={styles.filePath}>{selectedFile || 'Select a file'}</span>
                {selectedFile && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={copyCode}
                      title="Copy code"
                    >
                      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={downloadCode}
                      title="Download file"
                    >
                      <DownloadIcon size={14} />
                    </button>
                  </div>
                )}
              </div>
              {fileLoading ? (
                <div className={styles.emptyState}>Loading file…</div>
              ) : (
                <pre className={styles.codeContent}>{fileContent}</pre>
              )}
            </div>
          </div>
        )}

        {/* --- 5. Steps Preview Tab --- */}
        {activeTab === 'steps' && (
          <div className={styles.stepsWrap}>
            {stepsLoading && steps.length === 0 && (
              <div className={styles.emptyState}>Loading execution steps…</div>
            )}
            {!stepsLoading && steps.length === 0 && (
              <div className={styles.emptyState}>
                No execution steps yet. Ask the agent in chat to start.
              </div>
            )}
            {steps.map((step) => {
              const isOpen = expandedSteps.has(step.id)
              return (
                <div key={step.id} className={styles.stepCard}>
                  <div className={styles.stepHeader} onClick={() => toggleStep(step.id)}>
                    <div className={styles.stepNumber}>{step.index}</div>
                    <div className={styles.stepTitleWrap}>
                      <h4 className={styles.stepTitle}>{step.title}</h4>
                      <p className={styles.stepSummary}>{step.summary}</p>
                    </div>
                    <div className={styles.stepMeta}>
                      {step.duration && <span>{step.duration}</span>}
                      <span className={styles.stepStatus}>{step.status}</span>
                      {isOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                    </div>
                  </div>
                  {isOpen && (
                    <div className={styles.stepBody}>
                      {step.detail && (
                        <div className={styles.stepBlock}>
                          <div className={styles.stepBlockLabel}>Detail</div>
                          <pre className={styles.stepCode}>{step.detail}</pre>
                        </div>
                      )}
                      {step.input && (
                        <div className={styles.stepBlock}>
                          <div className={styles.stepBlockLabel}>Input Arguments</div>
                          <pre className={styles.stepCode}>
                            {typeof step.input === 'object'
                              ? JSON.stringify(step.input, null, 2)
                              : String(step.input)}
                          </pre>
                        </div>
                      )}
                      {step.output && (
                        <div className={styles.stepBlock}>
                          <div className={styles.stepBlockLabel}>Execution Output</div>
                          <pre className={styles.stepCode}>{step.output}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* --- 6. Changes / Diff Tab --- */}
        {activeTab === 'diff' && (
          <SessionDiffPanel diff={diff} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

export default SessionStudioPanel
