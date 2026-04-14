import type { Tool, ToolDefinition } from '../types.js'
import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

/**
 * ScreenshotTool — Take screenshots using native OS commands.
 * No external dependencies required.
 *
 * Windows: PowerShell + .NET (System.Windows.Forms)
 * macOS: screencapture
 * Linux: gnome-screenshot / scrot / import (ImageMagick)
 */
export class ScreenshotTool implements Tool {
  name = 'Screenshot'
  description = 'Take a screenshot of the screen or a specific window. Returns the file path of the saved image.'
  needsPermission = true

  definition: ToolDefinition = {
    type: 'function',
    function: {
      name: 'Screenshot',
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path to save the screenshot (default: .blaze/screenshot.png)',
          },
          region: {
            type: 'string',
            description: 'Region to capture: "full" (entire screen) or "active" (active window). Default: "full"',
            enum: ['full', 'active'],
          },
        },
        required: [],
      },
    },
  }

  async execute(args: Record<string, unknown>, cwd: string): Promise<string> {
    const region = String(args.region || 'full')
    const savePath = args.path
      ? resolve(cwd, String(args.path))
      : resolve(cwd, '.blaze', `screenshot_${Date.now()}.png`)

    const dir = dirname(savePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    try {
      const platform = process.platform

      if (platform === 'win32') {
        // PowerShell screenshot using .NET
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('${savePath.replace(/\\/g, '\\\\')}')
$graphics.Dispose()
$bitmap.Dispose()
`.trim()
        execSync(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
          timeout: 15000,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } else if (platform === 'darwin') {
        // macOS
        if (region === 'active') {
          execSync(`screencapture -w "${savePath}"`, { timeout: 10000 })
        } else {
          execSync(`screencapture -x "${savePath}"`, { timeout: 10000 })
        }
      } else {
        // Linux — try multiple tools
        const tools = [
          `gnome-screenshot -f "${savePath}"`,
          `scrot "${savePath}"`,
          `import -window root "${savePath}"`, // ImageMagick
        ]
        let success = false
        for (const cmd of tools) {
          try {
            execSync(cmd, { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
            success = true
            break
          } catch { /* try next */ }
        }
        if (!success) {
          return 'Error: No screenshot tool found. Install: sudo apt install gnome-screenshot OR scrot OR imagemagick'
        }
      }

      if (existsSync(savePath)) {
        return `Screenshot saved to: ${savePath}`
      } else {
        return 'Error: Screenshot was not saved (unknown error)'
      }
    } catch (err: unknown) {
      return `Screenshot error: ${(err as Error).message}`
    }
  }
}
