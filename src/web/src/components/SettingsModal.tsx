import { useState, useEffect } from 'react';

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

  async function setupEncryption() {
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    if (password.length < 12) {
      alert('Password must be at least 12 characters');
      return;
    }

    try {
      await fetch('/api/settings/encryption/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setPassword('');
      setConfirmPassword('');
      fetchSettings();
    } catch (err) {
      console.error('Failed to setup encryption:', err);
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
                  />
                </div>

                <div className="form-group">
                  <label>Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                  />
                </div>

                <button
                  className="primary"
                  onClick={setupEncryption}
                  disabled={password.length < 12 || password !== confirmPassword}
                >
                  Enable Encryption
                </button>
              </>
            )}
          </>
        )}

        {/* Destinations Tab */}
        {activeTab === 'destinations' && (
          <>
            <ul className="snapshot-list">
              {settings.destinations.map((dest) => (
                <li key={dest.id} className="snapshot-item">
                  <div className="snapshot-info">
                    <span className="snapshot-date">
                      {dest.name} {dest.primary && '⭐'}
                    </span>
                    <span className="snapshot-meta">
                      {dest.type} • {dest.path}
                    </span>
                  </div>
                  <div className="snapshot-actions">
                    <button className="secondary" style={{ fontSize: '0.75rem' }}>
                      Test
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <button
              className="secondary"
              style={{ marginTop: '1rem', width: '100%' }}
            >
              + Add Destination
            </button>
          </>
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
