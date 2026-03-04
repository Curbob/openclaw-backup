interface BackupStatus {
  running: boolean;
  lastRun: string | null;
  lastDuration: number | null;
  chunksProcessed: number;
  bytesProcessed: number;
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
        <div className="button-group" style={{ flexDirection: 'column' }}>
          {status?.running ? (
            <button className="secondary" onClick={onStop}>
              ⏹️ Stop Backup
            </button>
          ) : (
            <button className="primary" onClick={onBackup}>
              ▶️ Backup Now
            </button>
          )}
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
        <h2>Last Backup</h2>
        {status?.lastRun ? (
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

        {status?.running && (
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: '45%' }} // TODO: Calculate real progress
            />
          </div>
        )}
      </div>

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
