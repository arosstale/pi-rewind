# pi-rewind

Checkpoint and rewind for Pi. Auto-snapshots files before the agent edits them. `/rewind` to restore with diff preview.

## Install

```bash
pi install npm:@artale/pi-rewind
```

## How it works

Every time Pi edits or writes a file, pi-rewind saves the original content first. If the agent breaks something, you rewind.

```
Agent edits 3 files → something breaks →
/rewind list        → see all checkpoints
/rewind diff 5      → see what changed
/rewind restore 5   → file restored
```

## Commands

```
/rewind list              — show all checkpoints
/rewind diff <id>         — show diff for a checkpoint
/rewind restore <id>      — restore a file to checkpoint
/rewind restore-all       — restore ALL files to original state
/rewind clear             — clear all checkpoints
```

## Tools

- `rewind_list` — list checkpoints
- `rewind_diff` — show diff between checkpoint and current state
- `rewind_restore` — restore a file (creates pre-rewind checkpoint first)

## Features

- Auto-checkpoints on every edit and write
- Stack-based — multiple undo levels (up to 100)
- Pre-rewind checkpoint — restoring creates a new checkpoint so you can undo the undo
- Simple line-level diff preview
- Groups by file — restore-all reverts to original state per file
- Zero dependencies

## License

MIT
