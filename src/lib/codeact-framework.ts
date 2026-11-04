/**
 * CodeAct Framework (Code as Action)
 * Controls the action environment: allows the AI agent to write and execute
 * Python scripts and Shell/Bash commands in an isolated workspace sandbox
 * to interact with tools, libraries, APIs, and the filesystem.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface CodeActAction {
  id: string
  sessionId: string
  type: 'python' | 'bash' | 'tool_call'
  code: string
  status: 'pending' | 'running' | 'success' | 'failed'
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timestamp: number
  artifacts?: string[]
}

const sessionActionHistory = new Map<string, CodeActAction[]>()

export function getCodeActHistory(sessionId: string): CodeActAction[] {
  return sessionActionHistory.get(sessionId) || []
}

export function recordCodeActAction(sessionId: string, action: CodeActAction) {
  if (!sessionActionHistory.has(sessionId)) {
    sessionActionHistory.set(sessionId, [])
  }
  const history = sessionActionHistory.get(sessionId)!
  history.unshift(action)
  if (history.length > 100) history.pop()
}

/**
 * CodeAct Execution Sandbox
 */
export class CodeActSandbox {
  private workspaceDir: string
  private sessionId: string

  constructor(sessionId: string, workspaceDir: string) {
    this.sessionId = sessionId
    this.workspaceDir = workspaceDir
  }

  /**
   * Execute Python code in the session's isolated environment
   */
  async executePython(code: string, timeoutMs = 30_000): Promise<CodeActAction> {
    const actionId = `act_py_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const startTime = Date.now()

    await fs.mkdir(this.workspaceDir, { recursive: true })

    // Create a temporary script file inside the session workspace
    const scriptFileName = `_codeact_${actionId}.py`
    const scriptPath = path.join(this.workspaceDir, scriptFileName)

    const action: CodeActAction = {
      id: actionId,
      sessionId: this.sessionId,
      type: 'python',
      code,
      status: 'running',
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
      timestamp: startTime,
      artifacts: [],
    }

    try {
      await fs.writeFile(scriptPath, code, 'utf-8')

      // Record files in workspace before execution
      const beforeFiles = new Set(await fs.readdir(this.workspaceDir).catch(() => []))

      // Execute with real Python 3 runtime
      const { stdout, stderr } = await execAsync(`python3 "${scriptFileName}"`, {
        cwd: this.workspaceDir,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          SESSION_ID: this.sessionId,
          WORKSPACE_DIR: this.workspaceDir,
        },
      })

      // Clean up temporary runner script
      await fs.unlink(scriptPath).catch(() => {})

      // Detect any created files/artifacts
      const afterFiles = await fs.readdir(this.workspaceDir).catch(() => [])
      const newArtifacts = afterFiles.filter((f) => !beforeFiles.has(f) && f !== scriptFileName)

      action.status = 'success'
      action.stdout = stdout || ''
      action.stderr = stderr || ''
      action.exitCode = 0
      action.durationMs = Date.now() - startTime
      action.artifacts = newArtifacts
    } catch (err: any) {
      await fs.unlink(scriptPath).catch(() => {})
      action.status = 'failed'
      action.stdout = err.stdout || ''
      action.stderr = err.stderr || err.message || String(err)
      action.exitCode = err.code ?? 1
      action.durationMs = Date.now() - startTime
    }

    recordCodeActAction(this.sessionId, action)
    return action
  }

  /**
   * Execute Bash / Shell script in the session's isolated environment
   */
  async executeBash(command: string, timeoutMs = 30_000): Promise<CodeActAction> {
    const actionId = `act_sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const startTime = Date.now()

    await fs.mkdir(this.workspaceDir, { recursive: true })

    const action: CodeActAction = {
      id: actionId,
      sessionId: this.sessionId,
      type: 'bash',
      code: command,
      status: 'running',
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
      timestamp: startTime,
      artifacts: [],
    }

    try {
      const beforeFiles = new Set(await fs.readdir(this.workspaceDir).catch(() => []))

      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workspaceDir,
        timeout: timeoutMs,
        shell: '/bin/bash',
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          SESSION_ID: this.sessionId,
          WORKSPACE_DIR: this.workspaceDir,
        },
      })

      const afterFiles = await fs.readdir(this.workspaceDir).catch(() => [])
      const newArtifacts = afterFiles.filter((f) => !beforeFiles.has(f))

      action.status = 'success'
      action.stdout = stdout || ''
      action.stderr = stderr || ''
      action.exitCode = 0
      action.durationMs = Date.now() - startTime
      action.artifacts = newArtifacts
    } catch (err: any) {
      action.status = 'failed'
      action.stdout = err.stdout || ''
      action.stderr = err.stderr || err.message || String(err)
      action.exitCode = err.code ?? 1
      action.durationMs = Date.now() - startTime
    }

    recordCodeActAction(this.sessionId, action)
    return action
  }
}
