/**
 * Backup scheduler - manages automatic scheduled backups
 */

import cron from 'node-cron';
import { getSetting, setSetting, getSnapshots } from './db.js';
import { runBackup, isEncryptionConfigured, BackupProgress } from './backup.js';
import { homedir } from 'os';

interface ScheduleConfig {
  enabled: boolean;
  cron: string;
  timezone: string;
}

interface SchedulerState {
  running: boolean;
  task: cron.ScheduledTask | null;
  lastRun: string | null;
  lastResult: 'success' | 'failed' | null;
  lastError: string | null;
  nextRun: string | null;
  backupInProgress: boolean;
}

const state: SchedulerState = {
  running: false,
  task: null,
  lastRun: null,
  lastResult: null,
  lastError: null,
  nextRun: null,
  backupInProgress: false,
};

// Event listeners for backup progress
type SchedulerEventListener = (event: SchedulerEvent) => void;
const listeners: SchedulerEventListener[] = [];

export interface SchedulerEvent {
  type: 'started' | 'progress' | 'completed' | 'failed' | 'scheduled' | 'stopped';
  timestamp: string;
  data?: any;
}

export function onSchedulerEvent(listener: SchedulerEventListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function emit(event: SchedulerEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[Scheduler] Event listener error:', err);
    }
  }
}

/**
 * Get current schedule configuration
 */
export function getScheduleConfig(): ScheduleConfig {
  const json = getSetting('schedule');
  if (json) {
    return JSON.parse(json);
  }
  return {
    enabled: false,
    cron: '0 22 * * *', // Default: 10 PM daily
    timezone: 'America/New_York',
  };
}

/**
 * Update schedule configuration
 */
export function setScheduleConfig(config: Partial<ScheduleConfig>): ScheduleConfig {
  const current = getScheduleConfig();
  const updated = { ...current, ...config };
  setSetting('schedule', JSON.stringify(updated));
  
  // Restart scheduler if running
  if (state.running) {
    stopScheduler();
    if (updated.enabled) {
      startScheduler();
    }
  }
  
  return updated;
}

/**
 * Get scheduler state
 */
export function getSchedulerState(): SchedulerState & { config: ScheduleConfig } {
  return {
    ...state,
    nextRun: state.task ? getNextRunTime() : null,
    config: getScheduleConfig(),
  };
}

/**
 * Calculate next run time
 */
function getNextRunTime(): string | null {
  const config = getScheduleConfig();
  if (!config.enabled || !state.task) return null;
  
  try {
    // Parse cron and calculate next occurrence
    const [minute, hour, dayOfMonth, month, dayOfWeek] = config.cron.split(' ');
    const now = new Date();
    
    // Simple approximation for common patterns
    if (hour !== '*' && minute !== '*') {
      const targetHour = parseInt(hour, 10);
      const targetMinute = parseInt(minute, 10);
      
      const next = new Date(now);
      next.setHours(targetHour, targetMinute, 0, 0);
      
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      
      return next.toISOString();
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Start the scheduler
 */
export function startScheduler(): boolean {
  const config = getScheduleConfig();
  
  if (!config.enabled) {
    console.log('[Scheduler] Schedule is disabled');
    return false;
  }
  
  if (!cron.validate(config.cron)) {
    console.error(`[Scheduler] Invalid cron expression: ${config.cron}`);
    return false;
  }
  
  if (!isEncryptionConfigured()) {
    console.error('[Scheduler] Cannot start: encryption not configured');
    return false;
  }
  
  // Stop existing task if any
  if (state.task) {
    state.task.stop();
  }
  
  console.log(`[Scheduler] Starting with cron: ${config.cron} (${config.timezone})`);
  
  state.task = cron.schedule(config.cron, async () => {
    await runScheduledBackup();
  }, {
    timezone: config.timezone,
  });
  
  state.running = true;
  state.nextRun = getNextRunTime();
  
  emit({
    type: 'scheduled',
    timestamp: new Date().toISOString(),
    data: { cron: config.cron, nextRun: state.nextRun },
  });
  
  return true;
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (state.task) {
    state.task.stop();
    state.task = null;
  }
  state.running = false;
  state.nextRun = null;
  
  emit({
    type: 'stopped',
    timestamp: new Date().toISOString(),
  });
  
  console.log('[Scheduler] Stopped');
}

/**
 * Run a scheduled backup
 */
async function runScheduledBackup(): Promise<void> {
  if (state.backupInProgress) {
    console.log('[Scheduler] Backup already in progress, skipping');
    return;
  }
  
  if (!isEncryptionConfigured()) {
    console.error('[Scheduler] Cannot run backup: encryption not configured');
    state.lastResult = 'failed';
    state.lastError = 'Encryption not configured';
    return;
  }
  
  state.backupInProgress = true;
  state.lastRun = new Date().toISOString();
  
  emit({
    type: 'started',
    timestamp: state.lastRun,
  });
  
  console.log(`[Scheduler] Starting scheduled backup at ${state.lastRun}`);
  
  // Get source path from settings
  const sourcePathsJson = getSetting('sourcePaths');
  const sourcePaths = sourcePathsJson ? JSON.parse(sourcePathsJson) : [process.env.OPENCLAW_WORKSPACE || `${homedir()}/clawd`];
  let sourcePath = sourcePaths[0];
  
  if (sourcePath.startsWith('~')) {
    sourcePath = sourcePath.replace('~', homedir());
  }
  
  // Get exclude patterns
  const excludePatternsJson = getSetting('excludePatterns');
  const excludePatterns = excludePatternsJson ? JSON.parse(excludePatternsJson) : undefined;
  
  try {
    const result = await runBackup({
      sourcePath,
      label: 'scheduled',
      excludePatterns,
      onProgress: (progress: BackupProgress) => {
        emit({
          type: 'progress',
          timestamp: new Date().toISOString(),
          data: progress,
        });
      },
    });
    
    state.lastResult = result.errors.length > 0 ? 'failed' : 'success';
    state.lastError = result.errors.length > 0 ? result.errors[0] : null;
    state.nextRun = getNextRunTime();
    
    emit({
      type: 'completed',
      timestamp: new Date().toISOString(),
      data: {
        snapshotId: result.snapshot.id,
        filesProcessed: result.filesProcessed,
        chunksNew: result.chunksNew,
        chunksReused: result.chunksReused,
        duration: result.duration,
        errors: result.errors.length,
      },
    });
    
    console.log(`[Scheduler] Backup completed: ${result.snapshot.id} (${result.filesProcessed} files, ${result.duration}ms)`);
    
  } catch (err: any) {
    state.lastResult = 'failed';
    state.lastError = err.message;
    
    emit({
      type: 'failed',
      timestamp: new Date().toISOString(),
      data: { error: err.message },
    });
    
    console.error(`[Scheduler] Backup failed: ${err.message}`);
  } finally {
    state.backupInProgress = false;
  }
}

/**
 * Trigger an immediate backup (outside of schedule)
 */
export async function triggerBackup(): Promise<void> {
  await runScheduledBackup();
}
