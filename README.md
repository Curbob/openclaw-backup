# openclaw-backup

Encrypted, incremental backup tool for OpenClaw workspaces. Local-first with optional cloud sync.

## Features

- **Encrypted at rest** — XChaCha20-Poly1305 + Argon2id key derivation
- **Incremental backups** — Content-defined chunking (FastCDC) with SHA-256 deduplication
- **Complete backup** — Workspace + OpenClaw config backed up together
- **Multiple destinations** — Local storage + Google Drive (more coming)
- **Scheduled backups** — Built-in cron-style scheduler
- **Web UI** — Dashboard at `http://localhost:11480`
- **Cross-platform** — Mac, Linux, Windows

## Quick Start

```bash
# Clone and install
git clone https://github.com/curbob/openclaw-backup.git
cd openclaw-backup
npm install
npm run build

# Initialize (creates config + encryption key)
node dist/cli/index.js init

# Run your first backup
node dist/cli/index.js backup

# List snapshots
node dist/cli/index.js list

# Restore to a directory
node dist/cli/index.js restore <snapshot-id> ./restore-test
```

## Installation

### From Source

```bash
git clone https://github.com/curbob/openclaw-backup.git
cd openclaw-backup
npm install
npm run build
```

### Global Install (coming soon)

```bash
npm install -g openclaw-backup
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize backup repository and generate encryption key |
| `backup` | Create a new backup snapshot |
| `restore <id> <dir>` | Restore a snapshot to a directory |
| `list` | List all snapshots |
| `status` | Show backup status and stats |
| `serve` | Start web UI server (port 11480) |
| `schedule enable` | Enable automatic scheduled backups |
| `schedule disable` | Disable scheduled backups |
| `schedule status` | Show current schedule |
| `remote list` | List configured remote destinations |
| `remote add gdrive` | Add Google Drive as backup destination |
| `remote remove <name>` | Remove a remote destination |
| `remote test <name>` | Test connection to a remote |

## Web UI

Start the dashboard:

```bash
node dist/cli/index.js serve
```

Open http://localhost:11480 to:
- View backup history and stats
- Trigger manual backups
- Restore from any snapshot
- Configure schedule and settings

## Configuration

Config files are stored in `~/.config/openclaw-backup/`:

```
~/.config/openclaw-backup/
├── config.json          # Settings (source path, schedule, etc.)
├── encryption.key       # Your encryption key (KEEP THIS SAFE!)
└── gdrive-token.json    # Google Drive OAuth token (if configured)
```

Data is stored in `~/.local/share/openclaw-backup/`:

```
~/.local/share/openclaw-backup/
├── backup.db            # SQLite index (snapshots, file metadata)
└── chunks/              # Encrypted chunk storage
    ├── ab/
    │   └── ab3f...      # Chunks organized by hash prefix
    └── ...
```

## Cloud Destinations

### Google Drive

**Step 1: Create OAuth Credentials**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Go to **APIs & Services → Library**
4. Search for "Google Drive API" and **Enable** it
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials → OAuth client ID**
7. If prompted, configure the OAuth consent screen:
   - User Type: **External** (or Internal if using Workspace)
   - App name: "OpenClaw Backup" (or whatever you want)
   - Add your email as a test user
8. Back to Credentials → Create OAuth client ID:
   - Application type: **Desktop app**
   - Name: "OpenClaw Backup"
9. Download or copy the **Client ID** and **Client Secret**

**Step 2: Connect to Google Drive**

```bash
# Add Google Drive (will prompt for Client ID and Secret)
node dist/cli/index.js remote add gdrive

# This opens a browser for authorization
# Grant access, then tokens are stored locally

# Test the connection
node dist/cli/index.js remote test gdrive
```

Backups are stored in an `OpenClaw-Backups` folder in your Drive root.

## How It Works

1. **Scan** — Walk the source directory, collect file metadata
2. **Chunk** — Split files into variable-size chunks using FastCDC
3. **Deduplicate** — Skip chunks that already exist (by SHA-256 hash)
4. **Encrypt** — Encrypt new chunks with XChaCha20-Poly1305
5. **Store** — Write encrypted chunks to local storage and/or cloud
6. **Index** — Record snapshot metadata in SQLite

On restore, the process reverses: read chunks → decrypt → reassemble files.

## Disaster Recovery

This tool backs up your **OpenClaw workspace** (personality, memories, skills, projects) — not OpenClaw itself. Think of it like backing up your documents, not the application.

**To restore on a fresh machine:**

```bash
# 1. Install the tools
npm install -g openclaw
npm install -g openclaw-backup   # or clone this repo

# 2. Copy your encryption key from secure storage
mkdir -p ~/.config/openclaw-backup
cp /path/to/your/backup/encryption.key ~/.config/openclaw-backup/

# 3. If using Google Drive, re-authenticate
openclaw-backup remote add gdrive

# 4. Restore everything (workspace + config restored to original locations)
openclaw-backup restore <snapshot-id>

# Or restore to a test directory first:
openclaw-backup restore <snapshot-id> ~/restore-test

# 5. Start OpenClaw
openclaw gateway start
```

When restoring to the original locations, files go back where they came from:
- Workspace files → `~/clawd/`
- Config files → `~/.config/openclaw/`

When restoring to a test directory, sources are kept separate:
- `~/restore-test/Users_you_clawd/` — workspace files
- `~/restore-test/Users_you_.config_openclaw/` — config files

Your agent wakes up with all its memories, personality, and projects intact.

**What gets restored:**
- **Workspace** (`~/clawd` by default):
  - AGENTS.md, SOUL.md, USER.md, TOOLS.md — agent personality & behavior
  - memory/ — daily logs, context, learned patterns
  - skills/ — custom skills
  - All your projects and files
- **OpenClaw config** (`~/.config/openclaw/`):
  - config.yaml — gateway settings, API keys, channel configs
  - session data, OAuth tokens

**What you need separately:**
- OpenClaw installation (`npm install -g openclaw`)
- Your encryption key (`~/.config/openclaw-backup/encryption.key`)

💡 **Tip:** Store your encryption key and OpenClaw config in a password manager or secure location outside your workspace.

## Security

- **Encryption**: XChaCha20-Poly1305 (libsodium via sodium-native)
- **Key derivation**: Argon2id with secure random salt
- **Chunk hashes**: SHA-256
- **Key storage**: Local file with restrictive permissions (0600)

⚠️ **Back up your encryption key!** Without `~/.config/openclaw-backup/encryption.key`, your backups are unrecoverable.

## Development

```bash
# Install dependencies
npm install

# Build everything
npm run build

# Build CLI only
npx tsc

# Build web UI only
npm run build:web

# Development server (web UI with hot reload)
npm run dev:web
```

## Run on Startup

To keep the scheduler and web UI running automatically:

### macOS (launchd)

```bash
# Create the plist
cat > ~/Library/LaunchAgents/com.openclaw.backup.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/openclaw-backup/dist/cli/index.js</string>
        <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/openclaw-backup.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/openclaw-backup.err</string>
</dict>
</plist>
EOF

# Update the node path (find yours with: which node)
# Update the script path to where you cloned the repo

# Load it
launchctl load ~/Library/LaunchAgents/com.openclaw.backup.plist

# Check status
launchctl list | grep openclaw
```

### Linux (systemd)

```bash
# Create user service
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/openclaw-backup.service << 'EOF'
[Unit]
Description=OpenClaw Backup Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /path/to/openclaw-backup/dist/cli/index.js serve
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

# Update paths as needed, then:
systemctl --user daemon-reload
systemctl --user enable openclaw-backup
systemctl --user start openclaw-backup

# Check status
systemctl --user status openclaw-backup
```

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task → "OpenClaw Backup"
3. Trigger: "When the computer starts"
4. Action: Start a program
   - Program: `node`
   - Arguments: `C:\path\to\openclaw-backup\dist\cli\index.js serve`
5. Finish and check "Open Properties"
6. Check "Run whether user is logged on or not"

Or use PowerShell:
```powershell
$action = New-ScheduledTaskAction -Execute "node" -Argument "C:\path\to\openclaw-backup\dist\cli\index.js serve"
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "OpenClaw Backup" -Action $action -Trigger $trigger -RunLevel Highest
```

## Roadmap

- [ ] Compression before encryption (zstd)
- [ ] Cleanup command for orphan chunks
- [ ] Multi-destination backup (local + cloud simultaneously)
- [ ] S3/B2/Backblaze support
- [ ] Retention policies (keep last N snapshots)
- [ ] Integrity verification command

## License

MIT

## Related

- [OpenClaw](https://github.com/openclaw/openclaw) — The AI agent platform this tool backs up
