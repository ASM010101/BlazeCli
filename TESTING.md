# 🧪 Blaze CLI — Complete Testing Guide

## Quick Test

```bash
# Run all 250 automated tests
npx tsx tests/regression.ts     # 84 tests — config, tools, agent, UI, edge cases
npx tsx tests/integration.ts    # 166 tests — all systems end-to-end
```

---

## What's Tested

### Regression Suite (84 tests)
| Section | Tests | What's covered |
|---------|-------|---------------|
| Config & Types | 4 | getConfig, .blazerc, env vars, defaults |
| Cost Estimation | 7 | Model pricing, free models, token calc |
| System Prompt | 6 | CWD injection, tools list, git context, BLAZE.md |
| Tool Registry | 6 | 14 tools, plan mode filtering, findTool |
| BashTool | 6 | Commands, stderr, CWD, safety guards |
| FileReadTool | 5 | Full read, line ranges, missing file |
| FileWriteTool | 4 | Create, overwrite, deep dirs |
| FileEditTool | 6 | Replace, replaceAll, multi-line |
| GrepTool | 3 | Patterns, no match, empty |
| GlobTool | 4 | Patterns, nested, no match |
| ListDirTool | 4 | Contents, icons, recursive |
| WebFetchTool | 3 | Empty URL, invalid URL, properties |
| LLM Client | 2 | Constructor, API key |
| Agent | 8 | Constructor, reset, CWD, save/load, compact |
| UI Module | 10 | Colors, spinner, stats, banner |
| Edge Cases | 5 | Unicode, large files, roundtrips |

### Integration Suite (166 tests)
| Section | Tests | What's covered |
|---------|-------|---------------|
| All 14 Tools | 24 | Every tool direct execution |
| Tool Registry | 7 | 14 tools, plan mode, READ_ONLY_TOOLS |
| Memory System | 9 | Save, load, list, index, frontmatter |
| Hooks System | 4 | Pre/post tool, matching, session hooks |
| Permissions | 6 | Allow, deny, patterns, priority |
| Agent | 17 | Plan mode, branching, save/load, compact |
| System Prompt | 4 | CWD, 14 tools, rules, plan mode |
| UI Module | 8 | New colors, context grid, plan display |
| Config | 7 | Memory, hooks, permissions, providers |
| Advanced Features | 20 | AskUser, interrupt, checkpoints, failover, switchProvider |
| NotebookEdit | 11 | Read, insert, replace, delete, errors |
| Skills System | 7 | Load, find, frontmatter parsing |
| REPL Tool | 5 | Python, Node, errors, empty code |
| Worktree Tool | 4 | Name, permissions, non-git error |
| Tasks & Cron | 10 | List, clean, parseInterval, formatInterval |
| Agent Teams | 18 | Create, add workers, tasks, messages, status, destroy |

---

## Live Testing Checklist

### Tools via LLM
```bash
# Test each tool with a real model
blaze --yes "list files in this directory"                    # ListDir
blaze --yes "read the first 5 lines of package.json"          # FileRead
blaze --yes "search for 'export class' in src/"               # Grep
blaze --yes "find all .ts files in src/"                      # Glob
blaze --yes "run node --version"                              # Bash
blaze --yes "use REPL to compute 2**10 in python"             # REPL
blaze --yes "search the web for TypeScript"                   # WebSearch
blaze --yes "fetch https://httpbin.org/get"                   # WebFetch
blaze --yes "use SubAgent to count files in tests/"           # SubAgent
```

### REPL Commands
```bash
blaze          # Then type each command:
/help          # Shows all 50+ commands
/status        # Messages, tokens, model, plan mode, memory
/context       # Visual context bar
/model         # Model info
/tools         # All 14 tools
/plan          # Toggle plan mode
/plan off      # Back to execution
/theme ocean   # Switch theme
/theme         # Show all themes
/fast          # Toggle fast mode
/switch        # Show all 26 models
/doctor        # Health check
/stats         # Usage across sessions
/memory        # Memory status
/skills        # Custom skills
/branch        # Save branch point
/rewind        # Show checkpoints
/export test.md # Export conversation
/copy          # Copy last response
/diff          # Git diff
/tag myproject # Tag session
/resume        # Resume last session
/sessions      # List all sessions
```

### Agent Teams
```bash
blaze
/team create
/team add alice Frontend specialist
/team add bob Backend specialist
/team task alice Build the login page
/team task bob Create the auth API
/team msg alice bob What auth format?
/team status
/team run
/team destroy
```

### Failover
```bash
# Use a model that will rate-limit, then pick another
blaze
# When rate limit hits: pick from 26 available models
```

### Safety Guards
```bash
blaze --yes "run Stop-Process -Name node -Force"
# Should see: BLOCKED for safety
```

### Soft Interrupt
```bash
blaze
> analyze this entire codebase in detail
# Press Ctrl+C once → stops agent, keeps REPL
# Press Ctrl+C twice → saves session and exits
```

---

## Running from Other Projects

```bash
cd ~/my-project
blaze                    # Uses models from ~/.blazerc
blaze --resume           # Resumes project-specific session
/switch                  # Shows all providers (keys from ~/.blaze/.env)
```

The `.env` from both your project AND `~/.blaze/.env` are loaded. Provider-specific keys are auto-matched to URLs.
