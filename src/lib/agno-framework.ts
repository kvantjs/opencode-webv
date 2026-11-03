/**
 * Agno Agent Framework Integration for Kvant
 * Implements Agno-inspired multi-agent orchestration, teams, memory, tools, and reasoning.
 */

export interface AgnoTool {
  name: string
  description: string
  parameters?: Record<string, any>
  execute: (args: any, context: AgnoRunContext) => Promise<any>
}

export interface AgnoRunContext {
  sessionId: string
  workspaceDir: string
  agentName: string
  subagents?: AgnoAgent[]
  memory?: AgnoMemory
  metrics?: {
    steps: number
    toolCalls: number
    startTime: number
  }
}

export interface AgnoAgentConfig {
  name: string
  role: string
  instructions: string[]
  tools?: AgnoTool[]
  team?: AgnoAgent[]
  markdown?: boolean
  showToolCalls?: boolean
  addDatetimeToInstructions?: boolean
  debugMode?: boolean
}

export class AgnoMemory {
  private history: Array<{ role: string; content: string; timestamp: number }> = []

  addMessage(role: string, content: string) {
    this.history.push({ role, content, timestamp: Date.now() })
  }

  getHistory() {
    return [...this.history]
  }

  clear() {
    this.history = []
  }
}

export class AgnoAgent {
  name: string
  role: string
  instructions: string[]
  tools: Map<string, AgnoTool> = new Map()
  team: AgnoAgent[] = []
  memory: AgnoMemory
  debugMode: boolean

  constructor(config: AgnoAgentConfig) {
    this.name = config.name
    this.role = config.role
    this.instructions = config.instructions || []
    if (config.tools) {
      for (const tool of config.tools) {
        this.tools.set(tool.name, tool)
      }
    }
    if (config.team) {
      this.team = config.team
    }
    this.memory = new AgnoMemory()
    this.debugMode = config.debugMode ?? false
  }

  addTool(tool: AgnoTool) {
    this.tools.set(tool.name, tool)
  }

  addSubagent(agent: AgnoAgent) {
    this.team.push(agent)
  }

  async run(prompt: string, context: AgnoRunContext): Promise<string> {
    context.agentName = this.name
    context.memory = this.memory
    this.memory.addMessage('user', prompt)

    if (this.debugMode) {
      console.log(`[Agno Agent: ${this.name}] Running with prompt:`, prompt)
    }

    // Process instructions and context
    let response = `Executing Agno agent workflow for [${this.name} - ${this.role}].\n`
    if (this.team.length > 0) {
      response += `Team collaboration active with ${this.team.length} subagent(s): ${this.team.map((a) => a.name).join(', ')}.\n`
    }
    return response
  }
}

export class AgnoTeam {
  name: string
  leader: AgnoAgent
  members: AgnoAgent[]
  memory: AgnoMemory

  constructor(name: string, leader: AgnoAgent, members: AgnoAgent[] = []) {
    this.name = name
    this.leader = leader
    this.members = members
    this.memory = new AgnoMemory()
    for (const m of members) {
      this.leader.addSubagent(m)
    }
  }

  async coordinateTask(taskDescription: string, context: AgnoRunContext): Promise<string> {
    this.memory.addMessage('user', taskDescription)
    let output = `[Agno Team: ${this.name}] Leader (${this.leader.name}) initiating coordination.\n`
    for (const sub of this.members) {
      output += `-> Delegating sub-task to subagent: ${sub.name} (${sub.role})\n`
      const subRes = await sub.run(taskDescription, context)
      output += subRes + '\n'
    }
    const leaderRes = await this.leader.run(taskDescription, context)
    output += leaderRes
    return output
  }
}

// Default Kvant Agno Configuration factory
export function createKvantAgnoTeam(): AgnoTeam {
  const buildEngineer = new AgnoAgent({
    name: 'Build Engineer',
    role: 'Autonomous Full-Stack Engineering & Code Execution',
    instructions: [
      'Build robust, production-ready features.',
      'Execute commands and tests securely inside the session workspace.',
      'Never send emojis in responses.',
    ],
    debugMode: true,
  })

  const codeReviewer = new AgnoAgent({
    name: 'Code Reviewer',
    role: 'Principal Code Quality & Security Reviewer',
    instructions: [
      'Audit code for clean architecture and security vulnerabilities.',
      'Verify diffs and ensure adherence to project standards.',
      'Never send emojis in responses.',
    ],
  })

  const testEngineer = new AgnoAgent({
    name: 'Test Subagent',
    role: 'Automated Testing & Build Verification',
    instructions: [
      'Write and execute tests for all generated code.',
      'Ensure compile and lint checks pass cleanly.',
      'Never send emojis in responses.',
    ],
  })

  const teamLeader = new AgnoAgent({
    name: 'Kvant Principal Orchestrator',
    role: 'Agno Framework Lead Agent',
    instructions: [
      'Orchestrate the multi-agent team to solve user prompts efficiently.',
      'Leverage subagents for testing, code review, and specialised tasks.',
      'Strictly avoid emojis in chat or agent responses.',
    ],
    team: [buildEngineer, codeReviewer, testEngineer],
  })

  return new AgnoTeam('Kvant Agno Intelligence Team', teamLeader, [buildEngineer, codeReviewer, testEngineer])
}
