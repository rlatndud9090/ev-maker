// 랭크 변화 수단과 반응의 데이터 상수, 수단 1회 적용. 기준은 Showdown 동작이고 단위 테스트로 고정한다.
import {
  CoreError,
  CoreInputError,
  moveStatRefs,
  validateSet,
  type BoostTable,
  type PokemonSet,
  type ResolvedSet,
} from '../core'
import type { Snapshot } from '../data/schema'
import { TABS, type Tab } from './types'

export type BoostStat = keyof BoostTable
export const BOOST_STATS: readonly BoostStat[] = ['atk', 'def', 'spa', 'spd', 'spe']

export interface MeansRef {
  kind: 'ability' | 'move'
  id: string
}

export interface RankMeansDef extends MeansRef {
  /** self = 사용자 자신, opponent = 상대(하락 기술·위협) */
  target: 'self' | 'opponent'
  boosts: BoostTable
  /** non-ghost: 사용자 타입에 Ghost가 없을 때만(저주) */
  requires?: 'non-ghost'
}

const drop = (id: string, kind: 'ability' | 'move', boosts: BoostTable): RankMeansDef => ({ kind, id, target: 'opponent', boosts })
const rise = (id: string, kind: 'ability' | 'move', boosts: BoostTable, requires?: 'non-ghost'): RankMeansDef =>
  requires ? { kind, id, target: 'self', boosts, requires } : { kind, id, target: 'self', boosts }

/** 무조건 랭크를 바꾸는 기술·특성(확률 부가효과·엔진이 스스로 적용하는 변화·순풍 제외). */
export const RANK_MEANS: readonly RankMeansDef[] = [
  drop('intimidate', 'ability', { atk: -1 }),
  drop('partingshot', 'move', { atk: -1, spa: -1 }),
  drop('charm', 'move', { atk: -2 }),
  drop('featherdance', 'move', { atk: -2 }),
  drop('lunge', 'move', { atk: -1 }),
  drop('snarl', 'move', { spa: -1 }),
  drop('mysticalfire', 'move', { spa: -1 }),
  drop('spiritbreak', 'move', { spa: -1 }),
  drop('strugglebug', 'move', { spa: -1 }),
  drop('screech', 'move', { def: -2 }),
  drop('faketears', 'move', { spd: -2 }),
  drop('metalsound', 'move', { spd: -2 }),
  drop('icywind', 'move', { spe: -1 }),
  drop('electroweb', 'move', { spe: -1 }),
  drop('rocktomb', 'move', { spe: -1 }),
  drop('bulldoze', 'move', { spe: -1 }),
  drop('pounce', 'move', { spe: -1 }),
  drop('scaryface', 'move', { spe: -2 }),
  rise('swordsdance', 'move', { atk: 2 }),
  rise('nastyplot', 'move', { spa: 2 }),
  rise('irondefense', 'move', { def: 2 }),
  rise('amnesia', 'move', { spd: 2 }),
  rise('agility', 'move', { spe: 2 }),
  rise('dragondance', 'move', { atk: 1, spe: 1 }),
  rise('calmmind', 'move', { spa: 1, spd: 1 }),
  rise('bulkup', 'move', { atk: 1, def: 1 }),
  rise('coil', 'move', { atk: 1, def: 1 }),
  rise('quiverdance', 'move', { spa: 1, spd: 1, spe: 1 }),
  rise('shellsmash', 'move', { atk: 2, spa: 2, spe: 2, def: -1, spd: -1 }),
  rise('clangoroussoul', 'move', { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }),
  rise('curse', 'move', { atk: 1, def: 1, spe: -1 }, 'non-ghost'),
  rise('tidyup', 'move', { atk: 1, spe: 1 }),
  /** 날씨 없음 기준 */
  rise('growth', 'move', { atk: 1, spa: 1 }),
  rise('howl', 'move', { atk: 1 }),
  rise('torchsong', 'move', { spa: 1 }),
  rise('flamecharge', 'move', { spe: 1 }),
  rise('trailblaze', 'move', { spe: 1 }),
  rise('aquastep', 'move', { spe: 1 }),
  rise('speedboost', 'ability', { spe: 1 }),
]

export type ReactionEffect =
  /** 상대가 낮춘 하락 차단. stats가 없으면 전부 */
  | { type: 'block-drops'; stats?: readonly BoostStat[] }
  | { type: 'block-intimidate' }
  /** 위협의 하락 대신 boosts */
  | { type: 'intimidate-to-boost'; boosts: BoostTable }
  | { type: 'invert' }
  /** 상대가 낮춘 하락이 실제 적용되면 수단당 1회 boosts */
  | { type: 'on-drop'; boosts: BoostTable }
  /** 위협을 받으면 boosts(하락은 그대로) */
  | { type: 'on-intimidate'; boosts: BoostTable }
  /** 적용 후 음수 능력치를 0으로 되돌리고 소비 */
  | { type: 'restore-drops' }

export interface ReactionDef {
  kind: 'ability' | 'item'
  id: string
  effect: ReactionEffect
}

export const REACTIONS: readonly ReactionDef[] = [
  { kind: 'ability', id: 'clearbody', effect: { type: 'block-drops' } },
  { kind: 'ability', id: 'whitesmoke', effect: { type: 'block-drops' } },
  { kind: 'ability', id: 'mirrorarmor', effect: { type: 'block-drops' } },
  { kind: 'ability', id: 'hypercutter', effect: { type: 'block-drops', stats: ['atk'] } },
  { kind: 'ability', id: 'bigpecks', effect: { type: 'block-drops', stats: ['def'] } },
  { kind: 'ability', id: 'innerfocus', effect: { type: 'block-intimidate' } },
  { kind: 'ability', id: 'owntempo', effect: { type: 'block-intimidate' } },
  { kind: 'ability', id: 'oblivious', effect: { type: 'block-intimidate' } },
  { kind: 'ability', id: 'scrappy', effect: { type: 'block-intimidate' } },
  { kind: 'ability', id: 'guarddog', effect: { type: 'intimidate-to-boost', boosts: { atk: 1 } } },
  { kind: 'ability', id: 'contrary', effect: { type: 'invert' } },
  { kind: 'ability', id: 'defiant', effect: { type: 'on-drop', boosts: { atk: 2 } } },
  { kind: 'ability', id: 'competitive', effect: { type: 'on-drop', boosts: { spa: 2 } } },
  { kind: 'ability', id: 'rattled', effect: { type: 'on-intimidate', boosts: { spe: 1 } } },
  { kind: 'item', id: 'whiteherb', effect: { type: 'restore-drops' } },
]

export function findMeans(means: MeansRef): RankMeansDef | undefined {
  return RANK_MEANS.find((d) => d.kind === means.kind && d.id === means.id)
}

export interface MeansEffect {
  userBoosts: BoostTable
  targetBoosts: BoostTable
  reactions: string[]
  whiteHerbConsumed: boolean
}

type Holder = Pick<ResolvedSet, 'ability' | 'item'>
type Stages = Record<BoostStat, number>

const zero = (): Stages => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })
const reactionOf = (holder: Holder): ReactionDef[] =>
  REACTIONS.filter((r) => (r.kind === 'ability' ? r.id === holder.ability : r.id === holder.item))
const add = (out: Stages, boosts: BoostTable): void => {
  for (const s of BOOST_STATS) out[s] += boosts[s] ?? 0
}
const nonZero = (st: Stages): BoostTable => {
  const out: BoostTable = {}
  for (const s of BOOST_STATS) if (st[s] !== 0) out[s] = st[s]
  return out
}

/** 차단 → 변환 → 반응 → 하양허브 → −6~+6 자르기. 시작 랭크는 0이다. */
function receive(
  holder: Holder,
  boosts: BoostTable,
  byOpponent: boolean,
  intimidate: boolean,
  reactions: string[],
): { stages: Stages; whiteHerb: boolean } {
  const effects = reactionOf(holder)
  const b = zero()
  add(b, boosts)
  const late: BoostTable[] = []
  for (const r of effects) {
    const e = r.effect
    let fired = false
    const blocked: readonly BoostStat[] =
      byOpponent && e.type === 'block-drops'
        ? (e.stats ?? BOOST_STATS)
        : intimidate && (e.type === 'block-intimidate' || e.type === 'intimidate-to-boost')
          ? ['atk']
          : []
    for (const s of blocked) {
      if (b[s] < 0) {
        b[s] = 0
        fired = true
      }
    }
    if (intimidate && e.type === 'intimidate-to-boost') late.push(e.boosts)
    if (fired) reactions.push(r.id)
  }
  for (const r of effects) {
    if (r.effect.type === 'invert' && BOOST_STATS.some((s) => b[s] !== 0)) {
      for (const s of BOOST_STATS) b[s] = -b[s]
      reactions.push(r.id)
    }
  }
  const stages = zero()
  add(stages, b)
  for (const extra of late) add(stages, extra)
  const dropApplied = byOpponent && BOOST_STATS.some((s) => b[s] < 0)
  for (const r of effects) {
    const e = r.effect
    if ((e.type === 'on-drop' && dropApplied) || (e.type === 'on-intimidate' && intimidate)) {
      add(stages, e.boosts)
      reactions.push(r.id)
    }
  }
  let whiteHerb = false
  for (const r of effects) {
    if (r.effect.type === 'restore-drops' && BOOST_STATS.some((s) => stages[s] < 0)) {
      for (const s of BOOST_STATS) if (stages[s] < 0) stages[s] = 0
      reactions.push(r.id)
      whiteHerb = true
    }
  }
  for (const s of BOOST_STATS) stages[s] = Math.max(-6, Math.min(6, stages[s]))
  return { stages, whiteHerb }
}

function effectOf(
  def: RankMeansDef,
  user: Pick<ResolvedSet, 'ability' | 'item' | 'species'>,
  target: Holder,
): MeansEffect | null {
  if (def.requires === 'non-ghost' && user.species.types.includes('Ghost')) return null
  const reactions: string[] = []
  const intimidate = def.kind === 'ability' && def.id === 'intimidate'
  const self = def.target === 'self'
  const { stages, whiteHerb } = receive(self ? user : target, def.boosts, !self, intimidate, reactions)
  const changed = nonZero(stages)
  if (Object.keys(changed).length === 0) return null
  return {
    userBoosts: self ? changed : {},
    targetBoosts: self ? {} : changed,
    reactions,
    whiteHerbConsumed: whiteHerb,
  }
}

/** 수단 1회를 사용자 → 대상에 적용한 최종 랭크. 목록에 없는 수단이거나 효과가 없으면 null. */
export function applyMeans(
  _game: Snapshot,
  means: MeansRef,
  user: ResolvedSet,
  target: ResolvedSet,
): MeansEffect | null {
  const def = findMeans(means)
  return def ? effectOf(def, user, target) : null
}

/** 세트의 기술·계산 특성 중 수단 목록에 있는 것(특성 → 기술 슬롯 순). */
export function setMeans(r: Pick<ResolvedSet, 'ability' | 'set'>): MeansRef[] {
  const out: MeansRef[] = []
  if (findMeans({ kind: 'ability', id: r.ability })) out.push({ kind: 'ability', id: r.ability })
  for (const id of r.set.moves) if (findMeans({ kind: 'move', id })) out.push({ kind: 'move', id })
  return out
}

/**
 * 내 수단이 랭크 행을 더하는 탭(설정 칩 알림용). 상대 반응이 없는 기준으로 바뀐 능력치를 본다.
 * 공격 탭 = 내 공격기 공격 능력치·상대 방어 능력치, 방어 탭 = 내 B·D·상대 A·C, 스피드 탭 = 양쪽 S.
 * 내 세트가 무효면 빈 배열.
 */
export function myMeansNotes(game: Snapshot, set: PokemonSet): Array<{ means: MeansRef; tabs: Tab[] }> {
  let me: ResolvedSet
  try {
    me = validateSet(game, set)
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return []
    throw e
  }
  const myOffense = new Set<BoostStat>()
  const oppDefense = new Set<BoostStat>()
  for (const id of me.set.moves) {
    const refs = moveStatRefs(game, id)
    if (refs.categoryVaries || !refs.offense || !refs.defense) continue
    if (refs.offense.owner === 'self') {
      myOffense.add(refs.offense.stat)
      oppDefense.add(refs.defense)
    }
  }
  const neutral: Holder = { ability: '', item: undefined }
  const out: Array<{ means: MeansRef; tabs: Tab[] }> = []
  for (const means of setMeans(me)) {
    const def = findMeans(means)
    const eff = def ? effectOf(def, me, neutral) : null
    if (!eff) continue
    const mine = BOOST_STATS.filter((s) => eff.userBoosts[s])
    const theirs = BOOST_STATS.filter((s) => eff.targetBoosts[s])
    const hits: Record<Tab, boolean> = {
      attack: mine.some((s) => myOffense.has(s)) || theirs.some((s) => oppDefense.has(s)),
      defense: mine.some((s) => s === 'def' || s === 'spd') || theirs.some((s) => s === 'atk' || s === 'spa'),
      speed: mine.includes('spe') || theirs.includes('spe'),
    }
    const tabs = TABS.filter((t) => hits[t])
    if (tabs.length > 0) out.push({ means, tabs })
  }
  return out
}
