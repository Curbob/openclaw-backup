import { useState } from 'react';

interface Snapshot {
  id: string;
  timestamp: string;
  sourcePath: string;
  totalFiles: number;
  totalBytes: number;
}

interface Props {
  snapshot: Snapshot;
  onClose: () => void;
}

export default function RestoreModal({ snapshot, onClose }: Props) {
  const [restoreMode, setRestoreMode] = useState<'original' | 'custom'>('original');
  const [targetPath, setTargetPath] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState(0);

  async function startRestore() {
    setRestoring(true);
    setProgress(0);

    try {
      const res = await fetch('/api/restore/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId: snapshot.id,
          targetPath: restoreMode === 'custom' ? targetPath : null,
        }),
      });
      
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to start restore');
        setRestoring(false);
        return;
      }

      // Poll progress
      const interval = setInterval(async () => {
        const statusRes = await fetch('/api/restore/status');
        const status = await statusRes.json();
        
        if (!status.running) {
          clearInterval(interval);
          setProgress(100);
          
          if (status.errors && status.errors.length > 0) {
            alert(`Restore completed with ${status.errors.length} error(s)`);
          }
          
          setTimeout(onClose, 1000);
        } else {
          const pct = status.filesTotal > 0 
            ? Math.round((status.filesRestored / status.filesTotal) * 100) 
            : 0;
          setProgress(pct);
        }
      }, 500);
    } catch (err) {
      console.error('Failed to start restore:', err);
      setRestoring(false);
      alert('Failed to start restore');
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>🔄 Restore Backup</h2>

        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Restoring snapshot from:
          </p>
          <p style={{ fontWeight: 500 }}>{formatDate(snapshot.timestamp)}</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {snapshot.totalFiles.toLocaleString()} files • {snapshot.sourcePath}
          </p>
        </div>

        {!restoring ? (
          <>
            <div className="form-group">
              <label>Restore Location</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="radio"
                    name="restoreMode"
                    checked={restoreMode === 'original'}
                    onChange={() => setRestoreMode('original')}
                  />
                  Original location
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="radio"
                    name="restoreMode"
                    checked={restoreMode === 'custom'}
                    onChange={() => setRestoreMode('custom')}
                  />
                  Custom location
                </label>
              </div>
            </div>

            {restoreMode === 'custom' && (
              <div className="form-group">
                <label>Target Path</label>
                <input
                  type="text"
                  placeholder="/path/to/restore"
                  value={targetPath}
                  onChange={(e) => setTargetPath(e.target.value)}
                />
              </div>
            )}

            <div
              style={{
                padding: '1rem',
                background: 'rgba(243, 156, 18, 0.1)',
                borderRadius: '8px',
                marginBottom: '1rem',
              }}
            >
              <p style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>
                ⚠️ Existing files will be overwritten. Make sure you have a recent
                backup before restoring.
              </p>
            </div>

            <div className="button-group">
              <button className="secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" onClick={startRestore}>
                Start Restore
              </button>
            </div>
          </>
        ) : (
          <div>
            <p style={{ marginBottom: '1rem' }}>
              {progress < 100 ? 'Restoring files...' : 'Restore complete!'}
            </p>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p
              style={{
                textAlign: 'center',
                marginTop: '0.5rem',
                color: 'var(--text-secondary)',
              }}
            >
              {progress}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
