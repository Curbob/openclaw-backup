# OpenClaw Backup - Design Doc

## Overview
Open-source, cross-platform backup system for OpenClaw workspaces with encryption, incremental snapshots, and cloud storage support.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Dashboard                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Backup   │  │ Schedule │  │ Restore  │  │ Settings/Cloud   │ │
│  │   Now    │  │  Setup   │  │  Browse  │  │    Accounts      │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backup Engine (Node.js)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Chunker    │  │  Encryptor  │  │  Scheduler (node-cron)  │  │
│  │  (CDC/SHA)  │  │  (AES-256)  │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Index DB   │  │  Snapshot   │  │  Transport Layer        │  │
│  │  (SQLite)   │  │  Manager    │  │  (rclone / native API)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  Google  │   │   S3 /   │   │  Local   │
        │  Drive   │   │   B2     │   │  Folder  │
        └──────────┘   └──────────┘   └──────────┘
```

---

## UI Mockup (Web Dashboard)

### Main Screen
```
╔══════════════════════════════════════════════════════════════════╗
║  🛡️ OpenClaw Backup                              ⚙️ Settings    ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │  Last Backup: March 3, 2026 at 7:45 PM                     │  ║
║  │  Status: ✅ Healthy • 47 snapshots • 128 MB stored         │  ║
║  │                                                            │  ║
║  │  [  🔄 Backup Now  ]    [  📅 Schedule  ]                  │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  ── Recent Snapshots ─────────────────────────────────────────   ║
║                                                                  ║
║  │ 📦 Mar 3, 7:45 PM    │ 2.3 MB  │ auto    │ [Restore] [···] │  ║
║  │ 📦 Mar 3, 12:00 PM   │ 1.1 MB  │ auto    │ [Restore] [···] │  ║
║  │ 📦 Mar 2, 11:30 PM   │ 4.7 MB  │ manual  │ [Restore] [···] │  ║
║  │ 📦 Mar 2, 6:00 PM    │ 0.8 MB  │ auto    │ [Restore] [···] │  ║
║  │ 📦 Mar 1, 9:15 AM    │ 12 MB   │ manual  │ [Restore] [···] │  ║
║                                                                  ║
║  [  Show All Snapshots  ]                                        ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### Schedule Setup Modal
```
╔══════════════════════════════════════════════════════════════════╗
║  📅 Backup Schedule                                    [  ✕  ]   ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Frequency:  ○ Hourly   ● Daily   ○ Weekly   ○ Custom           ║
║                                                                  ║
║  Time:       [ 2:00 AM ▼ ]                                       ║
║                                                                  ║
║  Days:       ☑ Mon  ☑ Tue  ☑ Wed  ☑ Thu  ☑ Fri  ☐ Sat  ☐ Sun   ║
║                                                                  ║
║  ── Retention ────────────────────────────────────────────────   ║
║                                                                  ║
║  Keep daily backups for:    [ 7 days    ▼ ]                      ║
║  Keep weekly backups for:   [ 4 weeks   ▼ ]                      ║
║  Keep monthly backups for:  [ 6 months  ▼ ]                      ║
║                                                                  ║
║  ── What to Backup ───────────────────────────────────────────   ║
║                                                                  ║
║  ☑ Memory files (MEMORY.md, memory/*.md)                        ║
║  ☑ Workspace files (skills, configs)                            ║
║  ☑ Session logs                                                  ║
║  ☐ Full workspace (everything)                                   ║
║                                                                  ║
║              [  Cancel  ]    [  💾 Save Schedule  ]              ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### Restore Modal
```
╔══════════════════════════════════════════════════════════════════╗
║  ♻️ Restore from Snapshot                              [  ✕  ]   ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Restoring: 📦 March 3, 2026 at 7:45 PM (2.3 MB)                ║
║                                                                  ║
║  ── Restore Mode ─────────────────────────────────────────────   ║
║                                                                  ║
║  ● Restore in place (overwrites current files)                   ║
║  ○ Restore to new location                                       ║
║  ○ Restore specific files only                                   ║
║                                                                  ║
║  ── Destination ──────────────────────────────────────────────   ║
║                                                                  ║
║  Path: [ /Users/rich/clawd                    ] [ Browse... ]    ║
║                                                                  ║
║  ── Options ──────────────────────────────────────────────────   ║
║                                                                  ║
║  ☑ Create backup of current state before restoring              ║
║  ☐ Overwrite all (don't ask about conflicts)                    ║
║  ☑ Verify integrity after restore                                ║
║                                                                  ║
║  ── Preview ──────────────────────────────────────────────────   ║
║                                                                  ║
║  │ 📄 MEMORY.md           │ 12 KB  │ modified │                  ║
║  │ 📁 memory/             │        │          │                  ║
║  │   └─ 2026-03-03.md     │ 4 KB   │ new      │                  ║
║  │   └─ 2026-03-02.md     │ 8 KB   │ same     │                  ║
║  │ 📄 AGENTS.md           │ 3 KB   │ same     │                  ║
║                                                                  ║
║              [  Cancel  ]    [  ♻️ Start Restore  ]              ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### Cloud Accounts Settings
```
╔══════════════════════════════════════════════════════════════════╗
║  ☁️ Cloud Storage                                      [  ✕  ]   ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  ── Connected Accounts ───────────────────────────────────────   ║
║                                                                  ║
║  │ 🔵 Google Drive  │ curbob@gmail.com    │ ✅ │ [Disconnect] │  ║
║  │ 🟠 Backblaze B2  │ (not connected)     │    │ [Connect]    │  ║
║  │ 🟡 AWS S3        │ (not connected)     │    │ [Connect]    │  ║
║  │ 📁 Local Folder  │ /Volumes/Backup     │ ✅ │ [Change]     │  ║
║                                                                  ║
║  ── Primary Destination ──────────────────────────────────────   ║
║                                                                  ║
║  Send backups to: [ Google Drive ▼ ]                             ║
║  Folder path:     [ /OpenClaw Backups                   ]        ║
║                                                                  ║
║  ── Encryption ───────────────────────────────────────────────   ║
║                                                                  ║
║  ☑ Encrypt backups (AES-256-GCM)                                ║
║  Password: [ ••••••••••••••••••••• ] [Show] [Change]            ║
║                                                                  ║
║  ⚠️  Store this password safely! Without it, backups cannot     ║
║     be restored.                                                 ║
║                                                                  ║
║              [  Cancel  ]    [  💾 Save Settings  ]              ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## CLI Interface

```bash
# Manual backup
openclaw-backup backup                    # Backup now
openclaw-backup backup --label "pre-update"

# Scheduling
openclaw-backup schedule daily 2am        # Set daily at 2 AM
openclaw-backup schedule show             # View current schedule
openclaw-backup schedule disable

# List & browse snapshots
openclaw-backup list                      # Recent snapshots
openclaw-backup list --all                # All snapshots
openclaw-backup browse <snapshot-id>      # Browse files in snapshot

# Restore
openclaw-backup restore latest            # Restore most recent
openclaw-backup restore <snapshot-id>     # Restore specific
openclaw-backup restore <id> --to /path   # Restore to different location
openclaw-backup restore <id> --files "memory/*"  # Partial restore

# Cloud setup
openclaw-backup remote add gdrive         # Interactive OAuth
openclaw-backup remote add s3 --bucket my-backups
openclaw-backup remote list
openclaw-backup remote test               # Verify connectivity

# Encryption
openclaw-backup init                      # Set up encryption password
openclaw-backup change-password
```

---

## Data Model

### SQLite Schema
```sql
-- Snapshots (backup points)
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  label TEXT,                          -- Optional user label
  type TEXT NOT NULL,                  -- 'auto' | 'manual'
  total_size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  parent_id TEXT REFERENCES snapshots(id)  -- For incremental chain
);

-- Chunks (deduplicated content blocks)
CREATE TABLE chunks (
  hash TEXT PRIMARY KEY,               -- SHA-256 of content
  size INTEGER NOT NULL,
  compressed_size INTEGER NOT NULL,
  ref_count INTEGER DEFAULT 1          -- For garbage collection
);

-- Files in each snapshot
CREATE TABLE snapshot_files (
  snapshot_id TEXT REFERENCES snapshots(id),
  path TEXT NOT NULL,
  chunk_hashes TEXT NOT NULL,          -- JSON array of chunk hashes
  mode INTEGER,                        -- File permissions
  mtime TIMESTAMPTZ,
  size INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, path)
);

-- Remote storage targets
CREATE TABLE remotes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                  -- 'gdrive' | 's3' | 'b2' | 'local'
  config TEXT NOT NULL,                -- Encrypted JSON
  is_primary BOOLEAN DEFAULT FALSE
);

-- Schedule config
CREATE TABLE schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton
  cron TEXT,                           -- Cron expression
  enabled BOOLEAN DEFAULT TRUE,
  retention_daily INTEGER DEFAULT 7,
  retention_weekly INTEGER DEFAULT 4,
  retention_monthly INTEGER DEFAULT 6,
  include_patterns TEXT,               -- JSON array
  exclude_patterns TEXT                -- JSON array
);
```

---

## Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Runtime | Node.js | Matches OpenClaw, cross-platform |
| UI | Electron + React | Desktop app, web tech |
| Chunking | FastCDC (npm: fastcdc) | Content-defined chunking, good dedup |
| Encryption | libsodium (sodium-native) | Fast, audited, XChaCha20-Poly1305 |
| Database | better-sqlite3 | Fast, embedded, no server |
| Cloud | rclone (shelled) or googleapis | GDrive, S3, B2, etc |
| Scheduling | node-cron + system service | Persistent even when app closed |

---

## File Structure

```
openclaw-backup/
├── package.json
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts
│   │   ├── ipc.ts               # IPC handlers
│   │   └── tray.ts              # System tray
│   ├── renderer/                # React UI
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Restore.tsx
│   │   │   ├── Schedule.tsx
│   │   │   └── Settings.tsx
│   │   └── components/
│   ├── core/                    # Backup engine (shared)
│   │   ├── chunker.ts
│   │   ├── crypto.ts
│   │   ├── snapshot.ts
│   │   ├── restore.ts
│   │   ├── scheduler.ts
│   │   └── db.ts
│   ├── remotes/                 # Storage backends
│   │   ├── base.ts
│   │   ├── gdrive.ts
│   │   ├── s3.ts
│   │   └── local.ts
│   └── cli/                     # CLI interface
│       └── index.ts
├── assets/
│   └── icons/
└── electron-builder.yml         # Build config for Mac/Win/Linux
```

---

## Security Considerations

1. **Encryption key never stored in plaintext**
   - Derive key from password using Argon2id
   - Store only a verification hash

2. **Cloud credentials encrypted at rest**
   - OAuth tokens encrypted with user's backup password

3. **Zero-knowledge possible**
   - Cloud provider never sees plaintext
   - Even filenames can be encrypted

4. **Secure delete**
   - When retention policy removes old backups, securely delete chunks with ref_count=0

---

## MVP Scope (v0.1)

- [ ] CLI: `backup`, `restore`, `list`
- [ ] Local folder storage
- [ ] AES-256 encryption
- [ ] Content-defined chunking & dedup
- [ ] SQLite index
- [ ] Basic incremental (parent snapshot reference)

## v0.2
- [ ] Google Drive integration
- [ ] Web UI (local server, opens in browser)
- [ ] Scheduled backups (cron)
- [ ] Retention policies

## v1.0
- [ ] Electron desktop app
- [ ] System tray with status
- [ ] S3/B2 support
- [ ] Selective restore (browse & pick files)
- [ ] Integrity verification
