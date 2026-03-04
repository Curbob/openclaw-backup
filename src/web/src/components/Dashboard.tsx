interface BackupStatus {
  running: boolean;
  phase: 'idle' | 'scanning' | 'processing' | 'finalizing';
  lastRun: string | null;
  lastDuration: number | null;
  currentFile: string | null;
  filesScanned: number;
  filesTotal: number;
  filesProcessed: number;
  chunksProcessed: number;
  chunksNew: number;
  chunksReused: number;
  bytesProcessed: number;
  bytesStored: number;
  encryptionConfigured: boolean;
  errors: string[];
  stats?: {
    totalSnapshots: number;
    totalChunks: number;
    totalBytes: number;
    deduplicatedBytes: number;
  };
}

interface Snapshot {
  id: string;
  timestamp: string;
  sourcePath: string;
  totalFiles: number;
  totalBytes: number;
  encrypted: boolean;
}

interface Props {
  status: BackupStatus | null;
  snapshots: Snapshot[];
  onBackup: () => void;
  onStop: () => void;
  onSchedule: () => void;
  onRestore: (snapshot: Snapshot) => void;
  onSettings: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export default function Dashboard({
  status,
  snapshots,
  onBackup,
  onStop,
  onSchedule,
  onRestore,
  onSettings,
}: Props) {
  return (
    <div className="dashboard">
      {/* Quick Actions */}
      <div className="card">
        <h2>Quick Actions</h2>
        
        {/* Encryption warning */}
        {status && !status.encryptionConfigured && (
          <div style={{
            padding: '0.75rem',
            background: 'rgba(243, 156, 18, 0.15)',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.875rem',
          }}>
            <span style={{ color: 'var(--warning)' }}>⚠️ Encryption not configured.</span>
            <br />
            <span style={{ color: 'var(--text-secondary)' }}>
              Go to Settings → Encryption to set up.
            </span>
          </div>
        )}
        
        <div className="button-group" style={{ flexDirection: 'column' }}>
          {status?.running ? (
            <button className="secondary" onClick={onStop}>
              ⏹️ Stop Backup
            </button>
          ) : (
            <button 
              className="primary" 
              onClick={onBackup}
              disabled={!status?.encryptionConfigured}
            >
              ▶️ Backup Now
            </button>
          )}
          <button 
            className="secondary" 
            onClick={() => snapshots[0] && onRestore(snapshots[0])}
            disabled={snapshots.length === 0}
          >
            🔄 Restore Latest
          </button>
          <button className="secondary" onClick={onSchedule}>
            📅 Schedule
          </button>
          <button className="secondary" onClick={onSettings}>
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Status */}
      <div className="card">
        <h2>{status?.running ? 'Backup Progress' : 'Last Backup'}</h2>
        
        {status?.running ? (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <span style={{ 
                display: 'inline-block',
                padding: '0.25rem 0.5rem',
                background: 'rgba(230, 57, 70, 0.15)',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: 'var(--accent)',
                textTransform: 'uppercase',
              }}>
                {status.phase === 'scanning' ? '📂 Scanning' :
                 status.phase === 'processing' ? '⚙️ Processing' :
                 status.phase === 'finalizing' ? '✨ Finalizing' : status.phase}
              </span>
            </div>
            
            {status.currentFile && (
              <p style={{ 
                fontSize: '0.8125rem', 
                color: 'var(--text-secondary)',
                marginBottom: '0.5rem',
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {status.currentFile}
              </p>
            )}
            
            <div className="stats">
              <div className="stat">
                <div className="stat-value">
                  {status.phase === 'scanning' 
                    ? status.filesScanned 
                    : `${status.filesProcessed}/${status.filesTotal}`}
                </div>
                <div className="stat-label">Files</div>
              </div>
              <div className="stat">
                <div className="stat-value">{status.chunksNew}</div>
                <div className="stat-label">New</div>
              </div>
              <div className="stat">
                <div className="stat-value">{status.chunksReused}</div>
                <div className="stat-label">Reused</div>
              </div>
            </div>
            
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ 
                  width: status.phase === 'scanning' ? '10%' :
                         status.filesTotal 
                           ? `${Math.round((status.filesProcessed / status.filesTotal) * 100)}%` 
                           : '0%' 
                }}
              />
            </div>
            
            {status.errors.length > 0 && (
              <p style={{ 
                fontSize: '0.75rem', 
                color: 'var(--warning)',
                marginTop: '0.5rem',
              }}>
                ⚠️ {status.errors.length} error(s)
              </p>
            )}
          </>
        ) : status?.lastRun ? (
          <div className="stats">
            <div className="stat">
              <div className="stat-value">{status.chunksProcessed}</div>
              <div className="stat-label">Chunks</div>
            </div>
            <div className="stat">
              <div className="stat-value">{formatBytes(status.bytesProcessed)}</div>
              <div className="stat-label">Processed</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {status.lastDuration ? formatDuration(status.lastDuration) : '-'}
              </div>
              <div className="stat-label">Duration</div>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)' }}>No backups yet</p>
        )}
      </div>

      {/* Storage Stats */}
      {status?.stats && status.stats.totalSnapshots > 0 && (
        <div className="card">
          <h2>Storage</h2>
          <div className="stats">
            <div className="stat">
              <div className="stat-value">{status.stats.totalSnapshots}</div>
              <div className="stat-label">Snapshots</div>
            </div>
            <div className="stat">
              <div className="stat-value">{status.stats.totalChunks}</div>
              <div className="stat-label">Chunks</div>
            </div>
            <div className="stat">
              <div className="stat-value">{formatBytes(status.stats.totalBytes)}</div>
              <div className="stat-label">Stored</div>
            </div>
          </div>
          {status.stats.deduplicatedBytes > 0 && (
            <p style={{ 
              fontSize: '0.75rem', 
              color: 'var(--success)',
              marginTop: '0.75rem',
              textAlign: 'center',
            }}>
              💾 {formatBytes(status.stats.deduplicatedBytes)} saved via deduplication
            </p>
          )}
        </div>
      )}

      {/* Snapshots */}
      <div className="card card-large">
        <h2>Recent Snapshots</h2>
        {snapshots.length > 0 ? (
          <ul className="snapshot-list">
            {snapshots.map((snap) => (
              <li key={snap.id} className="snapshot-item">
                <div className="snapshot-info">
                  <span className="snapshot-date">{formatDate(snap.timestamp)}</span>
                  <span className="snapshot-meta">
                    {snap.totalFiles.toLocaleString()} files • {formatBytes(snap.totalBytes)}
                    {snap.encrypted && ' • 🔒'}
                  </span>
                </div>
                <div className="snapshot-actions">
                  <button className="secondary" onClick={() => onRestore(snap)}>
                    Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--text-secondary)' }}>No snapshots yet. Run your first backup!</p>
        )}
      </div>
    </div>
  );
}
