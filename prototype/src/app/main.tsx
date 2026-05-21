import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import '../index.css'
import { App } from './App'
import { createChronicaeI18n } from '../i18n'
import { createWebResourceLoader } from '../i18n/loaders/webResourceLoader'

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')

async function main(): Promise<void> {
  const i18n = await createChronicaeI18n({
    locale: 'en',
    fallbackLocale: 'en',
    resourceLoader: createWebResourceLoader(),
    preloadLocales: ['en', 'ja'],
  })

  createRoot(root!).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </StrictMode>,
  )
}

void main()
