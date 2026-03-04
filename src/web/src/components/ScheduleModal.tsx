import { useState, useEffect } from 'react';

interface ScheduleState {
  enabled: boolean;
  cron: string;
  timezone: string;
  running: boolean;
  lastRun: string | null;
  lastResult: 'success' | 'failed' | null;
  lastError: string | null;
  nextRun: string | null;
  backupInProgress: boolean;
}

interface Props {
  onClose: () => void;
}

export default function ScheduleModal({ onClose }: Props) {
  const [schedule, setSchedule] = useState<ScheduleState | null>(null);
  const [frequency, setFrequency] = useState('daily');
  const [time, setTime] = useState('22:00');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSchedule();
  }, []);

  async function fetchSchedule() {
    try {
      const res = await fetch('/api/schedule');
      const data = await res.json() as ScheduleState;
      setSchedule(data);
      
      // Parse cron to set UI fields
      if (data.cron) {
        const [minute, hour, , , dayOfWeek] = data.cron.split(' ');
        
        if (minute === '0' && hour === '*') {
          setFrequency('hourly');
        } else if (dayOfWeek !== '*') {
          setFrequency('weekly');
        } else {
          setFrequency('daily');
        }
        
        if (hour !== '*' && minute !== '*') {
          setTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
        }
      }
    } catch (err) {
      console.error('Failed to fetch schedule:', err);
    }
  }

  async function saveSchedule() {
    if (!schedule) return;
    
    setLoading(true);
    
    // Convert UI values to cron
    const [hour, minute] = time.split(':');
    let cron = '';
    
    switch (frequency) {
      case 'hourly':
        cron = '0 * * * *';
        break;
      case 'daily':
        cron = `${parseInt(minute)} ${parseInt(hour)} * * *`;
        break;
      case 'weekly':
        cron = `${parseInt(minute)} ${parseInt(hour)} * * 0`;
        break;
    }

    try {
      const res = await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: schedule.enabled,
          cron,
          timezone: schedule.timezone,
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to save schedule');
        return;
      }
      
      onClose();
    } catch (err) {
      console.error('Failed to save schedule:', err);
      alert('Failed to save schedule');
    } finally {
      setLoading(false);
    }
  }

  async function toggleScheduler() {
    if (!schedule) return;
    
    try {
      if (schedule.running) {
        await fetch('/api/schedule/stop', { method: 'POST' });
      } else {
        await fetch('/api/schedule/start', { method: 'POST' });
      }
      fetchSchedule();
    } catch (err) {
      console.error('Failed to toggle scheduler:', err);
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  if (!schedule) {
    return (
      <div className="modal-overlay">
        <div className="modal">Loading...</div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>📅 Backup Schedule</h2>

        {/* Status */}
        {schedule.enabled && (
          <div style={{
            padding: '0.75rem',
            background: schedule.running 
              ? 'rgba(46, 204, 113, 0.1)' 
              : 'rgba(243, 156, 18, 0.1)',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.875rem',
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '0.5rem',
            }}>
              <span style={{ 
                color: schedule.running ? 'var(--success)' : 'var(--warning)' 
              }}>
                {schedule.running ? '● Running' : '○ Stopped'}
              </span>
              <button
                className="secondary"
                onClick={toggleScheduler}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                {schedule.running ? 'Stop' : 'Start'}
              </button>
            </div>
            
            {schedule.nextRun && (
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                Next: {formatDate(schedule.nextRun)}
              </p>
            )}
            
            {schedule.lastRun && (
              <p style={{ 
                color: schedule.lastResult === 'failed' ? 'var(--accent)' : 'var(--text-secondary)', 
                margin: '0.25rem 0 0 0',
                fontSize: '0.8125rem',
              }}>
                Last: {formatDate(schedule.lastRun)} 
                {schedule.lastResult === 'failed' && schedule.lastError && (
                  <> — {schedule.lastError}</>
                )}
              </p>
            )}
          </div>
        )}

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
              style={{ marginRight: '0.5rem' }}
            />
            Enable scheduled backups
          </label>
        </div>

        <div className="form-group">
          <label>Frequency</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            disabled={!schedule.enabled}
          >
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly (Sunday)</option>
          </select>
        </div>

        {frequency !== 'hourly' && (
          <div className="form-group">
            <label>Time</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!schedule.enabled}
            />
          </div>
        )}

        <div className="form-group">
          <label>Timezone</label>
          <select
            value={schedule.timezone}
            onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value })}
            disabled={!schedule.enabled}
          >
            <option value="America/New_York">Eastern Time</option>
            <option value="America/Chicago">Central Time</option>
            <option value="America/Denver">Mountain Time</option>
            <option value="America/Los_Angeles">Pacific Time</option>
            <option value="UTC">UTC</option>
            <option value="Europe/London">London</option>
            <option value="Europe/Paris">Paris</option>
            <option value="Asia/Tokyo">Tokyo</option>
          </select>
        </div>

        <div className="button-group" style={{ marginTop: '1.5rem' }}>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="primary" 
            onClick={saveSchedule}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
