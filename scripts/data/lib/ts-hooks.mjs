// Node 타입 제거는 확장자를 해석하지 않는다. .ts 파일의 확장자 없는 상대 import에 .ts를 붙인다(Vite 해석과 같게).
import { registerHooks } from 'node:module'
import { extname } from 'node:path'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromTs = context.parentURL?.startsWith('file:') && context.parentURL.endsWith('.ts')
    if (fromTs && /^\.\.?\//.test(specifier) && extname(specifier) === '') {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
