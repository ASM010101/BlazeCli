import * as ui from './ui.js'
import type { BlazeConfig } from './types.js'

/**
 * Failover System — automatic provider switching on rate limits.
 *
 * When a 429 (rate limit) error is hit:
 * 1. Detect all available providers (Ollama models, configured APIs)
 * 2. Show a picker to the user
 * 3. Switch the LLM client to the chosen provider
 * 4. Retry seamlessly
 */

export interface Provider {
  name: string
  url: string
  model: string
  apiKey?: string
  source: 'ollama' | 'config' | 'env'
}

/** Detect all available Ollama models */
async function detectOllamaModels(): Promise<Provider[]> {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    })
    if (!resp.ok) return []

    const data = await resp.json() as { models?: Array<{ name: string }> }
    if (!data.models) return []

    return data.models.map(m => ({
      name: `Ollama: ${m.name}`,
      url: 'http://localhost:11434',
      model: m.name,
      source: 'ollama' as const,
    }))
  } catch {
    return []
  }
}

/** Detect configured providers from environment variables */
function detectEnvProviders(): Provider[] {
  const providers: Provider[] = []

  // Groq
  const groqKey = process.env.GROQ_API_KEY || process.env.BLAZE_GROQ_API_KEY
  if (groqKey) {
    providers.push({
      name: 'Groq: llama-3.3-70b-versatile',
      url: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      apiKey: groqKey,
      source: 'env',
    })
    providers.push({
      name: 'Groq: llama-3.1-8b-instant',
      url: 'https://api.groq.com/openai/v1',
      model: 'llama-3.1-8b-instant',
      apiKey: groqKey,
      source: 'env',
    })
  }

  // OpenRouter
  const orKey = process.env.OPENROUTER_API_KEY || process.env.BLAZE_OPENROUTER_API_KEY
  if (orKey) {
    providers.push({
      name: 'OpenRouter: qwen/qwen3.5-397b-a17b',
      url: 'https://openrouter.ai/api/v1',
      model: 'qwen/qwen3.5-397b-a17b',
      apiKey: orKey,
      source: 'env',
    })
  }

  // NVIDIA NIM
  const nvKey = process.env.NGC_API_KEY || process.env.NVIDIA_API_KEY
  if (nvKey) {
    providers.push({
      name: 'NVIDIA NIM: qwen/qwen3.5-397b-a17b',
      url: 'https://integrate.api.nvidia.com/v1',
      model: 'qwen/qwen3.5-397b-a17b',
      apiKey: nvKey,
      source: 'env',
    })
    providers.push({
      name: 'NVIDIA NIM: minimaxai/minimax-m2.7',
      url: 'https://integrate.api.nvidia.com/v1',
      model: 'minimaxai/minimax-m2.7',
      apiKey: nvKey,
      source: 'env',
    })
    providers.push({
      name: 'NVIDIA NIM: z-ai/glm5',
      url: 'https://integrate.api.nvidia.com/v1',
      model: 'z-ai/glm5',
      apiKey: nvKey,
      source: 'env',
    })
  }

  // Together AI
  const togetherKey = process.env.TOGETHER_API_KEY || process.env.BLAZE_TOGETHER_API_KEY
  if (togetherKey) {
    providers.push({
      name: 'Together AI: meta-llama/Llama-3.3-70B-Instruct-Turbo',
      url: 'https://api.together.xyz/v1',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      apiKey: togetherKey,
      source: 'env',
    })
  }

  return providers
}

/** Detect providers from .blazerc providers array */
function detectConfigProviders(config: BlazeConfig): Provider[] {
  if (!config.providers || config.providers.length === 0) return []

  // Auto-resolve API keys from env if not set on the provider
  const nvKey = process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || process.env.BLAZE_LLM_API_KEY
  const groqKey = process.env.GROQ_API_KEY
  const orKey = process.env.OPENROUTER_API_KEY

  return config.providers.map((p, i) => {
    let apiKey = p.apiKey
    if (!apiKey) {
      // Auto-detect key based on URL
      if (p.url.includes('nvidia.com') && nvKey) apiKey = nvKey
      else if (p.url.includes('groq.com') && groqKey) apiKey = groqKey
      else if (p.url.includes('openrouter.ai') && orKey) apiKey = orKey
    }
    return {
      name: p.name || `Config #${i + 1}: ${p.model}`,
      url: p.url,
      model: p.model,
      apiKey,
      source: 'config' as const,
    }
  })
}

/**
 * Handle rate limit — detect available providers, show picker, return selection.
 * Returns the chosen provider, or null if user wants to abort.
 */
export async function handleRateLimit(
  config: BlazeConfig,
  currentUrl: string,
  currentModel: string,
  voluntary = false
): Promise<Provider | null> {
  console.log()
  if (voluntary) {
    console.log(ui.c.info('  🔄 Switch model/provider') + ui.c.dim(` (current: ${currentModel})`))
  } else {
    console.log(ui.c.warn('  ⚠  Rate limit hit!') + ui.c.dim(` (${currentModel} @ ${currentUrl})`))
  }
  console.log(ui.c.dim('  Scanning for available providers...'))

  // Detect all providers
  const [ollamaModels, envProviders, configProviders] = await Promise.all([
    detectOllamaModels(),
    Promise.resolve(detectEnvProviders()),
    Promise.resolve(detectConfigProviders(config)),
  ])

  // Filter out the current provider/model that just rate-limited
  const allProviders = [...configProviders, ...envProviders, ...ollamaModels].filter(
    p => !(p.url === currentUrl && p.model === currentModel)
  )

  if (allProviders.length === 0) {
    console.log(ui.c.error('  ✗ No fallback providers available.'))
    console.log(ui.c.dim('    Options to add more:'))
    console.log(ui.c.dim('    • Start Ollama: ollama serve'))
    console.log(ui.c.dim('    • Set GROQ_API_KEY in .env (free: console.groq.com)'))
    console.log(ui.c.dim('    • Set NVIDIA_API_KEY in .env (build.nvidia.com)'))
    console.log(ui.c.dim('    • Add "providers" to .blazerc'))
    return null
  }

  // Show picker
  console.log(ui.c.bold('\n  Available providers:'))
  allProviders.forEach((p, i) => {
    const icon = p.source === 'ollama' ? '🦙' : p.source === 'env' ? '☁️ ' : '⚙️ '
    const free = p.source === 'ollama' ? ui.c.success(' (free)') : ''
    console.log(`    ${ui.c.info(String(i + 1))}. ${icon} ${ui.c.assistant(p.name)}${free}`)
  })
  console.log(`    ${ui.c.dim('0')}. ${ui.c.dim('Cancel (stop)')}`)

  const answer = (await ui.getUserInput(ui.c.warn('\n  Switch to #: '))).trim()

  if (!answer || answer === '0') {
    console.log(ui.c.dim('  Cancelled.'))
    return null
  }

  // Try parsing as number first
  let chosen: Provider | undefined
  const num = parseInt(answer, 10)
  if (!isNaN(num) && num >= 1 && num <= allProviders.length) {
    chosen = allProviders[num - 1]
  }

  // Fallback: fuzzy match by name/model
  if (!chosen) {
    const lower = answer.toLowerCase()
    chosen = allProviders.find(p =>
      p.name.toLowerCase().includes(lower) ||
      p.model.toLowerCase().includes(lower)
    )
  }

  if (!chosen) {
    console.log(ui.c.error(`  ✗ No provider matching "${answer}". Try a number (1-${allProviders.length}).`))
    return null
  }

  console.log(ui.c.success(`  ✓ Switching to ${chosen.name}`))
  return chosen
}
