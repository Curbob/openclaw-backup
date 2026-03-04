/**
 * Google Drive storage backend
 * 
 * Uses OAuth2 for authentication and Google Drive API v3 for storage.
 * Chunks are stored in a dedicated folder with hash-based filenames.
 */

import { createServer } from 'http';
import { URL } from 'url';
import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { StorageBackend } from './storage.js';

// OAuth2 configuration
// Users should provide their own Client ID/Secret for production
const DEFAULT_CLIENT_ID = process.env.GDRIVE_CLIENT_ID || '';
const DEFAULT_CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:11481/oauth/callback';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const TOKEN_PATH = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  'openclaw-backup',
  'gdrive-token.json'
);

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

/**
 * Google Drive storage backend
 */
export class GoogleDriveStorage implements StorageBackend {
  type = 'gdrive';
  private tokens: OAuthTokens | null = null;
  private folderId: string | null = null;
  private folderName: string;
  private clientId: string;
  private clientSecret: string;

  constructor(config: {
    folderName?: string;
    clientId?: string;
    clientSecret?: string;
  } = {}) {
    this.folderName = config.folderName || 'OpenClaw-Backups';
    this.clientId = config.clientId || DEFAULT_CLIENT_ID;
    this.clientSecret = config.clientSecret || DEFAULT_CLIENT_SECRET;
  }

  async init(): Promise<void> {
    // Load tokens if they exist
    await this.loadTokens();
    
    if (!this.tokens) {
      throw new Error('Not authenticated. Run: openclaw-backup remote add gdrive');
    }
    
    // Refresh token if expired
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
    
    // Get or create backup folder
    this.folderId = await this.getOrCreateFolder();
  }

  private async loadTokens(): Promise<void> {
    try {
      if (existsSync(TOKEN_PATH)) {
        const data = await readFile(TOKEN_PATH, 'utf-8');
        this.tokens = JSON.parse(data);
      }
    } catch (err) {
      this.tokens = null;
    }
  }

  private async saveTokens(): Promise<void> {
    const dir = join(TOKEN_PATH, '..');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(TOKEN_PATH, JSON.stringify(this.tokens, null, 2));
  }

  private isTokenExpired(): boolean {
    if (!this.tokens) return true;
    return Date.now() >= this.tokens.expiry_date - 60000; // 1 minute buffer
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refresh_token) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = await response.json() as any;
    this.tokens = {
      ...this.tokens,
      access_token: data.access_token,
      expiry_date: Date.now() + (data.expires_in * 1000),
    };
    await this.saveTokens();
  }

  private async apiRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.tokens!.access_token}`,
        ...options.headers,
      },
    });

    return response;
  }

  private async getOrCreateFolder(): Promise<string> {
    // Search for existing folder
    const searchResponse = await this.apiRequest(
      `/files?q=name='${this.folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`
    );
    
    if (!searchResponse.ok) {
      throw new Error(`Failed to search for folder: ${searchResponse.statusText}`);
    }

    const searchData = await searchResponse.json() as { files: DriveFile[] };
    
    if (searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // Create folder
    const createResponse = await this.apiRequest('/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: this.folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create folder: ${createResponse.statusText}`);
    }

    const folder = await createResponse.json() as DriveFile;
    return folder.id;
  }

  async exists(hash: string): Promise<boolean> {
    const response = await this.apiRequest(
      `/files?q=name='${hash}' and '${this.folderId}' in parents and trashed=false&fields=files(id)`
    );
    
    if (!response.ok) return false;
    
    const data = await response.json() as { files: DriveFile[] };
    return data.files.length > 0;
  }

  async write(hash: string, data: Buffer): Promise<void> {
    // Check if already exists
    if (await this.exists(hash)) {
      return;
    }

    // Create file with resumable upload for reliability
    const metadata = {
      name: hash,
      parents: [this.folderId],
    };

    // Simple upload for small files
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const body = Buffer.concat([
      Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/octet-stream\r\n\r\n'
      ),
      data,
      Buffer.from(closeDelimiter),
    ]);

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.tokens!.access_token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload chunk: ${response.statusText} - ${errorText}`);
    }
  }

  async read(hash: string): Promise<Buffer> {
    // Find file by name
    const searchResponse = await this.apiRequest(
      `/files?q=name='${hash}' and '${this.folderId}' in parents and trashed=false&fields=files(id)`
    );
    
    if (!searchResponse.ok) {
      throw new Error(`Failed to find chunk: ${searchResponse.statusText}`);
    }

    const searchData = await searchResponse.json() as { files: DriveFile[] };
    
    if (searchData.files.length === 0) {
      throw new Error(`Chunk not found: ${hash}`);
    }

    const fileId = searchData.files[0].id;

    // Download file content
    const downloadResponse = await this.apiRequest(`/files/${fileId}?alt=media`);
    
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download chunk: ${downloadResponse.statusText}`);
    }

    const arrayBuffer = await downloadResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(hash: string): Promise<void> {
    // Find file by name
    const searchResponse = await this.apiRequest(
      `/files?q=name='${hash}' and '${this.folderId}' in parents and trashed=false&fields=files(id)`
    );
    
    if (!searchResponse.ok) return;

    const searchData = await searchResponse.json() as { files: DriveFile[] };
    
    if (searchData.files.length === 0) return;

    const fileId = searchData.files[0].id;

    // Delete (trash) the file
    await this.apiRequest(`/files/${fileId}`, { method: 'DELETE' });
  }

  async list(): Promise<string[]> {
    const hashes: string[] = [];
    let pageToken: string | undefined;

    do {
      const url = `/files?q='${this.folderId}' in parents and trashed=false&fields=files(name),nextPageToken&pageSize=1000${
        pageToken ? `&pageToken=${pageToken}` : ''
      }`;
      
      const response = await this.apiRequest(url);
      
      if (!response.ok) {
        throw new Error(`Failed to list chunks: ${response.statusText}`);
      }

      const data = await response.json() as { files: DriveFile[]; nextPageToken?: string };
      
      for (const file of data.files) {
        // Only include files that look like chunk hashes (64 char hex)
        if (/^[a-f0-9]{64}$/.test(file.name)) {
          hashes.push(file.name);
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return hashes;
  }

  async stats(): Promise<{ chunks: number; bytes: number }> {
    let chunks = 0;
    let bytes = 0;
    let pageToken: string | undefined;

    do {
      const url = `/files?q='${this.folderId}' in parents and trashed=false&fields=files(name,size),nextPageToken&pageSize=1000${
        pageToken ? `&pageToken=${pageToken}` : ''
      }`;
      
      const response = await this.apiRequest(url);
      
      if (!response.ok) {
        throw new Error(`Failed to get stats: ${response.statusText}`);
      }

      const data = await response.json() as { files: DriveFile[]; nextPageToken?: string };
      
      for (const file of data.files) {
        if (/^[a-f0-9]{64}$/.test(file.name)) {
          chunks++;
          bytes += parseInt(file.size || '0', 10);
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return { chunks, bytes };
  }
}

// ─────────────────────────────────────────────────────────────
// OAuth2 Authentication Flow
// ─────────────────────────────────────────────────────────────

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Get the OAuth2 authorization URL
 */
export function getAuthUrl(config: AuthConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  config: AuthConfig
): Promise<OAuthTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${error}`);
  }

  const data = await response.json() as any;
  
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in * 1000),
    token_type: data.token_type,
  };
}

/**
 * Save tokens to config file
 */
export async function saveAuthTokens(tokens: OAuthTokens): Promise<void> {
  const dir = join(TOKEN_PATH, '..');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

/**
 * Check if Google Drive is authenticated
 */
export async function isGDriveAuthenticated(): Promise<boolean> {
  try {
    if (!existsSync(TOKEN_PATH)) return false;
    const data = await readFile(TOKEN_PATH, 'utf-8');
    const tokens = JSON.parse(data) as OAuthTokens;
    return !!tokens.refresh_token;
  } catch {
    return false;
  }
}

/**
 * Run local OAuth callback server
 */
export function startOAuthServer(
  config: AuthConfig,
  onSuccess: (tokens: OAuthTokens) => void,
  onError: (error: Error) => void
): { close: () => void; port: number } {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:11481`);
    
    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>❌ Authentication Failed</h1>
              <p>Error: ${error}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        onError(new Error(error));
        return;
      }

      if (code) {
        try {
          const tokens = await exchangeCodeForTokens(code, config);
          await saveAuthTokens(tokens);
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>✅ Authentication Successful!</h1>
                <p>Google Drive is now connected.</p>
                <p>You can close this window and return to the terminal.</p>
              </body>
            </html>
          `);
          
          onSuccess(tokens);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>❌ Authentication Failed</h1>
                <p>${err.message}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          onError(err);
        }
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(11481);
  
  return {
    close: () => server.close(),
    port: 11481,
  };
}

/**
 * Remove stored tokens (disconnect)
 */
export async function disconnectGDrive(): Promise<void> {
  try {
    if (existsSync(TOKEN_PATH)) {
      await unlink(TOKEN_PATH);
    }
  } catch {
    // Ignore errors
  }
}
