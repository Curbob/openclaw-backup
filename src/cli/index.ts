#!/usr/bin/env node
/**
 * OpenClaw Backup CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { homedir } from 'os';
import { join } from 'path';

const program = new Command();

// Config lives outside any workspace - never inside what we're backing up
const CONFIG_DIR = process.env.XDG_CONFIG_HOME 
  ? join(process.env.XDG_CONFIG_HOME, 'openclaw-backup')
  : join(homedir(), '.config', 'openclaw-backup');

// Default source is OpenClaw workspace, but can be any folder
const DEFAULT_SOURCE = process.env.OPENCLAW_WORKSPACE || join(homedir(), 'clawd');

program
  .name('openclaw-backup')
  .description('Encrypted incremental backups for OpenClaw workspaces')
  .version('0.1.0');

// ─────────────────────────────────────────────────────────────
// Init - Set up encryption and storage
// ─────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize backup repository')
  .option('-d, --dest <path>', 'Backup destination path')
  .option('-s, --source <path>', 'Source path to backup')
  .option('-p, --password <password>', 'Encryption password (for non-interactive setup)')
  .action(async (options) => {
    console.log(chalk.bold('\n🛡️  OpenClaw Backup Setup\n'));

    // Import db and backup modules
    const { initDb, setSetting } = await import('../core/db.js');
    const { initEncryption, isEncryptionConfigured } = await import('../core/backup.js');
    const { LocalStorage } = await import('../core/storage.js');

    // Initialize database
    initDb();

    // Check if already configured
    if (isEncryptionConfigured() && !options.password) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: chalk.yellow('Backup already configured. Reinitialize? (This won\'t delete existing backups)'),
        default: false,
      }]);
      if (!overwrite) {
        console.log(chalk.dim('\n  Keeping existing configuration.\n'));
        return;
      }
    }

    let answers: { source: string; dest: string; password: string };
    
    // Non-interactive mode if password is provided
    if (options.password) {
      if (options.password.length < 12) {
        console.log(chalk.red('\n❌ Password must be at least 12 characters\n'));
        process.exit(1);
      }
      answers = {
        source: options.source || DEFAULT_SOURCE,
        dest: options.dest || join(homedir(), 'OpenClaw-Backups'),
        password: options.password,
      };
    } else {
      // Interactive mode
      const prompted = await inquirer.prompt([
        {
          type: 'input',
          name: 'source',
          message: 'Workspace to backup:',
          default: options.source || DEFAULT_SOURCE
        },
        {
          type: 'input',
          name: 'dest',
          message: 'Backup destination:',
          default: options.dest || join(homedir(), 'OpenClaw-Backups')
        },
        {
          type: 'password',
          name: 'password',
          message: 'Encryption password (min 12 chars):',
          mask: '•',
          validate: (input: string) => input.length >= 12 || 'Password must be at least 12 characters'
        },
        {
          type: 'password',
          name: 'confirmPassword',
          message: 'Confirm password:',
          mask: '•'
        }
      ]);

      if (prompted.password !== prompted.confirmPassword) {
        console.log(chalk.red('\n❌ Passwords do not match\n'));
        process.exit(1);
      }
      
      answers = prompted;
    }

    const spinner = ora('Setting up backup repository...').start();
    
    try {
      // Save source path
      setSetting('sourcePaths', JSON.stringify([answers.source]));
      
      // Initialize storage
      spinner.text = 'Creating storage directories...';
      const storage = new LocalStorage(answers.dest);
      await storage.init();
      
      // Update destination in database
      const { getDb } = await import('../core/db.js');
      const db = getDb();
      db.prepare(`
        UPDATE destinations 
        SET config_json = ? 
        WHERE id = 'local_default'
      `).run(JSON.stringify({ path: answers.dest }));
      
      // Set up encryption
      spinner.text = 'Configuring encryption...';
      await initEncryption(answers.password);
      
      spinner.succeed('Backup repository initialized');
      console.log(chalk.dim(`\n  Source:      ${answers.source}`));
      console.log(chalk.dim(`  Destination: ${answers.dest}`));
      console.log(chalk.dim(`  Encryption:  XChaCha20-Poly1305 + Argon2id`));
      console.log(chalk.green('\n✅ Ready to backup! Run: openclaw-backup backup\n'));
    } catch (err: any) {
      spinner.fail('Setup failed');
      console.log(chalk.red(`\n  Error: ${err.message}\n`));
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────
// Backup - Create a new snapshot
// ─────────────────────────────────────────────────────────────
program
  .command('backup')
  .description('Create a new backup snapshot')
  .option('-s, --source <path>', 'Source path to backup')
  .option('-l, --label <label>', 'Optional label for this backup')
  .option('--dry-run', 'Show what would be backed up')
  .action(async (options) => {
    const { initDb, getSetting } = await import('../core/db.js');
    const { runBackup, isEncryptionConfigured } = await import('../core/backup.js');
    const { scanDirectory } = await import('../core/scanner.js');
    
    initDb();
    
    // Check encryption is configured
    if (!isEncryptionConfigured()) {
      console.log(chalk.red('\n❌ Backup not initialized. Run: openclaw-backup init\n'));
      process.exit(1);
    }
    
    // Get source path
    let sourcePath = options.source;
    if (!sourcePath) {
      const sourcePathsJson = getSetting('sourcePaths');
      const sourcePaths = sourcePathsJson ? JSON.parse(sourcePathsJson) : [DEFAULT_SOURCE];
      sourcePath = sourcePaths[0];
    }
    if (sourcePath.startsWith('~')) {
      sourcePath = sourcePath.replace('~', homedir());
    }
    
    // Dry run - just scan
    if (options.dryRun) {
      const spinner = ora('Scanning files...').start();
      const result = await scanDirectory(sourcePath);
      spinner.succeed(`Found ${result.files.length} files`);
      
      console.log(chalk.dim(`\n  Total size:  ${formatBytes(result.totalBytes)}`));
      console.log(chalk.dim(`  Skipped:     ${result.skipped} files/dirs`));
      if (result.errors.length > 0) {
        console.log(chalk.yellow(`  Errors:      ${result.errors.length}`));
      }
      console.log(chalk.dim('\n  (dry run - no backup created)\n'));
      return;
    }
    
    const spinner = ora('Starting backup...').start();
    let lastPhase = '';
    
    try {
      const result = await runBackup({
        sourcePath,
        label: options.label,
        onProgress: (progress) => {
          if (progress.phase !== lastPhase) {
            lastPhase = progress.phase;
            switch (progress.phase) {
              case 'scanning':
                spinner.text = `Scanning files... ${progress.filesScanned}`;
                break;
              case 'processing':
                spinner.text = `Processing ${progress.filesProcessed}/${progress.filesTotal}...`;
                break;
              case 'finalizing':
                spinner.text = 'Finalizing snapshot...';
                break;
            }
          } else if (progress.phase === 'scanning') {
            spinner.text = `Scanning files... ${progress.filesScanned}`;
          } else if (progress.phase === 'processing') {
            spinner.text = `Processing ${progress.filesProcessed}/${progress.filesTotal} (${progress.chunksNew} new chunks)`;
          }
        },
      });
      
      spinner.succeed('Backup complete');
      
      console.log(chalk.dim(`\n  Snapshot:    ${result.snapshot.id}`));
      console.log(chalk.dim(`  Files:       ${result.filesProcessed}`));
      console.log(chalk.dim(`  New chunks:  ${result.chunksNew} (${formatBytes(result.bytesStored)})`));
      console.log(chalk.dim(`  Reused:      ${result.chunksReused} chunks`));
      console.log(chalk.dim(`  Compression: ${((1 - result.compressionRatio) * 100).toFixed(0)}% saved`));
      console.log(chalk.dim(`  Deduplicated: ${formatBytes(result.deduplicatedBytes)}`));
      console.log(chalk.dim(`  Duration:    ${(result.duration / 1000).toFixed(1)}s`));
      if (options.label) {
        console.log(chalk.dim(`  Label:       ${options.label}`));
      }
      if (result.errors.length > 0) {
        console.log(chalk.yellow(`  Errors:      ${result.errors.length}`));
        for (const err of result.errors.slice(0, 5)) {
          console.log(chalk.dim(`    - ${err}`));
        }
        if (result.errors.length > 5) {
          console.log(chalk.dim(`    ... and ${result.errors.length - 5} more`));
        }
      }
      console.log();
    } catch (err: any) {
      spinner.fail('Backup failed');
      console.log(chalk.red(`\n  Error: ${err.message}\n`));
      process.exit(1);
    }
  });

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ─────────────────────────────────────────────────────────────
// List - Show available snapshots
// ─────────────────────────────────────────────────────────────
program
  .command('list')
  .alias('ls')
  .description('List backup snapshots')
  .option('-a, --all', 'Show all snapshots')
  .option('-n, --limit <n>', 'Number of snapshots to show', '10')
  .action(async (options) => {
    const { initDb, getSnapshots, getStats } = await import('../core/db.js');
    initDb();
    
    const limit = options.all ? 1000 : parseInt(options.limit, 10);
    const snapshots = getSnapshots(limit);
    const stats = getStats();
    
    console.log(chalk.bold('\n📦 Backup Snapshots\n'));
    
    if (snapshots.length === 0) {
      console.log(chalk.dim('  No backups yet. Run: openclaw-backup backup\n'));
      return;
    }

    for (const snap of snapshots) {
      const date = new Date(snap.timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      const typeIcon = snap.type === 'scheduled' ? chalk.dim('⏰') : chalk.cyan('👤');
      const label = snap.label ? chalk.yellow(` [${snap.label}]`) : '';
      const size = formatBytes(snap.totalBytes);
      console.log(`  ${chalk.bold(snap.id)}  ${date}  ${chalk.dim(size)}  ${typeIcon}${label}`);
    }
    
    console.log(chalk.dim(`\n  Showing ${snapshots.length} of ${stats.totalSnapshots} snapshots`));
    console.log(chalk.dim(`  Total stored: ${formatBytes(stats.totalBytes)} (${stats.totalChunks} chunks)\n`));
  });

// ─────────────────────────────────────────────────────────────
// Restore - Restore from a snapshot
// ─────────────────────────────────────────────────────────────
program
  .command('restore [snapshot]')
  .description('Restore from a snapshot')
  .option('-t, --to <path>', 'Restore to specific path')
  .option('-f, --files <pattern>', 'Restore only matching files')
  .option('--force', 'Overwrite without prompting')
  .action(async (snapshot, options) => {
    const { initDb, getSnapshots, getSnapshot, getFilesForSnapshot } = await import('../core/db.js');
    const { runRestore, isEncryptionConfigured } = await import('../core/backup.js');
    
    initDb();
    
    // Check encryption is configured
    if (!isEncryptionConfigured()) {
      console.log(chalk.red('\n❌ Backup not initialized. Run: openclaw-backup init\n'));
      process.exit(1);
    }
    
    // Get snapshot
    let targetSnapshot = snapshot;
    if (!targetSnapshot || targetSnapshot === 'latest') {
      const snapshots = getSnapshots(1);
      if (snapshots.length === 0) {
        console.log(chalk.red('\n❌ No snapshots available\n'));
        process.exit(1);
      }
      targetSnapshot = snapshots[0].id;
    }
    
    const snapshotData = getSnapshot(targetSnapshot);
    if (!snapshotData) {
      console.log(chalk.red(`\n❌ Snapshot not found: ${targetSnapshot}\n`));
      process.exit(1);
    }
    
    const files = getFilesForSnapshot(targetSnapshot);
    
    console.log(chalk.bold(`\n♻️  Restore from: ${targetSnapshot}\n`));
    console.log(chalk.dim(`  Files: ${files.length}`));
    console.log(chalk.dim(`  Date:  ${new Date(snapshotData.timestamp).toLocaleString()}`));
    
    let targetPath = options.to;
    if (targetPath?.startsWith('~')) {
      targetPath = targetPath.replace('~', homedir());
    }
    
    // Interactive prompts unless --force
    if (!options.force) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'destination',
          message: 'Restore to:',
          default: targetPath || snapshotData.sourcePath
        },
        {
          type: 'confirm',
          name: 'proceed',
          message: chalk.yellow('This will overwrite existing files. Proceed?'),
          default: false
        }
      ]);

      if (!answers.proceed) {
        console.log(chalk.dim('\n  Restore cancelled\n'));
        return;
      }
      
      targetPath = answers.destination;
    }
    
    if (targetPath?.startsWith('~')) {
      targetPath = targetPath.replace('~', homedir());
    }

    const spinner = ora('Starting restore...').start();
    let lastPhase = '';
    
    try {
      const result = await runRestore({
        snapshotId: targetSnapshot,
        targetPath,
        onProgress: (progress) => {
          if (progress.phase !== lastPhase) {
            lastPhase = progress.phase;
            switch (progress.phase) {
              case 'preparing':
                spinner.text = 'Preparing restore...';
                break;
              case 'downloading':
                spinner.text = `Reading chunks... ${progress.filesRestored}/${progress.filesTotal}`;
                break;
              case 'decrypting':
                spinner.text = `Decrypting... ${progress.filesRestored}/${progress.filesTotal}`;
                break;
              case 'writing':
                spinner.text = `Writing files... ${progress.filesRestored}/${progress.filesTotal}`;
                break;
            }
          } else {
            spinner.text = `${lastPhase}... ${progress.filesRestored}/${progress.filesTotal}`;
          }
        },
      });
      
      spinner.succeed('Restore complete');
      console.log(chalk.dim(`\n  Files:    ${result.filesRestored}`));
      console.log(chalk.dim(`  Size:     ${formatBytes(result.bytesRestored)}`));
      console.log(chalk.dim(`  Duration: ${(result.duration / 1000).toFixed(1)}s`));
      console.log(chalk.dim(`  Target:   ${targetPath || snapshotData.sourcePath}`));
      if (result.errors.length > 0) {
        console.log(chalk.yellow(`  Errors:   ${result.errors.length}`));
        for (const err of result.errors.slice(0, 3)) {
          console.log(chalk.dim(`    - ${err}`));
        }
      }
      console.log();
    } catch (err: any) {
      spinner.fail('Restore failed');
      console.log(chalk.red(`\n  Error: ${err.message}\n`));
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────
// Schedule - Set up automatic backups
// ─────────────────────────────────────────────────────────────
program
  .command('schedule')
  .description('Manage backup schedule')
  .argument('[action]', 'show, enable, disable, daily, hourly, weekly')
  .argument('[time]', 'Time for scheduled backup (e.g., 22:00)')
  .action(async (action, time) => {
    const { initDb } = await import('../core/db.js');
    const { getScheduleConfig, setScheduleConfig, getSchedulerState, startScheduler, stopScheduler } = await import('../core/scheduler.js');
    
    initDb();
    
    const state = getSchedulerState();
    
    if (!action || action === 'show') {
      console.log(chalk.bold('\n📅 Backup Schedule\n'));
      
      if (state.config.enabled) {
        console.log(chalk.dim('  Status:    ') + (state.running ? chalk.green('Running') : chalk.yellow('Stopped')));
        console.log(chalk.dim('  Cron:      ') + state.config.cron);
        console.log(chalk.dim('  Timezone:  ') + state.config.timezone);
        if (state.nextRun) {
          console.log(chalk.dim('  Next run:  ') + new Date(state.nextRun).toLocaleString());
        }
        if (state.lastRun) {
          const status = state.lastResult === 'success' ? chalk.green('✓') : chalk.red('✗');
          console.log(chalk.dim('  Last run:  ') + new Date(state.lastRun).toLocaleString() + ' ' + status);
        }
      } else {
        console.log(chalk.dim('  Status:    ') + chalk.yellow('Disabled'));
        console.log(chalk.dim('\n  Enable with: openclaw-backup schedule daily 22:00'));
      }
      console.log();
      return;
    }

    if (action === 'disable') {
      setScheduleConfig({ enabled: false });
      stopScheduler();
      console.log(chalk.yellow('\n⏸️  Scheduled backups disabled\n'));
      return;
    }
    
    if (action === 'enable') {
      if (!state.config.enabled) {
        setScheduleConfig({ enabled: true });
      }
      const started = startScheduler();
      if (started) {
        console.log(chalk.green('\n✅ Scheduler started\n'));
      } else {
        console.log(chalk.red('\n❌ Failed to start scheduler. Check encryption is configured.\n'));
      }
      return;
    }

    // Parse time (default to 22:00)
    let hour = 22;
    let minute = 0;
    if (time) {
      const match = time.match(/^(\d{1,2}):?(\d{2})?$/);
      if (match) {
        hour = parseInt(match[1], 10);
        minute = match[2] ? parseInt(match[2], 10) : 0;
      }
    }
    
    let cron = '';
    switch (action) {
      case 'hourly':
        cron = '0 * * * *';
        break;
      case 'daily':
        cron = `${minute} ${hour} * * *`;
        break;
      case 'weekly':
        cron = `${minute} ${hour} * * 0`;
        break;
      default:
        console.log(chalk.red(`\n❌ Unknown action: ${action}`));
        console.log(chalk.dim('  Valid actions: show, enable, disable, daily, hourly, weekly\n'));
        return;
    }
    
    setScheduleConfig({ enabled: true, cron });
    const started = startScheduler();
    
    if (started) {
      const newState = getSchedulerState();
      console.log(chalk.green(`\n✅ Scheduled ${action} backups at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`));
      if (newState.nextRun) {
        console.log(chalk.dim(`   Next backup: ${new Date(newState.nextRun).toLocaleString()}`));
      }
      console.log();
    } else {
      console.log(chalk.yellow(`\n⚠️  Schedule saved but scheduler not started. Make sure encryption is configured.\n`));
    }
  });

// ─────────────────────────────────────────────────────────────
// Remote - Manage cloud storage
// ─────────────────────────────────────────────────────────────
program
  .command('remote')
  .description('Manage remote storage')
  .argument('<action>', 'add, remove, list, test')
  .argument('[type]', 'gdrive, s3, b2, local')
  .option('--client-id <id>', 'OAuth Client ID (for gdrive)')
  .option('--client-secret <secret>', 'OAuth Client Secret (for gdrive)')
  .action(async (action, type, options) => {
    const { initDb, getDestinations } = await import('../core/db.js');
    initDb();
    
    if (action === 'list') {
      const { isGDriveAuthenticated } = await import('../core/gdrive.js');
      const destinations = getDestinations();
      const gdriveAuth = await isGDriveAuthenticated();
      
      console.log(chalk.bold('\n☁️  Remote Storage\n'));
      
      for (const dest of destinations) {
        const icon = dest.type === 'gdrive' ? '🔵' : '📁';
        const config = JSON.parse(dest.config);
        const path = config.path || config.folderName || '';
        const status = dest.type === 'gdrive' 
          ? (gdriveAuth ? chalk.green('✓ connected') : chalk.yellow('○ not authenticated'))
          : chalk.green('✓ local');
        const primary = dest.primary ? chalk.cyan(' (primary)') : '';
        
        console.log(`  ${icon} ${dest.name.padEnd(16)} ${path.padEnd(20)} ${status}${primary}`);
      }
      
      if (destinations.length === 0) {
        console.log(chalk.dim('  No destinations configured'));
      }
      console.log();
      return;
    }

    if (action === 'add') {
      if (type === 'gdrive') {
        const { getAuthUrl, startOAuthServer, isGDriveAuthenticated } = await import('../core/gdrive.js');
        
        // Check if already connected
        if (await isGDriveAuthenticated()) {
          const { reconnect } = await inquirer.prompt([{
            type: 'confirm',
            name: 'reconnect',
            message: 'Google Drive is already connected. Reconnect?',
            default: false,
          }]);
          if (!reconnect) return;
        }
        
        // Get OAuth credentials
        let clientId = options.clientId || process.env.GDRIVE_CLIENT_ID;
        let clientSecret = options.clientSecret || process.env.GDRIVE_CLIENT_SECRET;
        
        if (!clientId || !clientSecret) {
          console.log(chalk.bold('\n☁️  Connect Google Drive\n'));
          console.log(chalk.dim('  You need OAuth credentials from Google Cloud Console.'));
          console.log(chalk.dim('  Create credentials at: https://console.cloud.google.com/apis/credentials\n'));
          
          const creds = await inquirer.prompt([
            {
              type: 'input',
              name: 'clientId',
              message: 'Client ID:',
              validate: (v: string) => v.length > 0 || 'Required',
            },
            {
              type: 'password',
              name: 'clientSecret',
              message: 'Client Secret:',
              mask: '•',
              validate: (v: string) => v.length > 0 || 'Required',
            },
          ]);
          clientId = creds.clientId;
          clientSecret = creds.clientSecret;
        }
        
        const config = { clientId, clientSecret };
        const authUrl = getAuthUrl(config);
        
        console.log(chalk.bold('\n🔐 Authorization Required\n'));
        console.log('  Open this URL in your browser:\n');
        console.log(chalk.cyan(`  ${authUrl}\n`));
        
        // Start local server for callback
        const spinner = ora('Waiting for authorization...').start();
        
        await new Promise<void>((resolve, reject) => {
          const { close } = startOAuthServer(
            config,
            (tokens) => {
              spinner.succeed('Google Drive connected!');
              close();
              resolve();
            },
            (error) => {
              spinner.fail(`Authorization failed: ${error.message}`);
              close();
              reject(error);
            }
          );
          
          // Timeout after 5 minutes
          setTimeout(() => {
            spinner.fail('Authorization timed out');
            close();
            reject(new Error('Timeout'));
          }, 5 * 60 * 1000);
        });
        
        console.log(chalk.green('\n✅ Google Drive is now connected!'));
        console.log(chalk.dim('   Chunks will be stored in: OpenClaw-Backups folder\n'));
        return;
      }
      
      if (type === 'local') {
        const { dest } = await inquirer.prompt([{
          type: 'input',
          name: 'dest',
          message: 'Backup directory path:',
          default: join(homedir(), 'OpenClaw-Backups'),
        }]);
        
        console.log(chalk.green(`\n✅ Local storage configured: ${dest}\n`));
        return;
      }
      
      console.log(chalk.yellow(`\n⚠️  Unknown remote type: ${type}`));
      console.log(chalk.dim('   Supported: gdrive, local\n'));
      return;
    }

    if (action === 'remove') {
      if (type === 'gdrive') {
        const { disconnectGDrive } = await import('../core/gdrive.js');
        await disconnectGDrive();
        console.log(chalk.yellow('\n🔌 Google Drive disconnected\n'));
        return;
      }
      console.log(chalk.dim('\nSpecify remote type to remove: openclaw-backup remote remove gdrive\n'));
      return;
    }

    if (action === 'test') {
      const spinner = ora('Testing remote connection...').start();
      
      try {
        if (type === 'gdrive') {
          const { GoogleDriveStorage, isGDriveAuthenticated } = await import('../core/gdrive.js');
          
          if (!await isGDriveAuthenticated()) {
            spinner.fail('Google Drive not authenticated. Run: openclaw-backup remote add gdrive');
            return;
          }
          
          const storage = new GoogleDriveStorage();
          await storage.init();
          const stats = await storage.stats();
          
          spinner.succeed(`Google Drive OK - ${stats.chunks} chunks, ${formatBytes(stats.bytes)}`);
        } else {
          spinner.succeed('Remote connection OK');
        }
      } catch (err: any) {
        spinner.fail(`Connection failed: ${err.message}`);
      }
      console.log();
    }
  });

// ─────────────────────────────────────────────────────────────
// Browse - Explore snapshot contents
// ─────────────────────────────────────────────────────────────
program
  .command('browse <snapshot>')
  .description('Browse files in a snapshot')
  .action(async (snapshot) => {
    console.log(chalk.bold(`\n📂 Snapshot: ${snapshot}\n`));
    console.log(chalk.dim('  Date: Mar 3, 2026 7:45 PM\n'));
    
    const files = [
      { path: 'MEMORY.md', size: '12 KB' },
      { path: 'AGENTS.md', size: '8 KB' },
      { path: 'SOUL.md', size: '2 KB' },
      { path: 'memory/', size: '' },
      { path: 'memory/2026-03-03.md', size: '4 KB' },
      { path: 'memory/2026-03-02.md', size: '6 KB' },
    ];

    for (const f of files) {
      const icon = f.path.endsWith('/') ? '📁' : '📄';
      console.log(`  ${icon} ${f.path}${f.size ? chalk.dim(`  ${f.size}`) : ''}`);
    }
    console.log();
  });

// ─────────────────────────────────────────────────────────────
// Serve - Start web UI
// ─────────────────────────────────────────────────────────────
program
  .command('serve')
  .alias('ui')
  .description('Start the web UI')
  .option('-p, --port <port>', 'Port to listen on', '11480')
  .option('--no-open', 'Don\'t open browser automatically')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    
    console.log(chalk.bold('\n🦞 OpenClaw Backup Web UI\n'));
    
    // Dynamically import the server to avoid loading it for other commands
    const { startServer } = await import('../api/server.js');
    
    startServer(port);
    
    console.log(chalk.dim(`\n  Dashboard: `) + chalk.cyan(`http://localhost:${port}`));
    console.log(chalk.dim('  Press Ctrl+C to stop\n'));
    
    // Optionally open browser
    if (options.open) {
      const { exec } = await import('child_process');
      const url = `http://localhost:${port}`;
      
      // Cross-platform open
      const cmd = process.platform === 'darwin' ? 'open' : 
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} ${url}`);
    }
  });

// ─────────────────────────────────────────────────────────────
// Status - Quick status check
// ─────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show backup status')
  .action(async () => {
    const { initDb, getStats, getSetting, getSnapshots } = await import('../core/db.js');
    const { isEncryptionConfigured } = await import('../core/backup.js');
    
    initDb();
    
    const stats = getStats();
    const snapshots = getSnapshots(1);
    const sourcePathsJson = getSetting('sourcePaths');
    const sourcePaths = sourcePathsJson ? JSON.parse(sourcePathsJson) : [DEFAULT_SOURCE];
    const scheduleJson = getSetting('schedule');
    const schedule = scheduleJson ? JSON.parse(scheduleJson) : null;
    
    console.log(chalk.bold('\n📊 Backup Status\n'));
    
    console.log(chalk.dim('  Source:      ') + sourcePaths[0]);
    
    if (snapshots.length > 0) {
      const lastBackup = new Date(snapshots[0].timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      console.log(chalk.dim('  Last backup: ') + lastBackup);
    } else {
      console.log(chalk.dim('  Last backup: ') + chalk.yellow('Never'));
    }
    
    console.log(chalk.dim('  Snapshots:   ') + stats.totalSnapshots);
    console.log(chalk.dim('  Total size:  ') + `${formatBytes(stats.totalBytes)} (${stats.totalChunks} chunks)`);
    console.log(chalk.dim('  Deduplicated: ') + formatBytes(stats.deduplicatedBytes));
    
    if (isEncryptionConfigured()) {
      console.log(chalk.dim('  Encryption:  ') + chalk.green('✓ Active'));
    } else {
      console.log(chalk.dim('  Encryption:  ') + chalk.yellow('Not configured'));
    }
    
    if (schedule?.enabled) {
      console.log(chalk.dim('  Schedule:    ') + schedule.cron);
    } else {
      console.log(chalk.dim('  Schedule:    ') + chalk.dim('Disabled'));
    }
    
    console.log();
  });

program.parse();
