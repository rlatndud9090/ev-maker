// 스냅샷 생성 파이프라인. 현재 시각·네트워크 조회 시각을 쓰지 않는다(원천 기준 시각은 고정 설정값).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SNAPSHOT_SCHEMA_VERSION } from '../../../src/data/schema.ts'
import { assertPinnedPackages, createPkmnSource } from './pkmn-source.mjs'
import { extractGameData, finalizeGameData, validateGameData } from './extract.mjs'
import { applyGameOverrides, KO_KINDS, validateGameOverrides, validateKoOverrides } from './overrides.mjs'
import { buildKoIndex, loadPokeapi, localize } from './ko.mjs'
import { compareWithEngine, loadEngine } from './engine.mjs'
import { diffSnapshots, renderDiffMd, renderInheritanceMd } from './reports.mjs'
import { buildLicenses } from './licenses.mjs'
import { PipelineError, cmp, deepEqual, isIsoInstant, stableStringify } from './util.mjs'

export { diffSnapshots } from './reports.mjs'
export { stableStringify, PipelineError } from './util.mjs'
export { compareWithEngine, loadEngine } from './engine.mjs'
export { buildLicenses } from './licenses.mjs'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
export const readProjectJson = (rel) => readJson(join(PROJECT_ROOT, rel))

export const paths = (outRoot, id) => ({
  index: join(outRoot, 'src/data/regulations/index.json'),
  manifest: join(outRoot, `src/data/regulations/${id}/manifest.json`),
  data: join(outRoot, `src/data/regulations/${id}/data.json`),
  reports: join(outRoot, `data/reports/${id}`),
  licenses: join(outRoot, 'src/data/licenses.json'),
  notices: join(outRoot, 'THIRD_PARTY_NOTICES.md'),
})

export function validateConfig(config) {
  const ids = config.regulations.map((r) => r.id)
  if (new Set(ids).size !== ids.length) throw new PipelineError('regulations id 중복')
  if (!ids.includes(config.default)) throw new PipelineError(`default ${config.default}가 regulations에 없음`)
  for (const r of config.regulations) {
    const w = `regulation ${r.id}`
    if (!/^[a-z0-9-]+$/.test(r.id)) throw new PipelineError(`${w}: id 형식`)
    if (typeof r.mode !== 'string' || !/^[a-z0-9]+$/.test(r.mode)) throw new PipelineError(`${w}: mode 형식`)
    if (typeof r.frozen !== 'boolean') throw new PipelineError(`${w}: frozen은 boolean`)
    if (typeof r.name !== 'string' || !r.name) throw new PipelineError(`${w}: name 필요`)
    const { level, spMaxPerStat, spTotal, start, end } = r.rules ?? {}
    for (const [k, v] of Object.entries({ level, spMaxPerStat, spTotal })) {
      if (!Number.isInteger(v) || v <= 0) throw new PipelineError(`${w}: rules.${k}=${v}`)
    }
    if (spTotal < spMaxPerStat) throw new PipelineError(`${w}: spTotal < spMaxPerStat`)
    if (!isIsoInstant(start) || !isIsoInstant(end) || Date.parse(start) >= Date.parse(end)) {
      throw new PipelineError(`${w}: rules 기간 ${start} ~ ${end}`)
    }
    if (!Array.isArray(r.period?.sources) || !r.period.sources.length) throw new PipelineError(`${w}: period.sources 필요`)
  }
  for (const [name, p] of Object.entries(config.gameData.packages)) {
    if (!isIsoInstant(p.publishedAt)) throw new PipelineError(`${name}: publishedAt 형식`)
  }
  if (!isIsoInstant(config.ko.committedAt)) throw new PipelineError('ko.committedAt 형식')
  if (!/^[0-9a-f]{40}$/.test(config.ko.commit)) throw new PipelineError('ko.commit은 40자 SHA')
}

/** 게임 데이터 원천 기준 시각: 고정한 패키지 배포 시각 중 가장 늦은 값. */
export const gameSourceTime = (config) =>
  Object.values(config.gameData.packages)
    .map((p) => p.publishedAt)
    .sort(cmp)
    .at(-1)

function buildManifest(config, reg, koHashes, unsupported, overridesApplied) {
  const pkgs = Object.keys(config.gameData.packages).sort(cmp)
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    regulation: { id: reg.id, name: reg.name },
    rules: { ...reg.rules },
    source: {
      gameData: {
        packages: Object.fromEntries(pkgs.map((p) => [p, config.gameData.packages[p].version])),
        integrity: Object.fromEntries(pkgs.map((p) => [p, config.gameData.packages[p].integrity])),
        mode: reg.mode,
        showdownCommitRef: config.gameData.showdownCommitRef.sha,
        sourceTime: gameSourceTime(config),
      },
      ko: {
        pokeapiCommit: config.ko.commit,
        files: { ...koHashes },
        sourceTime: config.ko.committedAt,
      },
    },
    engineUnsupported: unsupported,
    overridesApplied,
  }
}

/** 동결 스냅샷도 앱 로더(snapshot-guard)가 거부할 상태면 생성 단계에서 실패한다. */
function assertFrozenSnapshot(reg, { manifest, data }) {
  if (manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new PipelineError(`${reg.id}: 동결 스냅샷 schemaVersion ${manifest.schemaVersion} ≠ ${SNAPSHOT_SCHEMA_VERSION}(--force로 다시 만든다)`)
  }
  if (manifest.regulation?.id !== reg.id) throw new PipelineError(`${reg.id}: 동결 매니페스트 레귤레이션이 ${manifest.regulation?.id}이다`)
  if (!deepEqual(manifest.rules, reg.rules)) throw new PipelineError(`${reg.id}: 동결 매니페스트 rules가 설정과 다르다`)
  validateGameData(data)
}

async function learnsetOverrideDiffs(source) {
  if (!source.parentMode) return null
  const parent = await createPkmnSource(source.parentMode)
  const out = []
  for (const id of source.modOverrides.learnsets) {
    const a = (await parent.learnset(id)) ?? []
    const b = (await source.learnset(id)) ?? []
    out.push({ id, added: b.filter((m) => !a.includes(m)).sort(cmp), removed: a.filter((m) => !b.includes(m)).sort(cmp) })
  }
  return out
}

/**
 * 모든 레귤레이션 스냅샷과 리포트를 만든다.
 * opts: root(입력 기준), outRoot(출력 기준, 기본 root), cacheDir, force, recordHashes,
 *       config/aliases/gameOverrides/koOverrides(생략 시 root의 파일), log
 */
export async function buildAll(opts = {}) {
  const root = opts.root ?? PROJECT_ROOT
  const outRoot = opts.outRoot ?? root
  const cacheDir = opts.cacheDir ?? join(root, '.cache')
  const log = opts.log ?? (() => {})
  const configPath = join(root, 'scripts/data/sources.config.json')
  const config = structuredClone(opts.config ?? readJson(configPath))
  const aliases = opts.aliases ?? readJson(join(root, 'scripts/data/aliases.json'))
  const gameOverrides = opts.gameOverrides ?? readJson(join(root, 'scripts/data/overrides/game.json'))
  const koOverrides = opts.koOverrides ?? readJson(join(root, 'scripts/data/overrides/ko.json'))

  validateConfig(config)
  const lock = readJson(join(root, 'package-lock.json'))
  const installed = {}
  for (const name of [...Object.keys(config.gameData.packages), config.engine.package]) {
    installed[name] = readJson(join(root, 'node_modules', name, 'package.json')).version
  }
  assertPinnedPackages(config, lock, installed)
  const regIds = config.regulations.map((r) => r.id)
  validateGameOverrides(gameOverrides, regIds)
  validateKoOverrides(koOverrides)

  const pokeapi = await loadPokeapi(config.ko, cacheDir, { recordHashes: Boolean(opts.recordHashes) })
  if (opts.recordHashes) {
    config.ko.files = { ...pokeapi.hashes }
    config.ko.license.sha256 = pokeapi.license.sha
    writeFileSync(configPath, stableStringify(config))
    log(`해시 기록: ${configPath}`)
  }
  const koIndex = buildKoIndex(pokeapi.tables, aliases)
  const engine = loadEngine(config.engine.gen)

  const outputs = new Map()
  const put = (p, content) => outputs.set(p, typeof content === 'string' ? content : stableStringify(content))
  const allData = []
  const generated = []
  const skipped = []
  let prev = null

  for (const reg of config.regulations) {
    const p = paths(outRoot, reg.id)
    const frozenFiles = [p.manifest, p.data].filter((f) => existsSync(f)).length
    if (reg.frozen && !opts.force && frozenFiles > 0) {
      if (frozenFiles !== 2) throw new PipelineError(`${reg.id}: 동결 스냅샷의 manifest·data 중 하나만 있다(덮어쓰지 않음, --force로 다시 만든다)`)
      const frozen = { manifest: readJson(p.manifest), data: readJson(p.data) }
      assertFrozenSnapshot(reg, frozen)
      skipped.push(reg.id)
      allData.push(frozen.data)
      prev = { id: reg.id, data: frozen.data }
      log(`${reg.id}: 동결(frozen) — 재생성하지 않음 (--force로 강제)`)
      continue
    }
    const source = await createPkmnSource(reg.mode)
    const { data, learnsetFrom } = await extractGameData(source)
    const gameApplied = await applyGameOverrides(source, data, gameOverrides, reg.id)
    finalizeGameData(source, data)
    const ko = localize(data, source, koIndex, koOverrides)
    const { report: engineReport, unsupported } = compareWithEngine(data, engine, aliases)
    const diff = prev ? diffSnapshots(prev.data, data) : null
    const manifest = buildManifest(config, reg, pokeapi.hashes, unsupported, gameApplied.length + ko.applied.length)

    put(p.manifest, manifest)
    put(p.data, data)
    put(join(p.reports, 'diff.md'), renderDiffMd(reg.id, prev?.id, diff, prev?.data, data))
    put(join(p.reports, 'diff.json'), { regulation: reg.id, previous: prev?.id ?? null, diff })
    put(join(p.reports, 'engine-diff.json'), { regulation: reg.id, engine: `${config.engine.package}@${config.engine.version} gen${config.engine.gen}`, ...engineReport })
    put(join(p.reports, 'ko-fallback.json'), { regulation: reg.id, count: ko.fallback.length, items: ko.fallback })
    put(join(p.reports, 'overrides-applied.json'), {
      regulation: reg.id,
      game: gameApplied,
      ko: ko.applied,
      koSourceConflicts: ko.conflicts,
    })
    put(join(p.reports, 'inheritance.md'), renderInheritanceMd(reg.id, source, learnsetFrom, await learnsetOverrideDiffs(source)))
    for (const c of ko.conflicts) {
      log(`${c.action === 'warning' ? 'WARNING' : 'NOTICE'} ko 보정 ${c.kind}/${c.id}: 원천 값 "${c.source}" / 보정 "${c.override}" → ${c.action}`)
    }
    for (const g of gameApplied.filter((a) => a.noop)) log(`NOTICE game 보정 ${g.kind}/${g.id}.${g.field}: 원천과 같음 → 제거 권고`)
    for (const k of Object.keys(unsupported)) if (unsupported[k].length) log(`WARNING ${reg.id} 엔진 미지원 ${k}: ${unsupported[k].join(', ')}`)
    if (diff?.warnings.length) log(`WARNING ${reg.id}: 직전(${prev.id}) 대비 수치 차이 ${diff.warnings.length}건 (diff.md)`)
    generated.push(reg.id)
    allData.push(data)
    prev = { id: reg.id, data }
  }

  for (const kind of KO_KINDS) {
    for (const id of Object.keys(koOverrides[kind] ?? {})) {
      if (!allData.some((d) => d[kind][id])) throw new PipelineError(`ko 보정표 ${kind}/${id}: 어느 스냅샷에도 없는 항목`)
    }
  }
  for (const a of koIndex.unusedAliases()) log(`NOTICE 별칭표 미사용: ${a}`)

  put(paths(outRoot, '').index, {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    default: config.default,
    regulations: config.regulations.map((r) => ({ id: r.id, name: r.name, mode: r.mode, frozen: r.frozen })),
  })
  const metaIndex = readJson(join(root, 'src/data/meta/index.json'))
  const { licenses, notices } = buildLicenses(root, config, pokeapi.license.text, metaIndex)
  put(paths(outRoot, '').licenses, licenses)
  put(paths(outRoot, '').notices, notices)

  for (const [p, content] of [...outputs].sort((a, b) => cmp(a[0], b[0]))) {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return { generated, skipped, files: [...outputs.keys()].sort(cmp) }
}
