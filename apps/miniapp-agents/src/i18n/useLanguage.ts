import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'miniapp_language'

const SUPPORTED_LANGUAGES = ['en', 'ar'] as const
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function isValidLanguage(lng: string | null): lng is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lng as SupportedLanguage)
}

function getInitialLanguage(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && isValidLanguage(stored)) return stored

  const telegramLng = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.language_code
  if (telegramLng && isValidLanguage(telegramLng)) return telegramLng

  const browserLng = navigator.language?.slice(0, 2)
  if (browserLng && isValidLanguage(browserLng)) return browserLng

  return 'en'
}

export function setDocumentDirection(lng: string) {
  document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.lang = lng
}

export function useLanguage() {
  const { i18n } = useTranslation()

  const language = i18n.language

  const changeLanguage = useCallback(
    (lng: string) => {
      void i18n.changeLanguage(lng)
      localStorage.setItem(STORAGE_KEY, lng)
      setDocumentDirection(lng)
    },
    [i18n],
  )

  useEffect(() => {
    const initial = getInitialLanguage()
    void i18n.changeLanguage(initial)
    localStorage.setItem(STORAGE_KEY, initial)
    setDocumentDirection(initial)
  }, [i18n])

  return {
    language,
    changeLanguage,
    isRTL: language === 'ar',
  }
}
