import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import ar from './locales/ar.json'

const isDev = import.meta.env.DEV

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
  saveMissing: isDev,
  missingKeyHandler: isDev
    ? (lng, ns, key) => {
        console.warn(`[i18n] Missing translation key: "${key}" for locale "${lng}"`)
      }
    : undefined,
})

export default i18n
