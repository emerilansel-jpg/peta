import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './lib/brand'  // hostname-aware brand swap (title, favicon, manifest)
import { installGlobalErrorHandler } from './components/ErrorBoundary';

// Install global error tracking (window.onerror, unhandled rejections)
installGlobalErrorHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
