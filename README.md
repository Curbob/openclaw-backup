# openclaw-backup

Encrypted, incremental backup tool for OpenClaw workspaces. Local-first with optional cloud sync.

## Features

- **Encrypted at rest** — XChaCha20-Poly1305 + Argon2id key derivation
- **Incremental backups** — Content-defined chunking (FastCDC) with SHA-256 deduplication
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

```bash
# Add Google Drive
node dist/cli/index.js remote add gdrive

# This opens a browser for OAuth authorization
# Tokens are stored locally and refresh automatically

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
