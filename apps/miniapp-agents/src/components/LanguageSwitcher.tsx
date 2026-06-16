import { useLanguage } from '../i18n/useLanguage'

export function LanguageSwitcher() {
  const { language, changeLanguage, isRTL } = useLanguage()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: isRTL ? 'row-reverse' : 'row' }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)', whiteSpace: 'nowrap' }}>
        Language
      </label>
      <select
        value={language}
        onChange={(e) => changeLanguage(e.target.value)}
        style={{
          padding: '8px 12px',
          borderRadius: 10,
          border: '1px solid var(--miniapp-border)',
          background: 'var(--miniapp-surface)',
          color: 'var(--miniapp-text-primary)',
          fontSize: 14,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <option value="en">English</option>
        <option value="ar">العربية</option>
      </select>
    </div>
  )
}
