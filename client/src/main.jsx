import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthProvider.jsx'
import { ToastProvider } from './context/ToastProvider.jsx'
import NativeBridge from './native/NativeBridge.jsx'
import { bootNative } from './native/boot.js'
import { isNative } from './native/platform.js'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
})

const start = () =>
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <NativeBridge />
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )

// In the phone app the saved sign-in is read from secure storage before the first screen is drawn.
bootNative().then(start, start)

// Lets the browser offer "Install app". Only in the built site: the development server must not cache anything.
// Not in the phone app: it is already installed, and the app's own files are inside it.
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installing as an app is an extra; the site works without it.
    })
  })
}
