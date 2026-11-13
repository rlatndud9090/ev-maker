// 메타 스냅샷 생성 조립: 보존·강제·스키마 검사, 크기 검사, 인덱스 재생성, 출력 일괄 쓰기.
// 현재 시각과 응답 헤더를 생성물에 쓰지 않는다(공개 시각은 설정 기록값).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSet } from '../../../src/core/set.ts'
import { MATCH_TYPES, META_SCHEMA_VERSION } from '../../../src/data/meta-schema.ts'
import { createPkmnSource } from './pkmn-source.mjs'
import { transformSource, validateMetaAliases, VIOLATION_KINDS } from './meta-build.mjs'
import {
  MetaPipelineError,
  assertMonth,
  assertMonthInPeriod,
  readRecordedSource,
  recordSources,
  validateMetaConfig,
  validateSourceFormat,
} from './meta-source.mjs'
import { cmp, sha256, stableStringify } from './util.mjs'

export { MetaPipelineError } from './meta-source.mjs'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
export const META_MAX_BYTES = 1_000_000
const META_FILE_RE = /^(\d{4}-\d{2})-(bo[13])\.json$/
const REG_DIR_RE = /^[a-z0-9-]+$/

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const fail = (m) => {
  throw new MetaPipelineError(m)
}

export const metaPaths = (outRoot, reg, month, match) => ({
  dir: join(outRoot, 'src/data/meta'),
  index: join(outRoot, 'src/data/meta/index.json'),
  file: join(outRoot, `src/data/meta/${reg}/${month}-${match}.json`),
  reports: join(outRoot, `data/reports/meta/${reg}/${month}-${match}`),
})

/** 디스크(+이번 출력)의 메타 파일 전체로 인덱스를 다시 만든다. 다른 schemaVersion 파일이 있으면 실패한다. */
function rebuildIndex(outRoot, outputs) {
  const dir = metaPaths(outRoot).dir
  const files = new Map()
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort(cmp)) {
      const p = join(dir, name)
      if (!statSync(p).isDirectory()) {
        if (name !== 'index.json') fail(`메타 디렉터리에 허용되지 않은 파일: ${relative(outRoot, p)}`)
        continue
      }
      if (!REG_DIR_RE.test(name)) fail(`메타 디렉터리 이름 형식: ${name}`)
      for (const f of readdirSync(p).sort(cmp)) {
        if (!META_FILE_RE.test(f)) fail(`메타 파일 이름 형식(YYYY-MM-bo1|bo3.json)이 아니다: ${relative(outRoot, join(p, f))}`)
        files.set(join(p, f), null)
      }
    }
  }
  for (const p of outputs.keys()) if (dirname(dirname(p)) === dir) files.set(p, outputs.get(p))
  const regulations = {}
  const wrongVersion = []
  for (const [p, content] of [...files].sort((a, b) => cmp(a[0], b[0]))) {
    const meta = content === null ? readJson(p) : JSON.parse(content)
    const m = meta?.manifest
    const rel = relative(dir, p)
    if (m?.schemaVersion !== META_SCHEMA_VERSION) {
      wrongVersion.push(`${rel}(schemaVersion ${m?.schemaVersion})`)
      continue
    }
    const reg = dirname(rel)
    const [, month, match] = META_FILE_RE.exec(rel.slice(reg.length + 1))
    if (m.regulation !== reg || m.month !== month || m.match !== match) {
      fail(`메타 파일 ${rel}의 매니페스트가 ${m.regulation}/${m.month}-${m.match}이다`)
    }
    ;(regulations[reg] ??= []).push({
      match,
      month,
      file: rel,
      format: m.source.format,
      url: m.source.url,
      publishedAt: m.source.publishedAt,
      battles: m.source.battles,
    })
  }
  if (wrongVersion.length) {
    fail(`다른 schemaVersion(현재 ${META_SCHEMA_VERSION}) 메타 파일: ${wrongVersion.join(', ')} — --force로 해당 월을 다시 만든다`)
  }
  for (const items of Object.values(regulations)) items.sort((a, b) => cmp(a.month, b.month) || cmp(a.match, b.match))
  return { schemaVersion: META_SCHEMA_VERSION, regulations }
}

function renderReportMd(r) {
  const lines = [
    `# 메타 스냅샷 리포트: ${r.regulation} ${r.month} ${r.match}`,
    '',
    `- 원천: ${r.format} (${r.url})`,
    `- 파일 크기: ${r.size} 바이트(상한 ${r.sizeLimit})`,
    `- 종: 원천 ${r.species.source}, 목록 ${r.species.listed}`,
    `- 빈 칸 기술: ${r.blankMoves.species}종, 가중 ${r.blankMoves.weight}`,
    `- 최소값 이상 미연결 종: ${r.unlinkedAboveMin.join(', ') || '없음'}`,
    '',
    '## 위반 종류별',
    '',
    '| 종류 | 개수 | 빠진 가중 출현 |',
    '| --- | --- | --- |',
    ...VIOLATION_KINDS.map((k) => `| ${k} | ${r.violations[k].count} | ${r.violations[k].weight} |`),
    '',
    '## 위반 내역',
    '',
  ]
  if (!r.violationDetails.length) lines.push('없음')
  else {
    lines.push('| 종류 | 종 | 값 | 가중 | 점유율 |', '| --- | --- | --- | --- | --- |')
    for (const d of r.violationDetails) lines.push(`| ${d.kind} | ${d.species} | ${d.value} | ${d.weight} | ${d.share ?? '-'} |`)
  }
  const m = r.mega
  lines.push(
    '',
    '## 메가 점검',
    '',
    `- 원천 메가 항목 ${m.checked}개, 목록 ${m.listed}개`,
    `- 최다 도구가 메가스톤이 아님: ${m.stoneNotTop.map((x) => `${x.species}(${x.top})`).join(', ') || '없음'}`,
    `- 메가 폼 특성 밖 특성: ${m.abilityOutsideForm.map((x) => `${x.species}(${x.ability})`).join(', ') || '없음'}`,
    '',
    '## 보존 통계',
    '',
    `- 누적 ${r.retention.spreadTarget} 이상에서 멈춤: ${r.retention.reachedTarget}종`,
    `- 최대 ${r.retention.spreadMax}개를 담고도 목표 미달: ${r.retention.hitMax}종`,
    `- 남은 spread를 모두 담고도 목표 미달(소진): ${r.retention.exhausted}종 — ${r.retention.exhaustedSpecies.join(', ') || '없음'}`,
    `- 누적 점유율 최소 ${r.retention.keptShareMin}, 평균 ${r.retention.keptShareMean}`,
    '',
  )
  return lines.join('\n')
}

/**
 * 메타 스냅샷을 기록하거나 생성한다.
 * 입력(게임 데이터·sources.config.json)은 root, 출력(메타 파일·인덱스·리포트)은 outRoot 기준이다.
 */
export async function buildMeta(opts) {
  const root = opts.root ?? PROJECT_ROOT
  const outRoot = opts.outRoot ?? root
  const cacheDir = opts.cacheDir ?? join(root, '.cache')
  const configPath = opts.configPath ?? join(root, 'scripts/data/meta.config.json')
  const fetchFn = opts.fetch ?? globalThis.fetch
  const log = opts.log ?? (() => {})
  const config = structuredClone(opts.config ?? readJson(configPath))
  const gameConfig = readJson(join(root, 'scripts/data/sources.config.json'))
  const aliases = readJson(join(root, 'scripts/data/aliases.json')).meta
  validateMetaAliases(aliases)
  validateMetaConfig(config, gameConfig)

  const regId = opts.regulation
  const reg = gameConfig.regulations.find((r) => r.id === regId)
  if (typeof regId !== 'string' || !reg) fail(`알 수 없는 레귤레이션: ${regId}`)
  if (!Object.hasOwn(config.regulations, regId)) fail(`레귤레이션 ${regId}의 포맷 대응이 메타 설정에 없다`)
  const mapping = config.regulations[regId]
  assertMonth(opts.month)
  const month = opts.month
  const requested = opts.match ?? MATCH_TYPES.filter((m) => Object.hasOwn(mapping, m))
  for (const m of requested) {
    if (!MATCH_TYPES.includes(m) || !Object.hasOwn(mapping, m)) fail(`레귤레이션 ${regId}에 매치 방식 ${m} 대응이 없다`)
  }
  const matches = MATCH_TYPES.filter((m) => requested.includes(m))
  const result = { generated: [], skipped: [], recorded: [], files: [], noticeUpdateRequired: false }

  if (opts.record) {
    const rec = await recordSources({ config, regulation: regId, month, matches, cacheDir, fetchFn, force: opts.force, log })
    for (const [p, body] of rec.bodies) {
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, body)
    }
    writeFileSync(configPath, stableStringify({ ...config, sources: rec.sources }))
    log(`기록: ${configPath}`)
    result.recorded = rec.recorded
    result.files = [configPath, ...rec.bodies.map(([p]) => p)].sort(cmp)
    return result
  }

  const regDir = join(root, `src/data/regulations/${regId}`)
  const dataBytes = readFileSync(join(regDir, 'data.json'))
  const game = { manifest: readJson(join(regDir, 'manifest.json')), data: JSON.parse(dataBytes.toString('utf8')) }
  if (game.manifest.regulation?.id !== regId) fail(`${regId}: 게임 데이터 매니페스트의 레귤레이션이 ${game.manifest.regulation?.id}이다`)
  const gameRef = { regulation: regId, schemaVersion: game.manifest.schemaVersion, sha256: sha256(dataBytes) }
  let pkmn = null

  const outputs = new Map()
  const put = (p, content) => outputs.set(p, typeof content === 'string' ? content : stableStringify(content))
  for (const match of matches) {
    const label = `${regId}/${month}-${match}`
    const p = metaPaths(outRoot, regId, month, match)
    if (existsSync(p.file) && !opts.force) {
      log(`${label}: 이미 있다 — 다시 만들지 않음 (--force로 강제)`)
      result.skipped.push(label)
      continue
    }
    const record = config.sources.find((s) => s.regulation === regId && s.month === month && s.match === match)
    if (!record) fail(`${label}: 해시 미기록: --record 먼저`)
    if (record.format !== mapping[match]) fail(`${label}: 기록 포맷 ${record.format}이 대응 ${mapping[match]}과 다르다`)
    assertMonthInPeriod(reg, month)
    const raw = await readRecordedSource(record, cacheDir, fetchFn, log)
    validateSourceFormat(raw, record)

    pkmn ??= await createPkmnSource(reg.mode)
    const { entries, report, weightedBattles } = transformSource({
      raw,
      regulation: regId,
      params: config.params,
      game,
      pkmn,
      rules: reg.rules,
      aliases,
    })
    for (const en of entries) {
      try {
        validateSet(game, en.representative.set)
      } catch (e) {
        fail(`${label}: 대표 세트 검증 실패 ${en.id}: ${e.message}`)
      }
    }
    for (const id of report.unlinkedAboveMin) log(`WARNING ${label}: 사용률 최소값 이상 종 미연결 ${id}`)
    for (const id of report.retention.exhaustedSpecies) log(`WARNING ${label}: 보존 spread 소진(목표 미달) ${id}`)
    const meta = {
      manifest: {
        schemaVersion: META_SCHEMA_VERSION,
        regulation: regId,
        month,
        match,
        source: {
          format: record.format,
          cutoff: record.cutoff,
          url: record.url,
          sha256: record.sha256,
          publishedAt: record.publishedAt,
          battles: raw.info['number of battles'],
        },
        params: { ...config.params },
        gameData: gameRef,
        sample: { weightedBattles },
      },
      entries,
    }
    const text = stableStringify(meta)
    const size = Buffer.byteLength(text)
    if (size > META_MAX_BYTES) fail(`${label}: 스냅샷 ${size} 바이트가 상한 ${META_MAX_BYTES}을 넘는다`)
    put(p.file, text)
    const full = { regulation: regId, month, match, format: record.format, url: record.url, size, sizeLimit: META_MAX_BYTES, ...report }
    put(join(p.reports, 'report.json'), full)
    put(join(p.reports, 'report.md'), renderReportMd(full))
    log(`${label}: ${entries.length}종, ${size} 바이트`)
    result.generated.push(label)
  }

  put(metaPaths(outRoot).index, rebuildIndex(outRoot, outputs))
  for (const [p, content] of [...outputs].sort((a, b) => cmp(a[0], b[0]))) {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  result.files = [...outputs.keys()].sort(cmp)
  result.noticeUpdateRequired = result.generated.length > 0
  if (result.noticeUpdateRequired) log('출처 고지 갱신 필요: npm run gen:snapshot 실행')
  return result
}
