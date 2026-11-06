// 레귤레이션 스냅샷 생성: npm run gen:snapshot [-- --force] [--out-root <dir>] [--cache-dir <dir>] [--record-hashes]
//   --force          frozen 레귤레이션도 다시 만든다.
//   --out-root       생성물 기준 디렉터리(기본: 저장소 루트). 재현성 확인용.
//   --cache-dir      PokeAPI CSV 캐시(기본: <root>/.cache). 캐시가 있으면 네트워크를 쓰지 않는다.
//   --record-hashes  해시가 비어 있는 PokeAPI 파일을 받아 sources.config.json에 sha256을 기록한다.
import { resolve } from 'node:path'
import { buildAll } from './lib/pipeline.mjs'

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a}에 값이 필요하다`)
      return resolve(v)
    }
    if (a === '--force') opts.force = true
    else if (a === '--record-hashes') opts.recordHashes = true
    else if (a === '--out-root') opts.outRoot = value()
    else if (a === '--cache-dir') opts.cacheDir = value()
    else throw new Error(`알 수 없는 옵션: ${a}`)
  }
  return opts
}

try {
  const result = await buildAll({ ...parseArgs(process.argv.slice(2)), log: (m) => console.log(m) })
  console.log(`생성: ${result.generated.join(', ') || '없음'} / 동결 유지: ${result.skipped.join(', ') || '없음'}`)
  console.log(`파일 ${result.files.length}개 기록`)
} catch (e) {
  console.error(`gen:snapshot 실패: ${e.message}`)
  process.exitCode = 1
}
