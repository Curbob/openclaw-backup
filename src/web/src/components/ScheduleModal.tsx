import { useState, useEffect } from 'react';

interface Schedule {
  enabled: boolean;
  cron: string;
  timezone: string;
}

interface Props {
  onClose: () => void;
}

export default function ScheduleModal({ onClose }: Props) {
  const [schedule, setSchedule] = useState<Schedule>({
    enabled: false,
    cron: '0 22 * * *',
    timezone: 'America/New_York',
  });
  const [frequency, setFrequency] = useState('daily');
  const [time, setTime] = useState('22:00');

  useEffect(() => {
    fetchSchedule();
  }, []);

  async function fetchSchedule() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSchedule(data.schedule);
      
      // Parse cron to set UI fields
      const [minute, hour] = data.schedule.cron.split(' ');
      setTime(`${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`);
    } catch (err) {
      console.error('Failed to fetch schedule:', err);
    }
  }

  async function saveSchedule() {
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
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: {
            enabled: schedule.enabled,
            cron,
            timezone: schedule.timezone,
          },
        }),
      });
      onClose();
    } catch (err) {
      console.error('Failed to save schedule:', err);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>📅 Backup Schedule</h2>

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
            <option value="weekly">Weekly</option>
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
          </select>
        </div>

        <div className="button-group" style={{ marginTop: '1.5rem' }}>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={saveSchedule}>
            Save Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
