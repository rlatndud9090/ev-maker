// 메타 스냅샷 생성·원천 기록 CLI: npm run gen:meta -- --regulation <id> --month <YYYY-MM> [옵션]
// 옵션은 README의 '메타 통계 스냅샷 생성' 절을 따른다.
import { resolve } from 'node:path'
import './lib/ts-hooks.mjs'

// 훅 등록 뒤에 불러야 src/core의 확장자 없는 import가 풀린다.
const { buildMeta } = await import('./lib/meta-pipeline.mjs')

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a}에 값이 필요하다`)
      return v
    }
    if (a === '--force') opts.force = true
    else if (a === '--record') opts.record = true
    else if (a === '--regulation') opts.regulation = value()
    else if (a === '--month') opts.month = value()
    else if (a === '--match') opts.match = [value()]
    else if (a === '--out-root') opts.outRoot = resolve(value())
    else if (a === '--cache-dir') opts.cacheDir = resolve(value())
    else throw new Error(`알 수 없는 옵션: ${a}`)
  }
  if (!opts.regulation || !opts.month) throw new Error('--regulation과 --month가 필요하다')
  return opts
}

try {
  const r = await buildMeta({ ...parseArgs(process.argv.slice(2)), log: (m) => console.log(m) })
  for (const x of r.recorded) console.log(`기록: ${x.regulation}/${x.month}-${x.match} sha256 ${x.sha256} 공개 ${x.publishedAt}`)
  if (!r.recorded.length) console.log(`생성: ${r.generated.join(', ') || '없음'} / 유지: ${r.skipped.join(', ') || '없음'}`)
  console.log(`파일 ${r.files.length}개 기록`)
} catch (e) {
  console.error(`gen:meta 실패: ${e.message}`)
  process.exitCode = 1
}
