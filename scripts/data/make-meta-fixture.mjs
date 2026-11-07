// 메타 테스트 픽스처: node scripts/data/make-meta-fixture.mjs <원천 chaos JSON> <출력 JSON>
// 원천 info는 그대로, 대상 종만 남기고 생성기가 읽는 필드만 담는다(동료는 가중값 상위 TEAMMATES개, 동률 키 순).
import { readFileSync, writeFileSync } from 'node:fs'
import { cmp } from './lib/util.mjs'

const SPECIES = [
  'Lycanroc-Dusk',
  'Aerodactyl',
  'Meowstic-F-Mega',
  'Meowstic-M-Mega',
  'Charizard',
  'Medicham-Mega',
  'Pidgeot-Mega',
  'Toxtricity',
  'Pinsir-Mega',
  'Quaquaval',
]
const FIELDS = ['Raw count', 'usage', 'Abilities', 'Items', 'Spreads', 'Moves']
const TEAMMATES = 12

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('사용법: node scripts/data/make-meta-fixture.mjs <원천.json> <출력.json>')
  process.exit(1)
}
const raw = JSON.parse(readFileSync(input, 'utf8'))
const data = {}
for (const key of SPECIES) {
  const e = raw.data[key]
  if (!e) throw new Error(`원천에 종 ${key}이 없다`)
  const out = {}
  for (const f of FIELDS) out[f] = e[f]
  const top = Object.entries(e.Teammates)
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
    .slice(0, TEAMMATES)
  out.Teammates = Object.fromEntries(top)
  data[key] = out
}
writeFileSync(output, JSON.stringify({ info: raw.info, data }) + '\n')
console.log(`${output}: ${SPECIES.length}종`)
