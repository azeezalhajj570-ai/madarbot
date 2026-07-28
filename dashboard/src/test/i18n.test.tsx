import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider, useI18n } from '../lib/i18n'

function TestConsumer() {
  const { t, lang, setLang, dir } = useI18n()
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="app-name">{t('app.name')}</span>
      <span data-testid="missing-key">{t('key.does.not.exist')}</span>
      <button data-testid="set-ar" onClick={() => setLang('ar')}>AR</button>
      <button data-testid="set-en" onClick={() => setLang('en')}>EN</button>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('dir')
  document.documentElement.removeAttribute('lang')
})

describe('I18nProvider', () => {
  it('renders children', () => {
    render(<I18nProvider><div>hello</div></I18nProvider>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('defaults to English', () => {
    render(<I18nProvider><TestConsumer /></I18nProvider>)
    expect(screen.getByTestId('lang')).toHaveTextContent('en')
    expect(screen.getByTestId('dir')).toHaveTextContent('ltr')
  })

  it('sets Arabic language', () => {
    render(<I18nProvider><TestConsumer /></I18nProvider>)
    fireEvent.click(screen.getByTestId('set-ar'))
    expect(screen.getByTestId('lang')).toHaveTextContent('ar')
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl')
  })

  it('persists language to localStorage', () => {
    render(<I18nProvider><TestConsumer /></I18nProvider>)
    fireEvent.click(screen.getByTestId('set-ar'))
    expect(localStorage.getItem('lang')).toBe('ar')
  })

  it('sets documentElement.dir and lang', () => {
    render(<I18nProvider><TestConsumer /></I18nProvider>)
    fireEvent.click(screen.getByTestId('set-ar'))
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
  })

  it('returns English translation for existing key', () => {
    render(<I18nProvider><TestConsumer /></I18nProvider>)
    expect(screen.getByTestId('app-name')).toHaveTextContent('MadarBot')
  })

  it('falls back to key when translation is missing', () => {
    render(<I18nProvider><TestConsumer /></I18nProvider>)
    expect(screen.getByTestId('missing-key')).toHaveTextContent('key.does.not.exist')
  })

  it('returns Arabic translation for existing key', () => {
    render(<I18nProvider><TestConsumer /></I18nProvider>)
    fireEvent.click(screen.getByTestId('set-ar'))
    expect(screen.getByTestId('app-name')).toHaveTextContent('مداربوت')
  })
})
