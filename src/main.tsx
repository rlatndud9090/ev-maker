import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { ProductApp } from './app/ProductApp'
import { installPerfHook } from './app/perf'
import './index.css'

// dev 화면은 지연 청크로만 들어온다(제품 진입 번들에 섞이지 않게).
const dev = { App: lazy(() => import('./dev/App').then((m) => ({ default: m.App }))) }

installPerfHook()

const root = createRoot(document.getElementById('root')!)

function render() {
  root.render(
    <StrictMode>
      {location.hash.startsWith('#/dev') ? (
        <Suspense fallback={<p className="hint">개발용 화면을 불러오는 중…</p>}>
          <dev.App />
        </Suspense>
      ) : (
        <ProductApp />
      )}
    </StrictMode>,
  )
}

window.addEventListener('hashchange', render)
render()
