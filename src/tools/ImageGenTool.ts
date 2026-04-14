import type { Tool, ToolDefinition } from '../types.js'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'

/**
 * ImageGenTool — Generate images via external APIs.
 *
 * Supports:
 * - Stability AI (STABILITY_API_KEY)
 * - OpenAI DALL-E (OPENAI_API_KEY)
 * - Local Stable Diffusion (SDAPI_URL)
 *
 * Falls back gracefully if no API key is configured.
 */
export class ImageGenTool implements Tool {
  name = 'ImageGen'
  description = 'Generate an image from a text prompt. Saves the result to a file. Requires an API key (STABILITY_API_KEY, OPENAI_API_KEY, or a local SD API).'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'ImageGen',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the image to generate',
          },
          path: {
            type: 'string',
            description: 'File path to save the generated image (default: .blaze/generated_<timestamp>.png)',
          },
          width: {
            type: 'string',
            description: 'Image width (default: 1024)',
          },
          height: {
            type: 'string',
            description: 'Image height (default: 1024)',
          },
        },
        required: ['prompt'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const prompt = String(args.prompt || '')
    if (!prompt) return 'Error: prompt is required'

    const width = parseInt(String(args.width || '1024'), 10) || 1024
    const height = parseInt(String(args.height || '1024'), 10) || 1024
    const savePath = args.path
      ? resolve(cwd, String(args.path))
      : resolve(cwd, '.blaze', `generated_${Date.now()}.png`)

    const dir = dirname(savePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // Try providers in order
    const stabilityKey = process.env.STABILITY_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY
    const sdApiUrl = process.env.SDAPI_URL

    try {
      if (stabilityKey) {
        return await this.generateStability(prompt, savePath, width, height, stabilityKey)
      } else if (openaiKey) {
        return await this.generateDallE(prompt, savePath, openaiKey)
      } else if (sdApiUrl) {
        return await this.generateLocalSD(prompt, savePath, width, height, sdApiUrl)
      } else {
        return (
          'Error: No image generation API configured.\n' +
          'Set one of these environment variables:\n' +
          '  STABILITY_API_KEY — Stability AI (stability.ai)\n' +
          '  OPENAI_API_KEY — OpenAI DALL-E\n' +
          '  SDAPI_URL — Local Stable Diffusion API (e.g., http://localhost:7860)'
        )
      }
    } catch (err: unknown) {
      return `ImageGen error: ${(err as Error).message}`
    }
  }

  private async generateStability(
    prompt: string, savePath: string, width: number, height: number, apiKey: string
  ): Promise<string> {
    const resp = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'image/*',
      },
      body: (() => {
        const form = new FormData()
        form.append('prompt', prompt)
        form.append('output_format', 'png')
        return form
      })(),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => 'Unknown error')
      throw new Error(`Stability AI error (${resp.status}): ${err}`)
    }

    const buffer = Buffer.from(await resp.arrayBuffer())
    writeFileSync(savePath, buffer)
    return `Image generated and saved to: ${savePath}\nPrompt: ${prompt}`
  }

  private async generateDallE(prompt: string, savePath: string, apiKey: string): Promise<string> {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      }),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => 'Unknown error')
      throw new Error(`DALL-E error (${resp.status}): ${err}`)
    }

    const data = await resp.json() as { data: Array<{ b64_json: string }> }
    const b64 = data.data[0]?.b64_json
    if (!b64) throw new Error('No image data returned')

    const buffer = Buffer.from(b64, 'base64')
    writeFileSync(savePath, buffer)
    return `Image generated and saved to: ${savePath}\nPrompt: ${prompt}`
  }

  private async generateLocalSD(
    prompt: string, savePath: string, width: number, height: number, apiUrl: string
  ): Promise<string> {
    const resp = await fetch(`${apiUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        width,
        height,
        steps: 20,
        cfg_scale: 7,
      }),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => 'Unknown error')
      throw new Error(`Local SD error (${resp.status}): ${err}`)
    }

    const data = await resp.json() as { images: string[] }
    const b64 = data.images?.[0]
    if (!b64) throw new Error('No image data returned')

    const buffer = Buffer.from(b64, 'base64')
    writeFileSync(savePath, buffer)
    return `Image generated and saved to: ${savePath}\nPrompt: ${prompt}`
  }
}
