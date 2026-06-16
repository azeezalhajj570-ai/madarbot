import i18next from 'i18next'

function locale(): string {
  return i18next.language || 'en'
}

export function formatDate(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (isNaN(d.getTime())) return String(date)
  return new Intl.DateTimeFormat(locale(), options).format(d)
}

export function formatTime(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (isNaN(d.getTime())) return String(date)
  return new Intl.DateTimeFormat(locale(), { ...options, hour: '2-digit', minute: '2-digit' }).format(d)
}

export function formatDateTime(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (isNaN(d.getTime())) return String(date)
  return new Intl.DateTimeFormat(locale(), {
    dateStyle: 'short',
    timeStyle: 'short',
    ...options,
  }).format(d)
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale(), options).format(n)
}
