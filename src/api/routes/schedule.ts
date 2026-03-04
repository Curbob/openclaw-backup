import { Router, Request, Response } from 'express';
import {
  getScheduleConfig,
  setScheduleConfig,
  getSchedulerState,
  startScheduler,
  stopScheduler,
  triggerBackup,
} from '../../core/scheduler.js';
import cron from 'node-cron';

export const scheduleRoutes = Router();

// GET /api/schedule - Get schedule status
scheduleRoutes.get('/', (_req: Request, res: Response) => {
  const state = getSchedulerState();
  res.json({
    enabled: state.config.enabled,
    cron: state.config.cron,
    timezone: state.config.timezone,
    running: state.running,
    lastRun: state.lastRun,
    lastResult: state.lastResult,
    lastError: state.lastError,
    nextRun: state.nextRun,
    backupInProgress: state.backupInProgress,
  });
});

// PUT /api/schedule - Update schedule
scheduleRoutes.put('/', (req: Request, res: Response) => {
  const { enabled, cron: cronExpr, timezone } = req.body;
  
  // Validate cron expression if provided
  if (cronExpr && !cron.validate(cronExpr)) {
    res.status(400).json({ error: `Invalid cron expression: ${cronExpr}` });
    return;
  }
  
  // Validate timezone if provided
  const validTimezones = [
    'America/New_York', 'America/Chicago', 'America/Denver', 
    'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage',
    'America/Honolulu', 'Pacific/Honolulu', 'UTC', 'Europe/London',
    'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
    'Australia/Sydney',
  ];
  
  if (timezone && !validTimezones.includes(timezone)) {
    // Allow it anyway, node-cron will validate
  }
  
  const updated = setScheduleConfig({
    ...(enabled !== undefined && { enabled }),
    ...(cronExpr && { cron: cronExpr }),
    ...(timezone && { timezone }),
  });
  
  res.json({
    message: enabled ? 'Schedule updated and started' : 'Schedule updated',
    ...updated,
    nextRun: getSchedulerState().nextRun,
  });
});

// POST /api/schedule/start - Start scheduler
scheduleRoutes.post('/start', (_req: Request, res: Response) => {
  const started = startScheduler();
  
  if (started) {
    const state = getSchedulerState();
    res.json({
      message: 'Scheduler started',
      nextRun: state.nextRun,
    });
  } else {
    res.status(400).json({
      error: 'Failed to start scheduler. Check that schedule is enabled and encryption is configured.',
    });
  }
});

// POST /api/schedule/stop - Stop scheduler
scheduleRoutes.post('/stop', (_req: Request, res: Response) => {
  stopScheduler();
  res.json({ message: 'Scheduler stopped' });
});

// POST /api/schedule/trigger - Trigger immediate backup
scheduleRoutes.post('/trigger', async (_req: Request, res: Response) => {
  const state = getSchedulerState();
  
  if (state.backupInProgress) {
    res.status(409).json({ error: 'Backup already in progress' });
    return;
  }
  
  // Run backup in background
  triggerBackup().catch(err => {
    console.error('[Schedule API] Trigger failed:', err);
  });
  
  res.json({ message: 'Backup triggered' });
});

// Helper: Parse human-readable schedule to cron
scheduleRoutes.post('/parse', (req: Request, res: Response) => {
  const { frequency, time, dayOfWeek } = req.body;
  
  let cronExpr = '';
  const [hours, minutes] = (time || '22:00').split(':').map(Number);
  
  switch (frequency) {
    case 'hourly':
      cronExpr = '0 * * * *';
      break;
    case 'daily':
      cronExpr = `${minutes} ${hours} * * *`;
      break;
    case 'weekly':
      const dow = dayOfWeek ?? 0; // Default to Sunday
      cronExpr = `${minutes} ${hours} * * ${dow}`;
      break;
    case 'monthly':
      cronExpr = `${minutes} ${hours} 1 * *`;
      break;
    default:
      res.status(400).json({ error: `Unknown frequency: ${frequency}` });
      return;
  }
  
  res.json({
    cron: cronExpr,
    valid: cron.validate(cronExpr),
    description: describeCron(cronExpr),
  });
});

function describeCron(expr: string): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expr.split(' ');
  
  if (minute === '0' && hour === '*') {
    return 'Every hour';
  }
  
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour}:${minute.padStart(2, '0')}`;
  }
  
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `Weekly on ${days[parseInt(dayOfWeek, 10)]} at ${hour}:${minute.padStart(2, '0')}`;
  }
  
  if (dayOfMonth === '1' && month === '*') {
    return `Monthly on the 1st at ${hour}:${minute.padStart(2, '0')}`;
  }
  
  return expr;
}
