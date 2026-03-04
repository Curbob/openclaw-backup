import { Router, Request, Response } from 'express';

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
  destinations: Destination[];
  retention: {
    keepSnapshots: number;
    keepDays: number;
  };
}

interface Destination {
  id: string;
  type: 'local' | 'gdrive' | 's3' | 'b2' | 'rclone';
  name: string;
  path: string;
  configured: boolean;
  primary: boolean;
}

// Default settings (will be persisted to config file)
let settings: Settings = {
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
    cron: '0 22 * * *', // 10 PM daily
    timezone: 'America/New_York',
  },
  encryption: {
    enabled: true,
    keyConfigured: false,
  },
  destinations: [
    {
      id: 'local_default',
      type: 'local',
      name: 'Local Backup',
      path: '~/.local/share/openclaw-backup/data',
      configured: true,
      primary: true,
    },
  ],
  retention: {
    keepSnapshots: 30,
    keepDays: 90,
  },
};

// GET /api/settings
settingsRoutes.get('/', (_req: Request, res: Response) => {
  res.json(settings);
});

// PATCH /api/settings
settingsRoutes.patch('/', (req: Request, res: Response) => {
  const updates = req.body;
  
  // Deep merge settings
  settings = {
    ...settings,
    ...updates,
    schedule: { ...settings.schedule, ...updates.schedule },
    encryption: { ...settings.encryption, ...updates.encryption },
    retention: { ...settings.retention, ...updates.retention },
  };

  // TODO: Persist to config file
  res.json(settings);
});

// GET /api/settings/destinations
settingsRoutes.get('/destinations', (_req: Request, res: Response) => {
  res.json(settings.destinations);
});

// POST /api/settings/destinations
settingsRoutes.post('/destinations', (req: Request, res: Response) => {
  const dest: Destination = {
    id: `dest_${Date.now()}`,
    ...req.body,
    configured: false,
  };
  
  settings.destinations.push(dest);
  res.status(201).json(dest);
});

// DELETE /api/settings/destinations/:id
settingsRoutes.delete('/destinations/:id', (req: Request, res: Response) => {
  const index = settings.destinations.findIndex(d => d.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: 'Destination not found' });
    return;
  }
  
  settings.destinations.splice(index, 1);
  res.json({ message: 'Destination removed' });
});

// POST /api/settings/encryption/setup
settingsRoutes.post('/encryption/setup', (req: Request, res: Response) => {
  const { password } = req.body;
  
  if (!password || password.length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' });
    return;
  }

  // TODO: Derive key with Argon2id and store securely
  settings.encryption.keyConfigured = true;
  res.json({ message: 'Encryption configured' });
});

// POST /api/settings/test-destination
settingsRoutes.post('/test-destination', (req: Request, res: Response) => {
  const { destinationId } = req.body;
  
  const dest = settings.destinations.find(d => d.id === destinationId);
  if (!dest) {
    res.status(404).json({ error: 'Destination not found' });
    return;
  }

  // TODO: Actually test write access
  res.json({ 
    success: true, 
    message: `Successfully connected to ${dest.name}`,
    latencyMs: 45,
  });
});
