# 🔥 Blaze CLI

**Open-source agentic AI coding platform for the terminal.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/ASM010101/BlazeCli/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

Blaze CLI is a free, self-hosted agentic coding assistant that works with **any** OpenAI-compatible LLM provider — Ollama, NVIDIA NIM, Groq, OpenRouter, Together AI, and more. It ships with 17 tools, 60+ commands, agent teams, deep planning, and multi-provider failover.

**Your code. Your models. Your rules.**

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.com/) (for local/cloud models)

### Install

```bash
git clone https://github.com/ASM010101/BlazeCli.git
cd BlazeCli && npm install
npm run build
npm install -g .
```

### Run

```bash
blaze                          # Interactive REPL
blaze "your task"              # Single-shot mode
blaze --yes "fix the bug"      # Auto-approve all tools
blaze --plan "analyze this"    # Read-only plan mode
blaze --ci "run tests"         # Headless CI/CD mode (JSON output)
blaze --resume                 # Resume last session
```

### Setup Models

```bash
# Ollama cloud models (free)
ollama pull qwen3.5:cloud
ollama pull deepseek-v3.2:cloud
ollama pull gemini-3-flash-preview:cloud

# Start Ollama
ollama serve
```

### Add API Keys (optional)

Create `~/.blaze/.env`:
```env
NVIDIA_API_KEY=nvapi-your-key-here
OPENROUTER_API_KEY=sk-or-v1-your-key-here
GROQ_API_KEY=gsk_your-key-here
```

---

## Key Features

### 🔀 Multi-Provider Failover
Rate limited? Blaze auto-detects available providers and switches instantly. It scans Ollama models, environment keys (NVIDIA, Groq, OpenRouter), and `.blazerc` providers — so you're never stuck.

### 🤝 Agent Teams
Spawn multiple specialized agents that work in parallel with message passing:
```
/team create
/team add frontend React specialist
/team add backend API specialist
/team run
```

### 🔥 Blazeplan — Deep Multi-Agent Planning
3 parallel research agents + 1 critique agent produce comprehensive plans. Terminal stays free while agents work in the background.
```
/blazeplan migrate auth from sessions to JWTs
/blazeplan refactor the payment module for multi-currency
```

### 🌐 Browser Automation
Navigate, click, type, screenshot, extract text, and run JavaScript in a real browser. Powered by Playwright.

### 🛡️ Security Scanner
Instant OWASP Top 10 scanning — SQL injection, XSS, hardcoded secrets, command injection — detected in zero seconds, no LLM needed.

### 💰 Budget Tracking
Real-time cost tracking per response, session, day, and project. Know exactly what you're spending.

### 🔄 Pipelines
Declarative multi-step workflows from markdown files. Automate complex sequences effortlessly.

### 🔌 Plugin Registry
10 built-in plugins for git, Docker, testing, docs, API building, databases, security, and more.
```
/plugins                      # Browse registry
/plugins install git-flow     # Install a plugin
```

### 🧠 Auto-Memory
Persistent memory across sessions — global and per-project. Blaze remembers your conventions and preferences.

---

## 17 Built-In Tools

| Tool | Permission | Description |
|------|:----------:|-------------|
| **Bash** | ⚠️ | Shell commands with 35+ safety guards |
| **FileRead** | ✅ | Read files with line ranges |
| **FileWrite** | ⚠️ | Create/overwrite files |
| **FileEdit** | ⚠️ | Find-and-replace editing |
| **Grep** | ✅ | Regex search across files |
| **Glob** | ✅ | File pattern matching |
| **ListDir** | ✅ | Directory listing with sizes |
| **WebFetch** | ✅ | Fetch URL content |
| **WebSearch** | ✅ | DuckDuckGo web search |
| **ResearchAgent** | ✅ | Spawn isolated research agents |
| **AskUser** | ✅ | Ask user questions mid-flow |
| **NotebookEdit** | ⚠️ | Edit Jupyter .ipynb cells |
| **Worktree** | ⚠️ | Git worktree isolation |
| **REPL** | ⚠️ | Execute Python/Node.js code |
| **Browser** | ⚠️ | Playwright browser automation |
| **Screenshot** | ✅ | Native OS screenshots |
| **ImageGen** | ⚠️ | Image generation via API |

---

## REPL Commands

### Session
| Command | Description |
|---------|-------------|
| `/clear` | Reset conversation |
| `/compact` | Compress conversation to save tokens |
| `/save` | Save conversation to disk |
| `/load [id]` | Load a previous conversation |
| `/resume` | Resume last session for this project |
| `/sessions` | List saved conversations |
| `/branch` | Fork conversation |
| `/restore [n]` | Restore to a branch point |
| `/rewind [n]` | Rewind to a checkpoint |
| `/export [file]` | Export conversation to markdown |

### Features
| Command | Description |
|---------|-------------|
| `/plan [on\|off]` | Toggle plan mode (read-only) |
| `/blazeplan <task>` | Deep multi-agent planning |
| `/up` | List blazeplan tasks |
| `/memory` | Show auto-memory status |
| `/init` | Generate BLAZE.md for project |
| `/diff` | Show git diff |
| `/commit [msg]` | Create a git commit |
| `/review` | Security & code quality review |
| `/powerup` | Interactive tutorials |
| `/plugins` | Browse plugin registry |

### Teams & Background
| Command | Description |
|---------|-------------|
| `/team create` | Create agent team |
| `/team add <name> <role>` | Add a worker |
| `/team run` | Run all workers in parallel |
| `/run <prompt>` | Run task in background |
| `/loop <interval> <prompt>` | Recurring task (5m, 1h) |
| `/tasks` | List background tasks |

### Config
| Command | Description |
|---------|-------------|
| `/switch` | Switch model/provider |
| `/model` | Show current model info |
| `/tools` | List available tools |
| `/status` | Show session stats |
| `/theme [name]` | Switch color theme |
| `/doctor` | Check Blaze CLI health |

---

## Models

### Ollama Cloud (Free)
| Model | Parameters | Context |
|-------|:----------:|:-------:|
| qwen3.5:cloud | 397B | 262K |
| deepseek-v3.2:cloud | 671B | 164K |
| gemini-3-flash-preview:cloud | — | **1M** |
| kimi-k2.5:cloud | 1T | 262K |
| nemotron-3-super:cloud | 120B | 262K |
| qwen3-coder-next:cloud | 80B | 262K |
| glm-5:cloud | 756B | 203K |
| minimax-m2.7:cloud | 230B | 205K |

### NVIDIA NIM (Free Tier)
| Model | Parameters |
|-------|:----------:|
| qwen/qwen3.5-397b-a17b | 397B |
| qwen/qwen3-coder-480b | 480B |
| deepseek-ai/deepseek-v3.2 | 671B |
| minimaxai/minimax-m2.7 | 230B |
| meta/llama-3.3-70b-instruct | 70B |

### OpenRouter
| Model | Cost |
|-------|:----:|
| qwen/qwen3.6-plus:free | Free |
| deepseek/deepseek-v3.2 | Paid |
| + 350 more models | Varies |

Switch anytime with `/switch`. If a provider rate-limits you, failover auto-detects alternatives.

---

## Configuration

### .blazerc

Create `~/.blazerc` (global) or `.blazerc` (project):

```json
{
  "llmUrl": "http://localhost:11434",
  "llmModel": "qwen3.5:cloud",
  "maxTokens": 8192,
  "temperature": 0,
  "memoryEnabled": true,
  "providers": [
    {
      "name": "NVIDIA: Qwen3.5",
      "url": "https://integrate.api.nvidia.com/v1",
      "model": "qwen/qwen3.5-397b-a17b"
    }
  ],
  "hooks": {},
  "permissions": { "allow": [], "deny": [] }
}
```

### BLAZE.md

Create `BLAZE.md` in your project root to give Blaze context:
```markdown
# My Project
Next.js 15 app with App Router, Prisma, Tailwind.
- Use TypeScript strict mode
- Run tests with: npm test
- Database: PostgreSQL via Supabase
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BLAZE_LLM_URL` | `http://localhost:11434` | LLM API endpoint |
| `BLAZE_LLM_MODEL` | `qwen3.5:cloud` | Model name |
| `BLAZE_LLM_API_KEY` | — | API key |
| `BLAZE_AUTO_APPROVE` | `false` | Auto-approve all tools |
| `NVIDIA_API_KEY` | — | NVIDIA NIM key |
| `OPENROUTER_API_KEY` | — | OpenRouter key |
| `GROQ_API_KEY` | — | Groq key |

---

## Architecture

```
src/
├── index.ts           ← REPL + CLI flags + 60+ commands
├── agent.ts           ← Agentic loop + parallel tools + checkpoints
├── llm.ts             ← OpenAI-compatible streaming client
├── prompt.ts          ← System prompt + BLAZE.md + memory
├── types.ts           ← Config + .blazerc + cost estimation
├── ui.ts              ← Terminal UI (colors, spinner, themes)
├── memory.ts          ← Auto-memory (global + project)
├── hooks.ts           ← Pre/post tool event hooks
├── permissions.ts     ← Pattern-based allow/deny rules
├── failover.ts        ← Multi-provider detection + switching
├── skills.ts          ← Custom /commands from .blaze/skills/
├── tasks.ts           ← Background task execution
├── blazeplan.ts       ← Deep multi-agent planning
├── cron.ts            ← Recurring task scheduling
├── team.ts            ← Agent teams with messaging
├── context.ts         ← Smart context engine
├── review.ts          ← Security scanner
├── git-intel.ts       ← Git intelligence
├── budget.ts          ← Cost tracking
├── pipeline.ts        ← Declarative workflows
├── autofix.ts         ← Error classification + fixes
├── voice.ts           ← Voice I/O
├── mcp.ts             ← MCP server protocol
├── plugins.ts         ← Plugin registry
├── powerup.ts         ← Interactive tutorials
└── tools/
    ├── index.ts           ← Tool registry (17 tools)
    ├── BashTool.ts        ← Shell execution + 35+ safety guards
    ├── FileReadTool.ts
    ├── FileWriteTool.ts
    ├── FileEditTool.ts
    ├── GrepTool.ts
    ├── GlobTool.ts
    ├── ListDirTool.ts
    ├── WebFetchTool.ts
    ├── WebSearchTool.ts
    ├── ResearchAgentTool.ts
    ├── AskUserTool.ts
    ├── NotebookEditTool.ts
    ├── WorktreeTool.ts
    ├── REPLTool.ts
    ├── BrowserTool.ts     ← Playwright browser automation
    ├── ScreenshotTool.ts  ← Native OS screenshots
    └── ImageGenTool.ts    ← Image generation via API
```

---

## Testing

```bash
npx tsx tests/regression.ts     # 84 tests
npx tsx tests/integration.ts    # 166 tests
```

---

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## License

[MIT](LICENSE) — © 2026 Ashish (ASM010101)
