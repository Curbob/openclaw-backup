import { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import ScheduleModal from './components/ScheduleModal';
import RestoreModal from './components/RestoreModal';
import SettingsModal from './components/SettingsModal';

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

export default function App() {
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    fetchStatus();
    fetchSnapshots();
  }, []);

  // Poll status more frequently when backup is running
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
      if (backupStatus?.running) {
        // Poll faster during backup
      }
    }, backupStatus?.running ? 500 : 5000);

    return () => clearInterval(interval);
  }, [backupStatus?.running]);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/backup/status');
      const data = await res.json();
      setBackupStatus(data);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  }

  async function fetchSnapshots() {
    try {
      const res = await fetch('/api/snapshots');
      const data = await res.json();
      setSnapshots(data.snapshots);
    } catch (err) {
      console.error('Failed to fetch snapshots:', err);
    }
  }

  async function startBackup() {
    try {
      const res = await fetch('/api/backup/start', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to start backup');
        return;
      }
      fetchStatus();
      
      // Poll until backup completes, then refresh snapshots
      const pollUntilDone = setInterval(async () => {
        const statusRes = await fetch('/api/backup/status');
        const status = await statusRes.json();
        if (!status.running) {
          clearInterval(pollUntilDone);
          fetchSnapshots();
        }
      }, 1000);
    } catch (err) {
      console.error('Failed to start backup:', err);
    }
  }

  async function stopBackup() {
    try {
      await fetch('/api/backup/stop', { method: 'POST' });
      fetchStatus();
    } catch (err) {
      console.error('Failed to stop backup:', err);
    }
  }

  function handleRestore(snapshot: Snapshot) {
    setSelectedSnapshot(snapshot);
    setShowRestore(true);
  }

  return (
    <div className="container">
      <header>
        <h1>
          <span>🦞</span>
          OpenClaw Backup
        </h1>
        <div className={`status-badge ${backupStatus?.running ? 'running' : 'ok'}`}>
          <span>●</span>
          {backupStatus?.running ? 'Backup Running' : 'Ready'}
        </div>
      </header>

      <Dashboard
        status={backupStatus}
        snapshots={snapshots}
        onBackup={startBackup}
        onStop={stopBackup}
        onSchedule={() => setShowSchedule(true)}
        onRestore={handleRestore}
        onSettings={() => setShowSettings(true)}
      />

      {showSchedule && (
        <ScheduleModal onClose={() => setShowSchedule(false)} />
      )}

      {showRestore && selectedSnapshot && (
        <RestoreModal
          snapshot={selectedSnapshot}
          onClose={() => {
            setShowRestore(false);
            setSelectedSnapshot(null);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
