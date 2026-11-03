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
} from './icons'
import styles from './SessionStudioPanel.module.css'

export type StudioTab = 'preview' | 'files' | 'steps' | 'diff'

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

  // Auto-reload preview and files when turn finishes
  React.useEffect(() => {
    if (!isBusy) {
      setRefreshKey((k) => k + 1)
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
          >
            <EyeIcon size={14} />
            <span>Preview</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'files' ? styles.tabActive : ''}`}
            onClick={() => onTabChange('files')}
            role="tab"
            aria-selected={activeTab === 'files'}
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

        {/* --- 2. Files & Code Viewer Tab --- */}
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

        {/* --- 3. Steps Preview Tab --- */}
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

        {/* --- 4. Changes / Diff Tab --- */}
        {activeTab === 'diff' && (
          <SessionDiffPanel diff={diff} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

export default SessionStudioPanel
