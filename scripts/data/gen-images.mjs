// 포켓몬·도구 이미지 생성: npm run gen:images [-- --force] [--cache-dir <dir>]
//   현재 스냅샷 로스터(src/data/regulations/*/data.json 종 + 메타 등장 종)의 Champions 메뉴 아이콘과 반감열매 Bag 스프라이트를
//   1회 내려받아 src/assets/pokemon-icons/{speciesId}.png, src/assets/item-icons/{itemId}.png로 저장한다(앱은 같은 출처 정적 파일만 쓴다).
//   --force      이미 받은 파일도 다시 받는다. 내용이 직전 매니페스트 sha256과 다르면 WARNING.
//   --cache-dir  PokeAPI CSV 캐시(기본: <root>/.cache, gen:snapshot과 같은 sha256 검증).
// 멱등·재현: 직전 매니페스트와 비교해 파일이 없거나, 원천(포켓몬 src = PokeAPI 파일 이름, 도구 file + 원천 판 sha1)이 바뀌었거나,
//   디스크 내용이 매니페스트 sha256과 다르면 다시 받는다. 그 밖은 건너뛴다.
// 도구(Bulbagarden)는 Special:FilePath가 늘 최신 판이라 imageinfo API로 현재 판의 올린 시각·sha1을 받아 매니페스트에 기록하고,
//   받은 바이트의 sha1이 그 판과 같은지 확인한다(판이 바뀌면 다시 받고 WARNING).
// 매니페스트(manifest.json)는 디스크에 있는 파일만 기록한다. 실패·매핑 실패는 manifest.missing과 콘솔에 남는다.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PROJECT_ROOT, readProjectJson } from './lib/pipeline.mjs'
import { ensurePokeapiFile } from './lib/ko.mjs'
import { cmp, parseCsv, sha256, stableStringify } from './lib/util.mjs'
import {
  BULBA_CATEGORY,
  HAND_POKEAPI_IDS,
  ITEM_ICON_IDS,
  POKEMON_ICON_SOURCE,
  bagSpriteFile,
  bulbaFilePathUrl,
  bulbaImageInfoUrl,
  needsDownload,
  parseBulbaImageInfo,
  pokemonIconUrl,
  resolvePokeapiIds,
  rosterOf,
  sameImageGroups,
} from './lib/images.mjs'

const UA = 'ev-maker-image-gen/1.0 (non-commercial fan tool; one-time build-time download)'
const POKEMON_DIR = join(PROJECT_ROOT, 'src/assets/pokemon-icons')
const ITEM_DIR = join(PROJECT_ROOT, 'src/assets/item-icons')
const PNG_MAGIC = '89504e470d0a1a0a'

const argv = process.argv.slice(2)
const FORCE = argv.includes('--force')
const cacheIdx = argv.indexOf('--cache-dir')
const CACHE_DIR = cacheIdx >= 0 ? resolve(argv[cacheIdx + 1]) : join(PROJECT_ROOT, '.cache')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')
const warnings = []
const warn = (msg) => warnings.push(msg)

/** 200이면 본문 바이트, 404면 null, 그 밖은 재시도 후 예외. */
async function fetchBytes(url, { tries = 4, delay = 400, check } = {}) {
  let last
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      check?.(buf, res)
      return buf
    } catch (e) {
      last = e
      await sleep(delay * attempt)
    }
  }
  throw last
}

/** PNG 시그니처가 아니면 실패로 본다(이미지 외 파일은 쓰지 않는다). */
const fetchPng = (url, opts) =>
  fetchBytes(url, {
    ...opts,
    check: (buf, res) => {
      if (buf.subarray(0, 8).toString('hex') !== PNG_MAGIC) throw new Error(`PNG 아님(${res.headers.get('content-type')})`)
    },
  })

/** PNG IHDR의 가로·세로. */
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) })

const diskSha = (file) => (existsSync(file) ? sha256(readFileSync(file)) : undefined)

function readPrevManifest(dir) {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')).entries ?? {}
  } catch {
    return {}
  }
}

function readSnapshots() {
  const index = readProjectJson('src/data/regulations/index.json')
  const snapshots = index.regulations.map((r) => readProjectJson(`src/data/regulations/${r.id}/data.json`))
  const metaIndex = readProjectJson('src/data/meta/index.json')
  const metaIds = []
  for (const items of Object.values(metaIndex.regulations ?? {})) {
    for (const it of items) for (const e of readProjectJson(`src/data/meta/${it.file}`).entries) metaIds.push(e.id)
  }
  return { snapshots, metaIds }
}

async function pokemonIcons(snapshots, metaIds) {
  const config = readProjectJson('scripts/data/sources.config.json')
  const formsFile = 'pokemon_forms.csv'
  const { buf } = await ensurePokeapiFile(config.ko, CACHE_DIR, config.ko.csvDir + formsFile, config.ko.files[formsFile])
  const { species, missingMeta } = rosterOf(snapshots, metaIds)
  const { resolved, unresolved } = resolvePokeapiIds(species, parseCsv(buf.toString('utf8')))
  const missing = [...unresolved, ...missingMeta.map((id) => ({ id, reason: '메타 등장 종이 스냅샷에 없음' }))]
  const prev = readPrevManifest(POKEMON_DIR)
  mkdirSync(POKEMON_DIR, { recursive: true })
  let downloaded = 0
  for (const [id, r] of Object.entries(resolved)) {
    const file = join(POKEMON_DIR, `${id}.png`)
    // 예전 매니페스트(src 없음)는 pokeapiId가 곧 원천 파일 이름이었다
    const p = prev[id] && { ...prev[id], src: prev[id].src ?? String(prev[id].pokeapiId) }
    if (!needsDownload({ force: FORCE, prev: p, want: r.src, wantKey: 'src', sha: diskSha(file) })) continue
    try {
      const png = await fetchPng(pokemonIconUrl(r.src))
      if (!png) missing.push({ id, reason: `원천에 ${r.src}.png 없음(404)` })
      else {
        if (p && p.src === r.src && p.sha256 !== sha256(png)) warn(`포켓몬 ${id}: 같은 원천(${r.src}.png)인데 내용이 직전 매니페스트와 다름`)
        writeFileSync(file, png)
        downloaded++
      }
    } catch (e) {
      missing.push({ id, reason: `다운로드 실패: ${e.message}` })
    }
    await sleep(60)
  }
  const entries = {}
  for (const [id, r] of Object.entries(resolved)) {
    const file = join(POKEMON_DIR, `${id}.png`)
    if (!existsSync(file) || missing.some((m) => m.id === id)) continue
    const png = readFileSync(file)
    entries[id] = { pokeapiId: r.pokeapiId, src: r.src, via: r.via, sha256: sha256(png), ...pngSize(png) }
  }
  // 이번에 못 받은(매핑 실패·404) id의 예전 파일은 지운다(잘못된 그림 대신 빈 자리)
  for (const m of missing) rmSync(join(POKEMON_DIR, `${m.id}.png`), { force: true })
  const same = sameImageGroups(entries)
  for (const g of same.unexpected) warn(`포켓몬 같은 그림(알려지지 않은 묶음): ${g.join(', ')}`)
  const manifest = {
    source: {
      repo: POKEMON_ICON_SOURCE.repo,
      commit: POKEMON_ICON_SOURCE.commit,
      dir: POKEMON_ICON_SOURCE.dir,
      url: pokemonIconUrl('{src}'),
      idMapping: `PokeAPI/pokeapi ${config.ko.csvDir}${formsFile} @ ${config.ko.commit} (sha256 ${config.ko.files[formsFile]}) + 손 매핑 ${Object.keys(HAND_POKEAPI_IDS).length}건`,
    },
    entries,
    missing: missing.sort((a, b) => cmp(a.id, b.id)),
    // 상류 원천에서 서로 다른 폼이 같은 그림(화면에서 구분 안 됨, 알려진 한계)
    sameImage: [...same.known, ...same.unexpected],
  }
  writeFileSync(join(POKEMON_DIR, 'manifest.json'), stableStringify(manifest))
  return { roster: species.length, downloaded, count: Object.keys(entries).length, missing: manifest.missing, sameImage: manifest.sameImage }
}

async function itemIcons(snapshots) {
  mkdirSync(ITEM_DIR, { recursive: true })
  const prev = readPrevManifest(ITEM_DIR)
  const missing = []
  const files = {}
  for (const id of ITEM_ICON_IDS) {
    const en = snapshots.map((d) => d.items[id]?.name.en).find(Boolean)
    if (!en) missing.push({ id, reason: '스냅샷에 도구 없음' })
    else files[id] = bagSpriteFile(en)
  }
  const infoJson = await fetchBytes(bulbaImageInfoUrl(Object.values(files)), { delay: 1500 })
  if (!infoJson) throw new Error('Bulbagarden imageinfo API 404')
  const info = parseBulbaImageInfo(JSON.parse(infoJson.toString('utf8')))
  await sleep(1200)
  let downloaded = 0
  for (const [id, name] of Object.entries(files)) {
    const ii = info[name]
    if (!ii) {
      missing.push({ id, reason: `원천에 ${name} 없음(imageinfo missing)` })
      continue
    }
    const file = join(ITEM_DIR, `${id}.png`)
    const sha = diskSha(file)
    const stale = sha !== undefined && sha1(readFileSync(file)) !== ii.sha1
    if (!stale && !needsDownload({ force: FORCE, prev: prev[id], want: name, wantKey: 'file', sha })) continue
    if (stale) warn(`도구 ${id}: 원천 판이 바뀜(${prev[id]?.uploadedAt ?? '?'} → ${ii.timestamp}), 다시 받음`)
    try {
      const png = await fetchPng(ii.url ?? bulbaFilePathUrl(name), { delay: 1500 })
      if (!png) missing.push({ id, reason: `원천에 ${name} 없음(404)` })
      else if (sha1(png) !== ii.sha1) missing.push({ id, reason: `받은 파일 sha1이 원천 판(${ii.timestamp})과 다름` })
      else {
        if (prev[id] && prev[id].sha256 !== sha256(png)) warn(`도구 ${id}: 내용이 직전 매니페스트와 다름`)
        writeFileSync(file, png)
        downloaded++
      }
    } catch (e) {
      missing.push({ id, reason: `다운로드 실패: ${e.message}` })
    }
    await sleep(1200)
  }
  const entries = {}
  for (const [id, name] of Object.entries(files)) {
    const file = join(ITEM_DIR, `${id}.png`)
    if (!existsSync(file) || missing.some((m) => m.id === id)) continue
    const png = readFileSync(file)
    entries[id] = { file: name, uploadedAt: info[name].timestamp, sha1: info[name].sha1, sha256: sha256(png), ...pngSize(png) }
  }
  for (const m of missing) rmSync(join(ITEM_DIR, `${m.id}.png`), { force: true })
  const manifest = {
    source: {
      site: 'Bulbagarden Archives',
      category: BULBA_CATEGORY,
      url: bulbaFilePathUrl('{file}'),
      pinning: 'entries.uploadedAt·sha1 = 받은 시점 원천 판(MediaWiki imageinfo). 판이 바뀌면 gen:images가 다시 받고 경고한다.',
    },
    entries,
    missing: missing.sort((a, b) => cmp(a.id, b.id)),
  }
  writeFileSync(join(ITEM_DIR, 'manifest.json'), stableStringify(manifest))
  return { downloaded, count: Object.keys(entries).length, missing: manifest.missing }
}

const dirBytes = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .reduce((a, f) => a + statSync(join(dir, f)).size, 0)

const size = (bytes) => `${bytes.toLocaleString('en-US')} B (${(bytes / 1024 / 1024).toFixed(2)} MiB)`

try {
  const { snapshots, metaIds } = readSnapshots()
  const p = await pokemonIcons(snapshots, metaIds)
  console.log(`포켓몬 아이콘: 로스터 ${p.roster}, 새로 받음 ${p.downloaded}, 보유 ${p.count}, ${size(dirBytes(POKEMON_DIR))}`)
  for (const m of p.missing) console.log(`  WARNING 포켓몬 ${m.id}: ${m.reason}`)
  for (const g of p.sameImage) console.log(`  NOTICE 같은 그림(상류): ${g.join(', ')}`)
  const it = await itemIcons(snapshots)
  console.log(`도구 아이콘: 대상 ${ITEM_ICON_IDS.length}, 새로 받음 ${it.downloaded}, 보유 ${it.count}, ${size(dirBytes(ITEM_DIR))}`)
  for (const m of it.missing) console.log(`  WARNING 도구 ${m.id}: ${m.reason}`)
} catch (e) {
  console.error(`gen:images 실패: ${e.message}`)
  process.exitCode = 1
} finally {
  for (const w of warnings) console.log(`  WARNING ${w}`)
}
