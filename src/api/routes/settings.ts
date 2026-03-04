import { Router, Request, Response } from 'express';
import { 
  getSetting, 
  setSetting, 
  getAllSettings,
  getDestinations,
  getPrimaryDestination,
} from '../../core/db.js';

export const settingsRoutes = Router();

interface Settings {
  sourcePaths: string[];
  excludePatterns: string[];
  schedule: {
    enabled: boolean;
    cron: string;
    timezone: string;
  };
  encryption: {
    enabled: boolean;
    keyConfigured: boolean;
  };
  destinations: any[];
  retention: {
    keepSnapshots: number;
    keepDays: number;
  };
}

// Default settings
const DEFAULTS: Settings = {
  sourcePaths: [process.env.OPENCLAW_WORKSPACE || '~/clawd'],
  excludePatterns: [
    'node_modules/',
    '.git/',
    '*.log',
    '.DS_Store',
    'dist/',
    '*.tmp',
  ],
  schedule: {
    enabled: false,
    cron: '0 22 * * *',
    timezone: 'America/New_York',
  },
  encryption: {
    enabled: true,
    keyConfigured: false,
  },
  destinations: [],
  retention: {
    keepSnapshots: 30,
    keepDays: 90,
  },
};

function loadSettings(): Settings {
  const stored = getAllSettings();
  
  // Check if encryption key is configured
  const encryptionKeyConfigured = stored.encryptionKey !== undefined && stored.encryptionKey !== null;
  
  return {
    sourcePaths: stored.sourcePaths 
      ? JSON.parse(stored.sourcePaths) 
      : DEFAULTS.sourcePaths,
    excludePatterns: stored.excludePatterns 
      ? JSON.parse(stored.excludePatterns) 
      : DEFAULTS.excludePatterns,
    schedule: stored.schedule 
      ? JSON.parse(stored.schedule) 
      : DEFAULTS.schedule,
    encryption: {
      enabled: true, // Always true - encryption is mandatory
      keyConfigured: encryptionKeyConfigured,
    },
    destinations: getDestinations().map(d => ({
      id: d.id,
      type: d.type,
      name: d.name,
      path: JSON.parse(d.config).path || '',
      configured: true,
      primary: d.primary,
    })),
    retention: stored.retention 
      ? JSON.parse(stored.retention) 
      : DEFAULTS.retention,
  };
}

// GET /api/settings
settingsRoutes.get('/', (_req: Request, res: Response) => {
  res.json(loadSettings());
});

// PATCH /api/settings
settingsRoutes.patch('/', (req: Request, res: Response) => {
  const updates = req.body;
  
  if (updates.sourcePaths) {
    setSetting('sourcePaths', JSON.stringify(updates.sourcePaths));
  }
  if (updates.excludePatterns) {
    setSetting('excludePatterns', JSON.stringify(updates.excludePatterns));
  }
  if (updates.schedule) {
    const current = getSetting('schedule');
    const merged = { ...(current ? JSON.parse(current) : DEFAULTS.schedule), ...updates.schedule };
    setSetting('schedule', JSON.stringify(merged));
  }
  if (updates.retention) {
    const current = getSetting('retention');
    const merged = { ...(current ? JSON.parse(current) : DEFAULTS.retention), ...updates.retention };
    setSetting('retention', JSON.stringify(merged));
  }

  res.json(loadSettings());
});

// GET /api/settings/destinations
settingsRoutes.get('/destinations', (_req: Request, res: Response) => {
  const destinations = getDestinations();
  res.json(destinations.map(d => ({
    id: d.id,
    type: d.type,
    name: d.name,
    config: JSON.parse(d.config),
    primary: d.primary,
  })));
});

// POST /api/settings/destinations
settingsRoutes.post('/destinations', (req: Request, res: Response) => {
  // TODO: Implement destination creation via db
  const dest = {
    id: `dest_${Date.now()}`,
    ...req.body,
    configured: false,
  };
  
  res.status(201).json(dest);
});

// DELETE /api/settings/destinations/:id
settingsRoutes.delete('/destinations/:id', (req: Request, res: Response) => {
  // TODO: Implement destination deletion via db
  res.json({ message: 'Destination removed' });
});

// POST /api/settings/encryption/setup
settingsRoutes.post('/encryption/setup', async (req: Request, res: Response) => {
  const { password } = req.body;
  
  if (!password || password.length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' });
    return;
  }

  // Use the real encryption initialization
  try {
    const { initEncryption } = await import('../../core/backup.js');
    await initEncryption(password);
    
    res.json({ message: 'Encryption configured successfully' });
  } catch (err: any) {
    console.error('Encryption setup failed:', err);
    res.status(500).json({ error: err.message || 'Failed to setup encryption' });
  }
});

// GET /api/settings/export-key
// Downloads the encryption key and salt for backup
settingsRoutes.get('/export-key', (_req: Request, res: Response) => {
  const encryptionKey = getSetting('encryptionKey');
  const encryptionSalt = getSetting('encryptionSalt');
  
  if (!encryptionKey || !encryptionSalt) {
    res.status(400).json({ error: 'Encryption not configured' });
    return;
  }

  const exportData = {
    warning: '⚠️ KEEP THIS FILE SAFE! Store it separately from your backups. Without this key, your backups are UNRECOVERABLE.',
    exportedAt: new Date().toISOString(),
    encryptionKey,
    encryptionSalt,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="openclaw-backup-key.json"');
  res.send(JSON.stringify(exportData, null, 2));
});

// POST /api/settings/test-destination
settingsRoutes.post('/test-destination', async (req: Request, res: Response) => {
  const { destinationId } = req.body;
  
  const destinations = getDestinations();
  const dest = destinations.find(d => d.id === destinationId);
  
  if (!dest) {
    res.status(404).json({ error: 'Destination not found' });
    return;
  }

  // TODO: Actually test write access based on destination type
  const start = Date.now();
  
  try {
    const config = JSON.parse(dest.config);
    
    if (dest.type === 'local') {
      const { existsSync, mkdirSync, writeFileSync, unlinkSync } = await import('fs');
      const { join } = await import('path');
      
      const testFile = join(config.path, '.openclaw-test');
      
      if (!existsSync(config.path)) {
        mkdirSync(config.path, { recursive: true });
      }
      
      writeFileSync(testFile, 'test');
      unlinkSync(testFile);
    }
    
    res.json({ 
      success: true, 
      message: `Successfully connected to ${dest.name}`,
      latencyMs: Date.now() - start,
    });
  } catch (err: any) {
    res.json({ 
      success: false, 
      message: err.message,
      latencyMs: Date.now() - start,
    });
  }
});
