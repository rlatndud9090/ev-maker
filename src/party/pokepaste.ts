// PokePaste 가져오기 해석: 링크 정규화 → 텍스트(Showdown 내보내기) → 영어 이름 세트 → 앱 초안. 상태·화면과 무관한 순수 함수.
import { STAT_IDS } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import { BOOST_STATS, MOVE_SLOTS, type BoostStat, type SetDraft } from '../ui/setDraft'
import { namesOf } from '../ui/names'

export const PASTE_PARTY_SIZE = 6

export type NormalizedPasteUrl = { ok: true; id: string; rawUrl: string } | { ok: false; reason: 'format' }

const PASTE_URL = /^(?:https?:\/\/)?pokepast\.es\/([0-9a-f]{16})(?:\/(?:raw|json))?\/?$/i

/** pokepast.es 링크만 받는다(https 유무·끝 '/'·'/raw'·'/json' 허용, www 등 다른 호스트는 거부). */
export function normalizePasteUrl(input: string): NormalizedPasteUrl {
  const m = PASTE_URL.exec(input.trim())
  if (!m) return { ok: false, reason: 'format' }
  const id = m[1].toLowerCase()
  return { ok: true, id, rawUrl: `https://pokepast.es/${id}/raw` }
}

export interface ParsedMon {
  species: string
  nickname?: string
  gender?: 'M' | 'F'
  item?: string
  ability?: string
  nature?: string
  evs: Partial<Record<StatId, number>>
  moves: string[]
}

const EV_STAT: Record<string, StatId> = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe' }

function parseSpeciesLine(line: string): Pick<ParsedMon, 'species' | 'nickname' | 'gender' | 'item'> {
  const out: Pick<ParsedMon, 'species' | 'nickname' | 'gender' | 'item'> = { species: '' }
  let head = line
  const at = head.lastIndexOf(' @ ')
  if (at >= 0) {
    const item = head.slice(at + 3).trim()
    if (item !== '') out.item = item
    head = head.slice(0, at)
  }
  head = head.trim()
  const g = /\s*\((M|F)\)$/.exec(head)
  if (g) {
    out.gender = g[1] as 'M' | 'F'
    head = head.slice(0, g.index).trim()
  }
  const open = head.lastIndexOf('(')
  if (head.endsWith(')') && open > 0) {
    const nickname = head.slice(0, open).trim()
    out.species = head.slice(open + 1, -1).trim()
    if (nickname !== '') out.nickname = nickname
  } else {
    out.species = head
  }
  return out
}

function parseEvs(body: string): Partial<Record<StatId, number>> {
  const evs: Partial<Record<StatId, number>> = {}
  for (const part of body.split('/')) {
    const m = /^(\d+)\s+([A-Za-z]+)$/.exec(part.trim())
    const stat = m && EV_STAT[m[2].toLowerCase()]
    if (m && stat) evs[stat] = Number(m[1])
  }
  return evs
}

/** Showdown 내보내기 텍스트 → 포켓몬 블록(빈 줄 구분). 종 줄 외에 특성·노력치·성격·기술만 읽고 나머지 줄은 버린다. */
export function parsePasteText(text: string): ParsedMon[] {
  const mons: ParsedMon[] = []
  let current: ParsedMon | null = null
  // NBSP 등 유니코드 공백은 일반 공백으로 바꾼 뒤 읽는다(줄바꿈·탭은 그대로)
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[^\S\n\t ]/g, ' ')
  for (const raw of normalized.split('\n')) {
    const line = raw.trim()
    if (line === '') {
      current = null
      continue
    }
    if (line.startsWith('===')) {
      current = null
      continue
    }
    if (current === null) {
      const head = parseSpeciesLine(line)
      if (head.species === '') continue
      current = { ...head, evs: {}, moves: [] }
      mons.push(current)
      continue
    }
    let m: RegExpExecArray | null
    if ((m = /^Ability:\s*(.+)$/i.exec(line))) current.ability = m[1].trim()
    else if ((m = /^EVs:\s*(.+)$/i.exec(line))) current.evs = parseEvs(m[1])
    else if ((m = /^([A-Za-z]+)\s+Nature$/i.exec(line))) current.nature = m[1]
    else if ((m = /^[-~]\s*(.+)$/.exec(line))) {
      // "- A / B" 대안 표기는 첫 대안만 쓴다
      const move = m[1].split('/')[0].trim()
      if (move !== '') current.moves.push(move)
    }
  }
  return mons
}

export interface PasteReportEntry {
  /** paste 안 순서(0부터). 6마리를 넘어 건너뛴 포켓몬도 그 순서로 적힌다. */
  index: number
  name: string
  issues: string[]
}

export interface PasteConversion {
  /** paste 순서대로 최대 6칸. 종을 풀지 못한 칸은 null. */
  drafts: (SetDraft | null)[]
  /** 문제가 있었던 포켓몬만. */
  report: PasteReportEntry[]
}

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const has = (table: object, id: string): boolean => Object.prototype.hasOwnProperty.call(table, id)
const DEFAULT_NATURE = 'hardy'

function convertOne(snapshot: Snapshot, mon: ParsedMon, issues: string[]): { draft: SetDraft | null; name: string } {
  const names = namesOf(snapshot)
  const { data, manifest } = snapshot
  const lookup = (index: typeof names.species, table: object, text: string): string | undefined => {
    const id = index.resolve(text)
    if (id !== undefined) return id
    const loose = toId(text)
    return has(table, loose) ? loose : undefined
  }

  const speciesId = lookup(names.species, data.species, mon.species)
  if (speciesId === undefined) {
    issues.push(`종 "${mon.species}"을(를) 현재 레귤레이션에서 찾을 수 없어 칸을 비웠습니다`)
    return { draft: null, name: mon.nickname ?? mon.species }
  }

  const entry = data.species[speciesId]
  const megaByForme = entry.isMega ? data.megas.find((m) => m.forme === speciesId) : undefined
  if (entry.isMega && (megaByForme === undefined || !has(data.species, megaByForme.base))) {
    issues.push(`종 "${mon.species}"의 원종을 현재 레귤레이션에서 찾을 수 없어 칸을 비웠습니다`)
    return { draft: null, name: mon.nickname ?? mon.species }
  }
  const base = megaByForme ? data.species[megaByForme.base] : entry

  let formeId = speciesId
  let item = ''
  const itemId = mon.item === undefined ? undefined : lookup(names.items, data.items, mon.item)
  if (mon.item !== undefined && itemId === undefined) {
    issues.push(`도구 "${mon.item}"을(를) 현재 레귤레이션에서 찾을 수 없어 비웠습니다`)
  }
  if (megaByForme) {
    item = names.items.label(megaByForme.stone)
    if (itemId !== undefined && itemId !== megaByForme.stone) {
      issues.push(`메가 폼이라 도구 "${mon.item}" 대신 메가스톤 "${item}"을(를) 넣었습니다`)
    }
  } else if (itemId !== undefined) {
    const stoneOf = data.megas.filter((m) => m.stone === itemId)
    const mega = stoneOf.find((m) => m.base === base.id && has(data.species, m.forme))
    if (mega) {
      formeId = mega.forme
      item = names.items.label(itemId)
    } else if (stoneOf.length > 0) {
      issues.push(`도구 "${mon.item}"은(는) 이 포켓몬의 메가스톤이 아니라 비웠습니다`)
    } else {
      item = names.items.label(itemId)
    }
  }

  const fallbackAbility = base.abilities[0]
  let ability = fallbackAbility
  if (mon.ability !== undefined) {
    const abilityId = lookup(names.abilities, data.abilities, mon.ability)
    if (abilityId !== undefined && base.abilities.includes(abilityId)) ability = abilityId
    else if (abilityId === undefined) {
      issues.push(`특성 "${mon.ability}"을(를) 현재 레귤레이션에서 찾을 수 없어 기본 특성 "${names.abilities.label(fallbackAbility)}"(으)로 넣었습니다`)
    } else {
      issues.push(`특성 "${mon.ability}"은(는) 이 포켓몬이 가질 수 없어 기본 특성 "${names.abilities.label(fallbackAbility)}"(으)로 넣었습니다`)
    }
  }

  let nature = DEFAULT_NATURE
  if (mon.nature !== undefined) {
    const natureId = lookup(names.natures, data.natures, mon.nature)
    if (natureId !== undefined) nature = natureId
    else issues.push(`성격 "${mon.nature}"을(를) 찾을 수 없어 보정 없는 성격으로 넣었습니다`)
  }

  const moves = Array.from({ length: MOVE_SLOTS }, () => '')
  mon.moves.forEach((text, i) => {
    if (i >= MOVE_SLOTS) {
      issues.push(`기술 "${text}"은(는) ${MOVE_SLOTS}개를 넘어 건너뛰었습니다`)
      return
    }
    const moveId = lookup(names.moves, data.moves, text)
    if (moveId !== undefined) moves[i] = names.moves.label(moveId)
    else issues.push(`기술 "${text}"을(를) 현재 레귤레이션에서 찾을 수 없어 비웠습니다`)
  })

  const { spMaxPerStat, spTotal } = manifest.rules
  const values = STAT_IDS.map((s) => mon.evs[s] ?? 0)
  const overflow = values.some((v) => v > spMaxPerStat) || values.reduce((a, b) => a + b, 0) > spTotal
  if (overflow) issues.push(`SP가 능력치당 ${spMaxPerStat} 또는 합계 ${spTotal}을 넘어 모두 비웠습니다`)
  const sp = Object.fromEntries(STAT_IDS.map((s, i) => [s, overflow ? '0' : String(values[i])])) as Record<StatId, string>

  const draft: SetDraft = {
    species: names.species.label(formeId),
    ability,
    item,
    nature,
    natureMinusAuto: false,
    sp,
    moves,
    mega: false,
    status: 'none',
    boosts: Object.fromEntries(BOOST_STATS.map((s) => [s, '0'])) as Record<BoostStat, string>,
  }
  return { draft, name: names.species.label(formeId) }
}

/** 영어 이름 세트 → 현재 레귤레이션 초안. 못 푼 항목은 비우고 보고한다(종을 못 풀면 그 칸 null). */
export function toDrafts(parsed: readonly ParsedMon[], snapshot: Snapshot): PasteConversion {
  const drafts: (SetDraft | null)[] = []
  const report: PasteReportEntry[] = []
  parsed.forEach((mon, index) => {
    if (index >= PASTE_PARTY_SIZE) {
      report.push({ index, name: mon.nickname ?? mon.species, issues: [`파티는 ${PASTE_PARTY_SIZE}마리까지라 건너뛰었습니다`] })
      return
    }
    const issues: string[] = []
    const { draft, name } = convertOne(snapshot, mon, issues)
    drafts.push(draft)
    if (issues.length > 0) report.push({ index, name, issues })
  })
  return { drafts, report }
}

export type FetchPasteResult = { ok: true; text: string } | { ok: false; reason: 'network' | 'not-found' | 'empty' }

/** rawUrl을 받아 온다. 404는 not-found, 포켓몬 블록이 하나도 없으면 empty, 그 밖의 실패는 network. */
export async function fetchPaste(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchPasteResult> {
  let text: string
  try {
    const res = await fetchImpl(url)
    if (res.status === 404) return { ok: false, reason: 'not-found' }
    if (!res.ok) return { ok: false, reason: 'network' }
    text = await res.text()
  } catch {
    return { ok: false, reason: 'network' }
  }
  if (parsePasteText(text).length === 0) return { ok: false, reason: 'empty' }
  return { ok: true, text }
}
