import { useTranslation } from 'react-i18next'

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  boxSizing: 'border-box',
  background: 'var(--miniapp-bg)',
  border: '1px solid var(--miniapp-border-soft)',
  borderRadius: 'var(--miniapp-radius-sm)',
  padding: '11px 12px',
  fontFamily: 'var(--miniapp-sans)',
  fontSize: 13,
  color: 'var(--miniapp-text-primary)',
  outline: 'none',
  colorScheme: 'dark',
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.6px',
  textTransform: 'uppercase',
  color: 'var(--miniapp-text-muted)',
}

const FIELD_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: 6,
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--miniapp-bg)',
  border: '1px solid var(--miniapp-border-soft)',
  borderRadius: 'var(--miniapp-radius-sm)',
  padding: '11px 12px',
  fontFamily: 'var(--miniapp-sans)',
  fontSize: 13,
  color: 'var(--miniapp-text-primary)',
  outline: 'none',
  colorScheme: 'dark',
}

const TIMEZONES = [
  'Asia/Aden',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Baghdad',
  'Asia/Tehran',
  'Asia/Qatar',
  'Asia/Kuwait',
  'Asia/Muscat',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Damascus',
  'Asia/Jerusalem',
  'Africa/Cairo',
  'Africa/Khartoum',
  'Africa/Tripoli',
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Casablanca',
  'Europe/Istanbul',
  'Europe/Athens',
  'Europe/Moscow',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

type RepeatType = 'daily' | 'weekly' | 'monthly' | 'cron'
type EndType = 'never' | 'on_date' | 'after_n_runs'

export interface ScheduleConfig {
  repeatType: RepeatType
  repeatTime: string
  cronExpression: string
  startDate: string
  endType: EndType
  endValue: string
  timezone: string
}

interface SchedulePickerProps {
  value: ScheduleConfig
  onChange: (config: ScheduleConfig) => void
}

function nowRoundedTo30(): string {
  const d = new Date()
  const mins = d.getMinutes()
  const rounded = mins >= 30 ? 60 : 30
  d.setMinutes(rounded, 0, 0)
  return d.toTimeString().slice(0, 5)
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function detectTimezone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (tz && TIMEZONES.includes(tz)) return tz
  if (tz && TIMEZONES.some((t) => t.includes(tz.split('/')[1]))) {
    const match = TIMEZONES.find((t) => t.includes(tz.split('/')[1]))
    if (match) return match
  }
  return 'Asia/Aden'
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  repeatType: 'daily',
  repeatTime: nowRoundedTo30(),
  cronExpression: '',
  startDate: todayDate(),
  endType: 'never',
  endValue: '',
  timezone: detectTimezone(),
}

export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
  const { t } = useTranslation()

  return (
    <div style={{ display: 'grid', gap: 12, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)' }}>
      <span style={LABEL_STYLE}>{t('campaigns.recurrenceSettings')}</span>

      {/* Repeat type */}
      <div style={FIELD_STYLE}>
        <span style={LABEL_STYLE}>{t('campaigns.repeat')}</span>
        <select
          value={value.repeatType}
          onChange={(e) => onChange({ ...value, repeatType: e.target.value as RepeatType })}
          style={SELECT_STYLE}
        >
          <option value="daily">{t('campaigns.daily')}</option>
          <option value="weekly">{t('campaigns.weekly')}</option>
          <option value="monthly">{t('campaigns.monthly')}</option>
          <option value="cron">{t('campaigns.cron')}</option>
        </select>
      </div>

      {/* Cron expression (shown only when cron is selected) */}
      {value.repeatType === 'cron' ? (
        <div style={FIELD_STYLE}>
          <span style={LABEL_STYLE}>{t('campaigns.cronExpression')}</span>
          <input
            type="text"
            placeholder="*/15 * * * *"
            value={value.cronExpression}
            onChange={(e) => onChange({ ...value, cronExpression: e.target.value })}
            style={INPUT_STYLE}
          />
        </div>
      ) : null}

      {/* Time */}
      <div style={FIELD_STYLE}>
        <span style={LABEL_STYLE}>{t('campaigns.repeatTime')}</span>
        <input
          type="time"
          value={value.repeatTime}
          onChange={(e) => onChange({ ...value, repeatTime: e.target.value })}
          style={INPUT_STYLE}
        />
      </div>

      {/* Start date */}
      <div style={FIELD_STYLE}>
        <span style={LABEL_STYLE}>{t('campaigns.startDate')}</span>
        <input
          type="date"
          value={value.startDate}
          onChange={(e) => onChange({ ...value, startDate: e.target.value })}
          style={INPUT_STYLE}
        />
      </div>

      {/* End repeat */}
      <div style={FIELD_STYLE}>
        <span style={LABEL_STYLE}>{t('campaigns.endRepeat')}</span>
        <select
          value={value.endType}
          onChange={(e) => onChange({ ...value, endType: e.target.value as EndType, endValue: e.target.value === 'never' ? '' : value.endValue })}
          style={SELECT_STYLE}
        >
          <option value="never">{t('campaigns.never')}</option>
          <option value="on_date">{t('campaigns.onDate')}</option>
          <option value="after_n_runs">{t('campaigns.afterNRuns')}</option>
        </select>
      </div>

      {value.endType === 'on_date' ? (
        <div style={FIELD_STYLE}>
          <span style={LABEL_STYLE}>{t('campaigns.endDate')}</span>
          <input
            type="date"
            value={value.endValue}
            onChange={(e) => onChange({ ...value, endValue: e.target.value })}
            style={INPUT_STYLE}
          />
        </div>
      ) : value.endType === 'after_n_runs' ? (
        <div style={FIELD_STYLE}>
          <span style={LABEL_STYLE}>{t('campaigns.maxRuns')}</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={value.endValue || '10'}
            onChange={(e) => onChange({ ...value, endValue: String(Math.max(1, parseInt(e.target.value, 10) || 1)) })}
            style={INPUT_STYLE}
          />
        </div>
      ) : null}

      {/* Timezone */}
      <div style={FIELD_STYLE}>
        <span style={LABEL_STYLE}>{t('campaigns.timezone')}</span>
        <select
          value={value.timezone}
          onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          style={SELECT_STYLE}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
