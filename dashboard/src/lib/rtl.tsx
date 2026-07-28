import { useI18n } from './i18n'

export function useDirectional<T>(ltr: T, rtl: T): T {
  const { dir } = useI18n()
  return dir === 'rtl' ? rtl : ltr
}

export function useTranslateX(value: number): number {
  const { dir } = useI18n()
  return dir === 'rtl' ? -value : value
}
