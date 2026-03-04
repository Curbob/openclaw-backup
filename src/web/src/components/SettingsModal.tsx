import { useState, useEffect, useCallback } from 'react';

interface Destination {
  id: string;
  type: string;
  name: string;
  path: string;
  configured: boolean;
  primary: boolean;
}

interface Settings {
  sourcePaths: string[];
  excludePatterns: string[];
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

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'encryption' | 'destinations'>('general');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  }

  async function saveSettings() {
    if (!settings) return;

    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      onClose();
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  const [encryptionLoading, setEncryptionLoading] = useState(false);
  const [encryptionSuccess, setEncryptionSuccess] = useState(false);

  async function setupEncryption() {
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    if (password.length < 12) {
      alert('Password must be at least 12 characters');
      return;
    }

    setEncryptionLoading(true);
    
    try {
      const res = await fetch('/api/settings/encryption/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || 'Failed to setup encryption');
        setEncryptionLoading(false);
        return;
      }
      
      setPassword('');
      setConfirmPassword('');
      setEncryptionSuccess(true);
      fetchSettings();
      
      // Auto-close after success
      setTimeout(() => {
        setEncryptionSuccess(false);
      }, 3000);
    } catch (err) {
      console.error('Failed to setup encryption:', err);
      alert('Failed to setup encryption');
    } finally {
      setEncryptionLoading(false);
    }
  }

  if (!settings) {
    return (
      <div className="modal-overlay">
        <div className="modal">Loading...</div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>⚙️ Settings</h2>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {(['general', 'encryption', 'destinations'] as const).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'primary' : 'secondary'}
              onClick={() => setActiveTab(tab)}
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* General Tab */}
        {activeTab === 'general' && (
          <>
            <div className="form-group">
              <label>Source Paths</label>
              <input
                type="text"
                value={settings.sourcePaths.join(', ')}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    sourcePaths: e.target.value.split(',').map((s) => s.trim()),
                  })
                }
              />
            </div>

            <div className="form-group">
              <label>Exclude Patterns (one per line)</label>
              <textarea
                style={{
                  width: '100%',
                  minHeight: '100px',
                  padding: '0.75rem',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  resize: 'vertical',
                }}
                value={settings.excludePatterns.join('\n')}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    excludePatterns: e.target.value.split('\n').filter(Boolean),
                  })
                }
              />
            </div>

            <div className="form-group">
              <label>Keep Snapshots</label>
              <input
                type="number"
                min="1"
                value={settings.retention.keepSnapshots}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    retention: {
                      ...settings.retention,
                      keepSnapshots: parseInt(e.target.value) || 30,
                    },
                  })
                }
              />
            </div>
          </>
        )}

        {/* Encryption Tab */}
        {activeTab === 'encryption' && (
          <>
            {settings.encryption.keyConfigured ? (
              <div
                style={{
                  padding: '1rem',
                  background: 'rgba(46, 204, 113, 0.1)',
                  borderRadius: '8px',
                }}
              >
                <p style={{ color: 'var(--success)' }}>
                  🔒 Encryption is configured and active
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                  All backups are encrypted with XChaCha20-Poly1305
                </p>
              </div>
            ) : encryptionSuccess ? (
              <div
                style={{
                  padding: '1rem',
                  background: 'rgba(46, 204, 113, 0.1)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <p style={{ color: 'var(--success)', fontSize: '1.25rem' }}>
                  ✅ Encryption configured!
                </p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                  You can now start backing up your files.
                </p>
              </div>
            ) : (
              <>
                <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                  Set up encryption to protect your backups. You'll need this
                  password to restore.
                </p>

                <div className="form-group">
                  <label>Password (min 12 characters)</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter encryption password"
                    disabled={encryptionLoading}
                  />
                </div>

                <div className="form-group">
                  <label>Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    disabled={encryptionLoading}
                  />
                </div>

                <button
                  className="primary"
                  onClick={setupEncryption}
                  disabled={password.length < 12 || password !== confirmPassword || encryptionLoading}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  {encryptionLoading ? (
                    <>
                      <span style={{ 
                        display: 'inline-block', 
                        width: '1rem', 
                        height: '1rem', 
                        border: '2px solid transparent',
                        borderTopColor: 'white',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                      }} />
                      Setting up...
                    </>
                  ) : (
                    'Enable Encryption'
                  )}
                </button>
              </>
            )}
          </>
        )}

        {/* Destinations Tab */}
        {activeTab === 'destinations' && (
          <DestinationsTab destinations={settings.destinations} onRefresh={fetchSettings} />
        )}

        <div className="button-group" style={{ marginTop: '1.5rem' }}>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={saveSettings}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Destinations Tab Component
// ─────────────────────────────────────────────────────────────

interface DestinationsTabProps {
  destinations: Destination[];
  onRefresh: () => void;
}

interface GDriveStatus {
  connected: boolean;
  configured: boolean;
  stats?: { chunks: number; bytes: number };
  error?: string;
}

function DestinationsTab({ destinations, onRefresh }: DestinationsTabProps) {
  const [showGDriveSetup, setShowGDriveSetup] = useState(false);
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'credentials' | 'authorize' | 'complete'>('credentials');

  useEffect(() => {
    fetchGDriveStatus();
  }, []);

  async function fetchGDriveStatus() {
    try {
      const res = await fetch('/api/gdrive/status');
      const data = await res.json() as GDriveStatus;
      setGdriveStatus(data);
      
      if (data.configured && !data.connected) {
        setStep('authorize');
      } else if (data.connected) {
        setStep('complete');
      }
    } catch (err) {
      console.error('Failed to fetch GDrive status:', err);
    }
  }

  async function saveCredentials() {
    if (!clientId || !clientSecret) {
      alert('Please enter both Client ID and Client Secret');
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch('/api/gdrive/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save credentials');
        return;
      }
      
      setAuthUrl(data.authUrl);
      setStep('authorize');
    } catch (err) {
      alert('Failed to save credentials');
    } finally {
      setLoading(false);
    }
  }

  async function submitAuthCode() {
    if (!authCode) {
      alert('Please enter the authorization code');
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch('/api/gdrive/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: authCode }),
      });
      
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Authorization failed');
        return;
      }
      
      setStep('complete');
      fetchGDriveStatus();
      onRefresh();
    } catch (err) {
      alert('Authorization failed');
    } finally {
      setLoading(false);
    }
  }

  async function disconnectGDrive() {
    if (!confirm('Disconnect Google Drive?')) return;
    
    try {
      await fetch('/api/gdrive/disconnect', { method: 'POST' });
      setGdriveStatus({ connected: false, configured: false });
      setStep('credentials');
      setAuthUrl('');
      setAuthCode('');
      onRefresh();
    } catch (err) {
      alert('Failed to disconnect');
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  return (
    <>
      {/* Local destinations */}
      <ul className="snapshot-list">
        {destinations.map((dest) => (
          <li key={dest.id} className="snapshot-item">
            <div className="snapshot-info">
              <span className="snapshot-date">
                {dest.type === 'local' ? '📁' : '☁️'} {dest.name} {dest.primary && '⭐'}
              </span>
              <span className="snapshot-meta">
                {dest.type} • {dest.path}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Google Drive Section */}
      <div style={{ 
        marginTop: '1.5rem', 
        padding: '1rem',
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '1rem',
        }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem' }}>
            🔵 Google Drive
          </h3>
          {gdriveStatus?.connected && (
            <span style={{ 
              color: 'var(--success)', 
              fontSize: '0.8125rem' 
            }}>
              ✓ Connected
            </span>
          )}
        </div>

        {gdriveStatus?.connected ? (
          <>
            {gdriveStatus.stats && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 1rem 0' }}>
                {gdriveStatus.stats.chunks} chunks • {formatBytes(gdriveStatus.stats.bytes)}
              </p>
            )}
            <button 
              className="secondary" 
              onClick={disconnectGDrive}
              style={{ fontSize: '0.8125rem' }}
            >
              Disconnect
            </button>
          </>
        ) : showGDriveSetup ? (
          <div>
            {step === 'credentials' && (
              <>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Create OAuth credentials at{' '}
                  <a 
                    href="https://console.cloud.google.com/apis/credentials" 
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    Google Cloud Console
                  </a>
                </p>
                
                <div className="form-group">
                  <label>Client ID</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="xxxxx.apps.googleusercontent.com"
                  />
                </div>
                
                <div className="form-group">
                  <label>Client Secret</label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="GOCSPX-xxxxx"
                  />
                </div>
                
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    className="secondary" 
                    onClick={() => setShowGDriveSetup(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    className="primary" 
                    onClick={saveCredentials}
                    disabled={loading || !clientId || !clientSecret}
                  >
                    {loading ? 'Saving...' : 'Next'}
                  </button>
                </div>
              </>
            )}

            {step === 'authorize' && (
              <>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  1. Click the button below to authorize<br />
                  2. Copy the authorization code<br />
                  3. Paste it here
                </p>
                
                <a
                  href={authUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '0.5rem 1rem',
                    background: 'var(--accent)',
                    color: 'white',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    fontSize: '0.875rem',
                    marginBottom: '1rem',
                  }}
                  onClick={async () => {
                    if (!authUrl) {
                      const res = await fetch('/api/gdrive/auth-url');
                      const data = await res.json();
                      setAuthUrl(data.authUrl);
                      window.open(data.authUrl, '_blank');
                    }
                  }}
                >
                  Open Google Authorization
                </a>
                
                <div className="form-group">
                  <label>Authorization Code</label>
                  <input
                    type="text"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="4/0AXxxxxx..."
                  />
                </div>
                
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    className="secondary" 
                    onClick={() => {
                      setStep('credentials');
                      setShowGDriveSetup(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    className="primary" 
                    onClick={submitAuthCode}
                    disabled={loading || !authCode}
                  >
                    {loading ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button 
            className="secondary" 
            onClick={() => setShowGDriveSetup(true)}
            style={{ width: '100%' }}
          >
            + Connect Google Drive
          </button>
        )}
      </div>
    </>
  );
}
