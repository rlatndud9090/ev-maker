import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './dev/App'
import { installPerfHook } from './dev/perf'
import './index.css'

installPerfHook()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
