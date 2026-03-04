# OpenClaw Backup

Open-source, cross-platform encrypted backup system for OpenClaw workspaces.

## Features

- 🔐 **Encrypted** — AES-256 / XChaCha20-Poly1305 encryption
- 📦 **Incremental** — Content-defined chunking with deduplication
- ☁️ **Cloud Storage** — Google Drive, S3, Backblaze B2, or local
- 🖥️ **Cross-Platform** — Mac, Linux, Windows
- ⏰ **Scheduled** — Automatic backups with retention policies
- 🎯 **Selective Restore** — Browse snapshots and restore specific files

## Quick Start

```bash
# Install
npm install -g openclaw-backup

# Initialize (set password & destination)
openclaw-backup init

# Create a backup
openclaw-backup backup

# List snapshots
openclaw-backup list

# Restore
openclaw-backup restore latest
openclaw-backup restore snap_001 --to /path/to/restore
```

## Schedule Backups

```bash
# Daily at 2 AM
openclaw-backup schedule daily 2am

# View schedule
openclaw-backup schedule show

# Disable
openclaw-backup schedule disable
```

## Cloud Storage

```bash
# Add Google Drive
openclaw-backup remote add gdrive

# Add S3
openclaw-backup remote add s3 --bucket my-backups --region us-east-1

# Test connection
openclaw-backup remote test
```

## How It Works

1. **Chunking** — Files are split into content-defined chunks using FastCDC
2. **Deduplication** — Identical chunks are stored once (SHA-256 addressed)
3. **Encryption** — Each chunk is encrypted with XChaCha20-Poly1305
4. **Storage** — Encrypted chunks uploaded to your chosen destination
5. **Index** — SQLite database tracks snapshots and chunk references

## Development

```bash
# Clone
git clone https://github.com/openclaw/openclaw-backup
cd openclaw-backup

# Install deps
npm install

# Run CLI in dev mode
npm run cli -- backup

# Build
npm run build
```

## Roadmap

- [x] CLI scaffold
- [x] Chunking & crypto modules
- [ ] SQLite index
- [ ] Local storage backend
- [ ] Google Drive backend
- [ ] Web UI
- [ ] Electron desktop app
- [ ] System tray integration

## License

MIT
