import type { Tool, ToolDefinition } from '../types.js'

/**
 * BrowserTool — Browser automation via Playwright.
 * Supports: navigate, click, type, screenshot, extract_text, evaluate.
 *
 * Playwright is an OPTIONAL dependency. If not installed, the tool
 * returns a helpful error telling the user how to install it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let playwright: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeBrowser: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activePage: any = null

async function ensureBrowser(): Promise<{ browser: any; page: any }> {
  if (!playwright) {
    try {
      // @ts-ignore — playwright is an optional dependency
      playwright = await import('playwright')
    } catch {
      throw new Error(
        'Playwright is not installed. Run: npm install playwright && npx playwright install chromium\n' +
        'This is an optional dependency for browser automation.'
      )
    }
  }

  if (!activeBrowser || !activeBrowser.isConnected()) {
    activeBrowser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    activePage = await activeBrowser.newPage()
    await activePage.setViewportSize({ width: 1280, height: 720 })
  }

  if (!activePage || activePage.isClosed()) {
    activePage = await activeBrowser.newPage()
    await activePage.setViewportSize({ width: 1280, height: 720 })
  }

  return { browser: activeBrowser, page: activePage }
}

export class BrowserTool implements Tool {
  name = 'Browser'
  description = 'Automate a browser: navigate to URLs, click elements, type text, take screenshots, extract text, and run JavaScript. Requires Playwright.'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'Browser',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Action to perform: navigate, click, type, screenshot, extract_text, evaluate, close',
            enum: ['navigate', 'click', 'type', 'screenshot', 'extract_text', 'evaluate', 'close'],
          },
          url: {
            type: 'string',
            description: 'URL to navigate to (for navigate action)',
          },
          selector: {
            type: 'string',
            description: 'CSS selector for click/type/extract_text actions',
          },
          text: {
            type: 'string',
            description: 'Text to type (for type action)',
          },
          script: {
            type: 'string',
            description: 'JavaScript code to evaluate in the page (for evaluate action)',
          },
          path: {
            type: 'string',
            description: 'File path to save screenshot (for screenshot action, defaults to .blaze/screenshot.png)',
          },
        },
        required: ['action'],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const action = String(args.action || '').toLowerCase()

    try {
      switch (action) {
        case 'navigate': {
          const url = String(args.url || '')
          if (!url) return 'Error: url is required for navigate action'
          const { page } = await ensureBrowser()
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const title = await page.title()
          const currentUrl = page.url()
          return `Navigated to: ${currentUrl}\nTitle: ${title}`
        }

        case 'click': {
          const selector = String(args.selector || '')
          if (!selector) return 'Error: selector is required for click action'
          const { page } = await ensureBrowser()
          await page.click(selector, { timeout: 10000 })
          return `Clicked: ${selector}`
        }

        case 'type': {
          const selector = String(args.selector || '')
          const text = String(args.text || '')
          if (!selector) return 'Error: selector is required for type action'
          if (!text) return 'Error: text is required for type action'
          const { page } = await ensureBrowser()
          await page.fill(selector, text, { timeout: 10000 })
          return `Typed "${text}" into: ${selector}`
        }

        case 'screenshot': {
          const { page } = await ensureBrowser()
          const { existsSync, mkdirSync } = await import('fs')
          const { resolve, dirname } = await import('path')
          const savePath = args.path
            ? resolve(cwd, String(args.path))
            : resolve(cwd, '.blaze', 'screenshot.png')
          const dir = dirname(savePath)
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
          await page.screenshot({ path: savePath, fullPage: false })
          return `Screenshot saved to: ${savePath}`
        }

        case 'extract_text': {
          const { page } = await ensureBrowser()
          const selector = args.selector ? String(args.selector) : 'body'
          const text = await page.textContent(selector, { timeout: 10000 })
          const trimmed = (text || '').trim()
          // Limit output
          if (trimmed.length > 10000) {
            return trimmed.slice(0, 10000) + `\n... (truncated, ${trimmed.length} chars total)`
          }
          return trimmed || '(empty)'
        }

        case 'evaluate': {
          const script = String(args.script || '')
          if (!script) return 'Error: script is required for evaluate action'
          const { page } = await ensureBrowser()
          const result = await page.evaluate(script)
          return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }

        case 'close': {
          if (activeBrowser) {
            await activeBrowser.close()
            activeBrowser = null
            activePage = null
          }
          return 'Browser closed.'
        }

        default:
          return `Error: Unknown action "${action}". Valid: navigate, click, type, screenshot, extract_text, evaluate, close`
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || String(err)
      // Give helpful install message
      if (msg.includes('Cannot find module') || msg.includes('playwright')) {
        return 'Error: Playwright is not installed.\nRun: npm install playwright && npx playwright install chromium'
      }
      return `Browser error: ${msg}`
    }
  }
}
