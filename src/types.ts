// ─── Message Types ───────────────────────────────────────────────
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// ─── Tool Definition ─────────────────────────────────────────────
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description: string; enum?: string[] }>
      required: string[]
    }
  }
}

// ─── Tool Interface ──────────────────────────────────────────────
export interface Tool {
  name: string
  description: string
  definition: ToolDefinition
  needsPermission: boolean
  execute(args: Record<string, unknown>, cwd: string): Promise<string>
}

// ─── Stream Events ───────────────────────────────────────────────
export interface StreamChunk {
  id: string
  choices: Array<{
    delta: {
      role?: string
      content?: string | null
      reasoning?: string | null  // Thinking models (Qwen3.5, DeepSeek R1, etc.)
      reasoning_content?: string | null  // Alternative field name
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: string | null
  }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface ChatResponse {
  id: string
  choices: Array<{
    message: {
      role: string
      content: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: ToolCall[]
    }
    finish_reason: string
  }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// ─── Config ──────────────────────────────────────────────────────
export interface BlazeConfig {
  llmUrl: string
  llmModel: string
  llmApiKey?: string
  maxTokens: number
  temperature: number
  autoApprove: boolean
  historyDir: string
  maxContextTokens: number
  compactThreshold: number
  // Memory, Hooks, Permissions
  memoryEnabled: boolean
  memoryDir: string
  hooks: {
    preToolUse?: Array<{ match?: string; command: string }>
    postToolUse?: Array<{ match?: string; command: string }>
    sessionStart?: Array<{ command: string }>
    sessionEnd?: Array<{ command: string }>
  }
  permissions: {
    allow?: string[]
    deny?: string[]
  }
  maxIterations: number
  planMode: boolean  // runtime state
  providers: Array<{ name?: string; url: string; model: string; apiKey?: string }>
}

// ─── .blazerc config file ────────────────────────────────────────
export interface BlazeRcConfig {
  llmUrl?: string
  llmModel?: string
  llmApiKey?: string
  maxTokens?: number
  temperature?: number
  autoApprove?: boolean
  maxContextTokens?: number
  compactThreshold?: number
  memoryEnabled?: boolean
  maxIterations?: number
  hooks?: {
    preToolUse?: Array<{ match?: string; command: string }>
    postToolUse?: Array<{ match?: string; command: string }>
    sessionStart?: Array<{ command: string }>
    sessionEnd?: Array<{ command: string }>
  }
  permissions?: {
    allow?: string[]
    deny?: string[]
  }
  providers?: Array<{ name?: string; url: string; model: string; apiKey?: string }>
}

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'

/**
 * Load .env file and inject into process.env.
 * Supports: KEY=value, KEY="value", KEY='value', # comments, empty lines.
 * Searches CWD then home directory. Does NOT override existing env vars.
 */
function loadDotEnv(): void {
  // Load ALL .env files — project first, then global Blaze config.
  // Both are loaded. Project .env takes priority (loaded first, won't override).
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(homedir(), '.blaze', '.env'),
  ]

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      try {
        const raw = readFileSync(envPath, 'utf-8')
        for (const line of raw.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx <= 0) continue

          const key = trimmed.slice(0, eqIdx).trim()
          let val = trimmed.slice(eqIdx + 1).trim()

          // Strip surrounding quotes
          if ((val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }

          // Don't override existing env vars
          if (!process.env[key]) {
            process.env[key] = val
          }
        }
      } catch {
        // Silently skip unreadable .env
      }
      // DON'T return — continue loading the next .env file
    }
  }
}

/**
 * Load .blazerc config from CWD or home directory.
 * CWD takes priority over home directory.
 */
function loadBlazeRc(): BlazeRcConfig {
  const candidates = [
    resolve(process.cwd(), '.blazerc'),
    resolve(process.cwd(), '.blazerc.json'),
    resolve(homedir(), '.blazerc'),
    resolve(homedir(), '.blazerc.json'),
  ]

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8')
        const parsed = JSON.parse(raw)
        return parsed as BlazeRcConfig
      } catch {
        // Silently skip invalid config files
      }
    }
  }

  return {}
}

/** Pick the right API key based on the target URL */
function resolveApiKey(url: string, fallbackKey?: string): string | undefined {
  // If the URL is OpenRouter, prefer the OpenRouter-specific key
  if (url.includes('openrouter.ai')) {
    return process.env.OPENROUTER_API_KEY || process.env.BLAZE_OPENROUTER_API_KEY || fallbackKey
  }
  // If the URL is NVIDIA, prefer the NVIDIA-specific key
  if (url.includes('nvidia.com')) {
    return process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || fallbackKey
  }
  // If the URL is Groq, prefer the Groq-specific key
  if (url.includes('groq.com')) {
    return process.env.GROQ_API_KEY || process.env.BLAZE_GROQ_API_KEY || fallbackKey
  }
  // If the URL is Together, prefer the Together-specific key
  if (url.includes('together.xyz')) {
    return process.env.TOGETHER_API_KEY || process.env.BLAZE_TOGETHER_API_KEY || fallbackKey
  }
  // Default: use whatever was passed
  return fallbackKey
}

export function getConfig(): BlazeConfig {
  loadDotEnv() // Load .env before reading env vars
  const rc = loadBlazeRc()

  return {
    llmUrl: process.env.BLAZE_LLM_URL || process.env.LOCAL_LLM_URL || rc.llmUrl || 'http://localhost:11434',
    llmModel: process.env.BLAZE_LLM_MODEL || process.env.LOCAL_LLM_MODEL || rc.llmModel || 'qwen3.5:cloud',
    llmApiKey: resolveApiKey(
      process.env.BLAZE_LLM_URL || process.env.LOCAL_LLM_URL || rc.llmUrl || 'http://localhost:11434',
      process.env.BLAZE_LLM_API_KEY || process.env.LOCAL_LLM_API_KEY || rc.llmApiKey
    ),
    maxTokens: parseInt(process.env.BLAZE_MAX_TOKENS || '', 10) || rc.maxTokens || 8192,
    temperature: parseFloat(process.env.BLAZE_TEMPERATURE || '') || rc.temperature || 0,
    autoApprove: process.env.BLAZE_AUTO_APPROVE === 'true' || rc.autoApprove || false,
    historyDir: resolve(homedir(), '.blaze', 'history'),
    maxContextTokens: parseInt(process.env.BLAZE_MAX_CONTEXT || '', 10) || rc.maxContextTokens || 120000,
    compactThreshold: rc.compactThreshold || 0.75,
    memoryEnabled: process.env.BLAZE_MEMORY !== 'false' && (rc.memoryEnabled !== false),
    memoryDir: resolve(homedir(), '.blaze', 'memory'),
    hooks: rc.hooks || {},
    permissions: rc.permissions || {},
    maxIterations: rc.maxIterations || 25,
    planMode: false,
    providers: rc.providers || [],
  }
}

// ─── Cost Estimation ─────────────────────────────────────────────
export interface ModelPricing {
  inputPer1M: number   // $ per 1M input tokens
  outputPer1M: number  // $ per 1M output tokens
}

/**
 * Known model pricing ($ per 1M tokens).
 * Returns null for local/free models.
 */
export function getModelPricing(model: string): ModelPricing | null {
  const m = model.toLowerCase()

  // Groq
  if (m.includes('llama-3.3-70b')) return { inputPer1M: 0.59, outputPer1M: 0.79 }
  if (m.includes('llama-3.1-8b')) return { inputPer1M: 0.05, outputPer1M: 0.08 }
  if (m.includes('gemma2-9b')) return { inputPer1M: 0.20, outputPer1M: 0.20 }
  if (m.includes('mixtral')) return { inputPer1M: 0.24, outputPer1M: 0.24 }

  // OpenRouter pricing (approximate)
  if (m.includes('claude-3.5-sonnet') || m.includes('claude-3-5-sonnet')) return { inputPer1M: 3.0, outputPer1M: 15.0 }
  if (m.includes('claude-3-opus')) return { inputPer1M: 15.0, outputPer1M: 75.0 }
  if (m.includes('gpt-4o')) return { inputPer1M: 2.5, outputPer1M: 10.0 }
  if (m.includes('gpt-4-turbo')) return { inputPer1M: 10.0, outputPer1M: 30.0 }

  // DeepSeek
  if (m.includes('deepseek-v3')) return { inputPer1M: 0.27, outputPer1M: 1.10 }
  if (m.includes('deepseek-r1')) return { inputPer1M: 0.55, outputPer1M: 2.19 }

  // NVIDIA NIM
  if (m.includes('qwen/qwen3.5')) return { inputPer1M: 0.30, outputPer1M: 0.60 }
  if (m.includes('minimax-m2.7') || m.includes('minimaxai/minimax-m2.7')) return { inputPer1M: 0.80, outputPer1M: 2.40 }
  if (m.includes('glm5') || m.includes('z-ai/glm5') || m.includes('glm-5')) return { inputPer1M: 0.80, outputPer1M: 2.40 }
  if (m.includes('meta/llama')) return { inputPer1M: 0.30, outputPer1M: 0.60 }
  if (m.includes('nvidia/')) return { inputPer1M: 0.30, outputPer1M: 0.60 }

  // Qwen cloud (Ollama)
  if (m.includes('qwen')) return { inputPer1M: 0.30, outputPer1M: 0.60 }

  // Local models (Ollama) — free
  return null
}

export function estimateCost(inputTokens: number, outputTokens: number, model: string): string {
  const pricing = getModelPricing(model)
  if (!pricing) return 'free (local)'

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M
  const total = inputCost + outputCost

  if (total < 0.001) return `~$${(total * 100).toFixed(4)}¢`
  if (total < 0.01) return `~$${total.toFixed(4)}`
  return `~$${total.toFixed(3)}`
}
