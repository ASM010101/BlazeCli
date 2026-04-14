/**
 * Voice & Multimodal Input — voice commands and image analysis.
 * 
 * UNIQUE FEATURE: No other AI CLI supports voice input natively.
 * Blaze can:
 * 1. Listen to voice commands via microphone
 * 2. Analyze screenshots/images for context
 * 3. Support multimodal prompts (text + images)
 * 
 * Uses Web Speech API concepts adapted for CLI:
 * - On Windows: PowerShell SAPI via .NET interop
 * - On macOS: 'say' + 'osascript' for TTS, 'dictate' for STT
 * - On Linux: 'espeak' for TTS, 'sox' for recording
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as ui from './ui.js'

// ─── Text-to-Speech ──────────────────────────────────────────────

/** Speak text aloud using system TTS */
export function speak(text: string, rate = 1.0): void {
  const platform = process.platform

  try {
    if (platform === 'win32') {
      // Windows: use PowerShell SAPI
      const escaped = text.replace(/'/g, "''").replace(/"/g, '')
      const rateStr = rate >= 1 ? '1' : rate <= 0 ? '-2' : '0'
      execSync(
        `Add-Type -AssemblyName System.Speech; ` +
        `$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
        `$synth.Rate = ${rateStr}; ` +
        `$synth.Speak('${escaped}')`,
        { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
      )
    } else if (platform === 'darwin') {
      // macOS: use 'say'
      const escaped = text.replace(/'/g, "'\\''")
      const rateArg = rate !== 1 ? `-r ${Math.round(rate * 200)}` : ''
      execSync(`say ${rateArg} '${escaped}'`, { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] })
    } else {
      // Linux: try espeak
      const escaped = text.replace(/'/g, "'\\''")
      const speed = Math.round(rate * 175)
      execSync(`espeak -s ${speed} '${escaped}'`, { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] })
    }
  } catch {
    // TTS not available — silent fallback
  }
}

// ─── Speech-to-Text ──────────────────────────────────────────────

/** Record audio and transcribe to text */
export function listen(durationSeconds = 5): string {
  const platform = process.platform

  try {
    if (platform === 'win32') {
      // Windows: Use PowerShell to record and then use Whisper API if available
      // Fallback: use dictation via Windows Speech Recognition
      console.log(ui.c.info(`  🎤 Listening for ${durationSeconds} seconds...`))
      console.log(ui.c.dim('  (Speak now — Windows Speech Recognition)'))

      // Use Windows dictation via PowerShell
      const script = `
        Add-Type -AssemblyName System.Speech
        $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
        $rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
        $rec.SetInputToDefaultAudioDevice()
        $result = $rec.Recognize([System.TimeSpan]::FromSeconds(${durationSeconds}))
        if ($result) { $result.Text } else { "" }
      `
      const output = execSync(`powershell -Command "${script.replace(/\n/g, ' ')}"`, {
        encoding: 'utf-8',
        timeout: (durationSeconds + 5) * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()

      return output || ''
    } else if (platform === 'darwin') {
      // macOS: Use 'osascript' for dictation
      console.log(ui.c.info(`  🎤 Listening for ${durationSeconds} seconds...`))
      console.log(ui.c.dim('  (Speak now — press Enter when done)'))

      // Simple approach: use sox to record, then whisper if available
      const tmpFile = resolve(process.cwd(), '.blaze-voice.wav')
      try {
        execSync(`rec -r 16000 -c 1 "${tmpFile}" trim 0 ${durationSeconds}`, {
          timeout: (durationSeconds + 2) * 1000,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch {
        // sox not available
        return ''
      }

      // Try whisper CLI
      try {
        const text = execSync(`whisper "${tmpFile}" --model tiny --output_format txt --output_dir /tmp 2>/dev/null && cat /tmp/.blaze-voice.txt`, {
          encoding: 'utf-8',
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        return text
      } catch {
        return ''
      }
    }
  } catch {
    return ''
  }

  return ''
}

// ─── Image Analysis ──────────────────────────────────────────────

/** Encode an image file as base64 for multimodal LLM input */
export function encodeImageForLLM(imagePath: string): { type: string; data: string } | null {
  const fullPath = resolve(process.cwd(), imagePath)

  if (!existsSync(fullPath)) {
    return null
  }

  try {
    const buffer = readFileSync(fullPath)
    const ext = fullPath.split('.').pop()?.toLowerCase()

    let mimeType = 'image/png'
    if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg'
    else if (ext === 'gif') mimeType = 'image/gif'
    else if (ext === 'webp') mimeType = 'image/webp'
    else if (ext === 'svg') mimeType = 'image/svg+xml'

    return {
      type: mimeType,
      data: buffer.toString('base64'),
    }
  } catch {
    return null
  }
}

/** Take a screenshot (cross-platform) */
export function takeScreenshot(savePath?: string): string {
  const platform = process.platform
  const outputPath = savePath || resolve(process.cwd(), '.blaze-screenshot.png')

  try {
    if (platform === 'win32') {
      // Windows: use PowerShell
      execSync(
        `Add-Type -AssemblyName System.Windows.Forms; ` +
        `$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
        `$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); ` +
        `$graphics = [System.Drawing.Graphics]::FromImage($bitmap); ` +
        `$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); ` +
        `$bitmap.Save('${outputPath}'); ` +
        `$graphics.Dispose(); $bitmap.Dispose()`,
        { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      )
    } else if (platform === 'darwin') {
      // macOS: use screencapture
      execSync(`screencapture -x "${outputPath}"`, { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
    } else {
      // Linux: try scrot or gnome-screenshot
      try {
        execSync(`scrot "${outputPath}"`, { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch {
        execSync(`gnome-screenshot -f "${outputPath}"`, { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
      }
    }

    return existsSync(outputPath) ? outputPath : ''
  } catch {
    return ''
  }
}

// ─── Clipboard ──────────────────────────────────────────────────

/** Read text from clipboard */
export function readClipboard(): string {
  try {
    if (process.platform === 'win32') {
      return execSync('powershell -command Get-Clipboard', { encoding: 'utf-8', timeout: 5000 }).trim()
    } else if (process.platform === 'darwin') {
      return execSync('pbpaste', { encoding: 'utf-8', timeout: 5000 }).trim()
    } else {
      return execSync('xclip -selection clipboard -o', { encoding: 'utf-8', timeout: 5000 }).trim()
    }
  } catch {
    return ''
  }
}

/** Write text to clipboard */
export function writeClipboard(text: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync('clip', { input: text, timeout: 5000 })
    } else if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text, timeout: 5000 })
    } else {
      execSync('xclip -selection clipboard', { input: text, timeout: 5000 })
    }
    return true
  } catch {
    return false
  }
}