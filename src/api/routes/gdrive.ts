import { Router, Request, Response } from 'express';
import {
  getAuthUrl,
  exchangeCodeForTokens,
  saveAuthTokens,
  isGDriveAuthenticated,
  disconnectGDrive,
  GoogleDriveStorage,
} from '../../core/gdrive.js';
import { getSetting, setSetting } from '../../core/db.js';

export const gdriveRoutes = Router();

// GET /api/gdrive/status - Check if connected
gdriveRoutes.get('/status', async (_req: Request, res: Response) => {
  try {
    const authenticated = await isGDriveAuthenticated();
    const clientId = getSetting('gdriveClientId');
    
    if (authenticated) {
      // Try to get folder info
      try {
        const storage = new GoogleDriveStorage({
          clientId: clientId || undefined,
          clientSecret: getSetting('gdriveClientSecret') || undefined,
        });
        await storage.init();
        const stats = await storage.stats();
        
        res.json({
          connected: true,
          configured: !!clientId,
          stats: {
            chunks: stats.chunks,
            bytes: stats.bytes,
          },
        });
      } catch (err: any) {
        res.json({
          connected: false,
          configured: !!clientId,
          error: err.message,
        });
      }
    } else {
      res.json({
        connected: false,
        configured: !!clientId,
      });
    }
  } catch (err: any) {
    res.json({
      connected: false,
      configured: false,
      error: err.message,
    });
  }
});

// POST /api/gdrive/configure - Save OAuth credentials
gdriveRoutes.post('/configure', (req: Request, res: Response) => {
  const { clientId, clientSecret } = req.body;
  
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: 'clientId and clientSecret are required' });
    return;
  }
  
  // Save credentials
  setSetting('gdriveClientId', clientId);
  setSetting('gdriveClientSecret', clientSecret);
  
  res.json({ 
    message: 'Credentials saved',
    authUrl: getAuthUrl({ clientId, clientSecret }),
  });
});

// GET /api/gdrive/auth-url - Get OAuth URL
gdriveRoutes.get('/auth-url', (_req: Request, res: Response) => {
  const clientId = getSetting('gdriveClientId');
  const clientSecret = getSetting('gdriveClientSecret');
  
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: 'OAuth credentials not configured' });
    return;
  }
  
  const authUrl = getAuthUrl({ clientId, clientSecret });
  res.json({ authUrl });
});

// POST /api/gdrive/callback - Handle OAuth callback (for web flow)
gdriveRoutes.post('/callback', async (req: Request, res: Response) => {
  const { code } = req.body;
  
  if (!code) {
    res.status(400).json({ error: 'Authorization code required' });
    return;
  }
  
  const clientId = getSetting('gdriveClientId');
  const clientSecret = getSetting('gdriveClientSecret');
  
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: 'OAuth credentials not configured' });
    return;
  }
  
  try {
    const tokens = await exchangeCodeForTokens(code, { clientId, clientSecret });
    await saveAuthTokens(tokens);
    
    res.json({ 
      message: 'Google Drive connected successfully',
      connected: true,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/gdrive/disconnect - Remove Google Drive
gdriveRoutes.post('/disconnect', async (_req: Request, res: Response) => {
  await disconnectGDrive();
  res.json({ message: 'Google Drive disconnected' });
});

// GET /api/gdrive/test - Test connection
gdriveRoutes.get('/test', async (_req: Request, res: Response) => {
  try {
    const clientId = getSetting('gdriveClientId');
    const clientSecret = getSetting('gdriveClientSecret');
    
    const storage = new GoogleDriveStorage({
      clientId: clientId || undefined,
      clientSecret: clientSecret || undefined,
    });
    
    await storage.init();
    const stats = await storage.stats();
    
    res.json({
      success: true,
      message: 'Connection successful',
      stats: {
        chunks: stats.chunks,
        bytes: stats.bytes,
      },
    });
  } catch (err: any) {
    res.json({
      success: false,
      error: err.message,
    });
  }
});
