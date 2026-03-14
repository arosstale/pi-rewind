/**
 * pi-rewind — Checkpoint and rewind for Pi
 *
 * Auto-snapshots files before the agent edits them. /rewind to restore.
 * Diff preview before restoring. Stack-based — multiple undo levels.
 *
 * How it works:
 *   Hooks into pre_edit and pre_write events. Saves a copy of the file
 *   before modification. /rewind shows what changed and restores.
 *
 * Commands:
 *   /rewind list                — show all checkpoints
 *   /rewind diff <id>           — show diff for a checkpoint
 *   /rewind restore <id>        — restore a file to its checkpoint
 *   /rewind restore-all         — restore all files to last checkpoint
 *   /rewind clear               — clear all checkpoints
 *
 * Tools:
 *   rewind_list     — list checkpoints
 *   rewind_diff     — show diff for a checkpoint
 *   rewind_restore  — restore a file
 */

import type { ExtensionAPI } from '@anthropic-ai/claude-code'
import * as fs from 'fs'
import * as path from 'path'

interface Checkpoint {
  id: number
  filePath: string
  originalContent: string
  timestamp: number
  event: string // 'edit' | 'write'
}

let nextId = 1
const checkpoints: Checkpoint[] = []
const MAX_CHECKPOINTS = 100

function saveCheckpoint(filePath: string, event: string): void {
  try {
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) return // new file, nothing to save

    const content = fs.readFileSync(resolved, 'utf-8')

    // Don't double-save if last checkpoint is same file
    const last = checkpoints[checkpoints.length - 1]
    if (last && last.filePath === resolved && last.originalContent === content) return

    checkpoints.push({
      id: nextId++,
      filePath: resolved,
      originalContent: content,
      timestamp: Date.now(),
      event,
    })

    // Cap size
    while (checkpoints.length > MAX_CHECKPOINTS) {
      checkpoints.shift()
    }
  } catch {}
}

function simpleDiff(original: string, current: string): string {
  const origLines = original.split('\n')
  const currLines = current.split('\n')
  const diff: string[] = []

  const maxLen = Math.max(origLines.length, currLines.length)
  let changes = 0

  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i]
    const curr = currLines[i]

    if (orig === undefined && curr !== undefined) {
      diff.push(`+${i + 1}: ${curr}`)
      changes++
    } else if (curr === undefined && orig !== undefined) {
      diff.push(`-${i + 1}: ${orig}`)
      changes++
    } else if (orig !== curr) {
      diff.push(`-${i + 1}: ${orig}`)
      diff.push(`+${i + 1}: ${curr}`)
      changes++
    }

    if (changes > 50) {
      diff.push(`... and more changes (${maxLen - i - 1} remaining lines)`)
      break
    }
  }

  if (changes === 0) return 'No differences.'
  return diff.join('\n')
}

function formatList(): string {
  if (checkpoints.length === 0) return 'No checkpoints. Files will be checkpointed automatically before edits.'

  const rows = ['| ID | File | Event | Time |', '|-----|------|-------|------|']
  for (const cp of checkpoints.slice(-30)) {
    const relPath = cp.filePath.length > 50 ? '...' + cp.filePath.slice(-47) : cp.filePath
    const ago = Math.round((Date.now() - cp.timestamp) / 1000)
    const agoStr = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.floor(ago / 60)}m ago` : `${Math.floor(ago / 3600)}h ago`
    rows.push(`| ${cp.id} | \`${relPath}\` | ${cp.event} | ${agoStr} |`)
  }

  return `## Checkpoints (${checkpoints.length} total)\n\n${rows.join('\n')}`
}

function showDiff(id: number): string {
  const cp = checkpoints.find(c => c.id === id)
  if (!cp) return `Checkpoint ${id} not found.`

  let currentContent: string
  try {
    currentContent = fs.readFileSync(cp.filePath, 'utf-8')
  } catch {
    return `File no longer exists: ${cp.filePath}\nCheckpoint has the original (${cp.originalContent.length} chars).`
  }

  if (currentContent === cp.originalContent) {
    return `**${cp.filePath}** — no changes since checkpoint ${id}.`
  }

  const diff = simpleDiff(cp.originalContent, currentContent)
  return `**Diff for checkpoint ${id}** — \`${cp.filePath}\`\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nUse \`/rewind restore ${id}\` to revert.`
}

function restoreCheckpoint(id: number): string {
  const cp = checkpoints.find(c => c.id === id)
  if (!cp) return `Checkpoint ${id} not found.`

  try {
    // Save current state as a new checkpoint before restoring
    saveCheckpoint(cp.filePath, 'pre-rewind')
    fs.writeFileSync(cp.filePath, cp.originalContent, 'utf-8')
    return `Restored **${cp.filePath}** to checkpoint ${id}.`
  } catch (err: any) {
    return `Failed to restore: ${err.message}`
  }
}

function restoreAll(): string {
  if (checkpoints.length === 0) return 'No checkpoints to restore.'

  // Group by file, take the most recent checkpoint per file
  const byFile = new Map<string, Checkpoint>()
  for (const cp of checkpoints) {
    // Keep the FIRST (oldest) checkpoint per file — the original state
    if (!byFile.has(cp.filePath)) {
      byFile.set(cp.filePath, cp)
    }
  }

  const results: string[] = []
  for (const [filePath, cp] of byFile) {
    try {
      fs.writeFileSync(filePath, cp.originalContent, 'utf-8')
      results.push(`Restored ${filePath}`)
    } catch (err: any) {
      results.push(`Failed: ${filePath} — ${err.message}`)
    }
  }

  return `Restored ${results.length} files to original state:\n${results.join('\n')}`
}

export default function init(pi: ExtensionAPI) {
  // Hook into edit/write to auto-checkpoint
  pi.on('pre_edit', (event: any) => {
    if (event.path) saveCheckpoint(event.path, 'edit')
    return event
  })

  pi.on('pre_write', (event: any) => {
    if (event.path) saveCheckpoint(event.path, 'write')
    return event
  })

  // Command
  pi.addCommand({
    name: 'rewind',
    description: 'Checkpoint and rewind — undo file changes',
    handler: async (args) => {
      const parts = args.trim().split(/\s+/)
      const sub = parts[0]?.toLowerCase()

      if (!sub || sub === 'list') {
        pi.sendMessage({ content: formatList(), display: true }, { triggerTurn: false })
        return
      }

      if (sub === 'diff') {
        const id = parseInt(parts[1], 10)
        if (isNaN(id)) {
          pi.sendMessage({ content: 'Usage: /rewind diff <id>', display: true }, { triggerTurn: false })
          return
        }
        pi.sendMessage({ content: showDiff(id), display: true }, { triggerTurn: false })
        return
      }

      if (sub === 'restore') {
        const id = parseInt(parts[1], 10)
        if (isNaN(id)) {
          pi.sendMessage({ content: 'Usage: /rewind restore <id>', display: true }, { triggerTurn: false })
          return
        }
        pi.sendMessage({ content: restoreCheckpoint(id), display: true }, { triggerTurn: false })
        return
      }

      if (sub === 'restore-all') {
        pi.sendMessage({ content: restoreAll(), display: true }, { triggerTurn: false })
        return
      }

      if (sub === 'clear') {
        checkpoints.length = 0
        pi.sendMessage({ content: 'All checkpoints cleared.', display: true }, { triggerTurn: false })
        return
      }

      pi.sendMessage({
        content: '**Usage:**\n- `/rewind list` — show checkpoints\n- `/rewind diff <id>` — show diff\n- `/rewind restore <id>` — restore file\n- `/rewind restore-all` — restore all to original\n- `/rewind clear` — clear checkpoints',
        display: true,
      }, { triggerTurn: false })
    },
  })

  // Tools
  pi.addTool({
    name: 'rewind_list',
    description: 'List all file checkpoints. Shows file path, event type, and time.',
    parameters: { type: 'object', properties: {} },
    handler: async () => formatList(),
  })

  pi.addTool({
    name: 'rewind_diff',
    description: 'Show diff between checkpoint and current file state.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Checkpoint ID' },
      },
      required: ['id'],
    },
    handler: async (params: { id: number }) => showDiff(params.id),
  })

  pi.addTool({
    name: 'rewind_restore',
    description: 'Restore a file to its checkpointed state. Creates a pre-rewind checkpoint first.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Checkpoint ID to restore' },
      },
      required: ['id'],
    },
    handler: async (params: { id: number }) => restoreCheckpoint(params.id),
  })
}
