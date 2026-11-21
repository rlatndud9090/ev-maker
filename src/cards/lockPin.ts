// 공격·방어 카드 핀 메뉴 모델(변동 팝오버와 같은 모양, 사용자 결정 2026-11-21). 판정은 하지 않고 후보 해석·고정 해석으로 파생만 다시 돌린다.
// 표시 SP는 "그 선택을 실제로 걸었을 때의 파생"에서 읽어, 메뉴에 보인 값과 고정 뒤 고정 줄·고정 목록 값이 같다.
import { STAT_IDS, tierRank, type PokemonSet, type RollTier } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import { conflictingLocks, deriveLocks, type Branch, type CutLock, type LockDerivation, type LockResolution } from './lock'
import type { AdjustNature, AdjustOption, AdjustResult, AdjustStat, AdjustView, LockStageCandidate } from './types'

type Boostable = Exclude<StatId, 'hp'>

export interface PinChoice {
  lock: Omit<CutLock, 'seq'>
  /** 고른 성격의 기준 갈래 id. 그대로 두어도 그 갈래가 기준이면 없음 */
  base?: string
}

export interface PinPick extends PinChoice {
  /** H 최대 배분으로 걸 때의 고정(allocation 'h-max')·기준 갈래. 배분이 바뀌면 자동 규칙이 고르는 갈래도 바뀔 수 있어 따로 정한다. H 최대 선택지가 없으면 없음 */
  hMax?: PinChoice
}

export interface PinMenuView extends Pick<AdjustView, 'state' | 'natures' | 'results'> {
  /** [results index][natures index] 고를 수 있으면 그 고정(합 최소, H 최대는 hMax), 아니면 null */
  picks: readonly (readonly (PinPick | null)[])[]
  /** ready인데 결과가 하나도 없을 때, 끈 이유 중 SP 부족의 최소 초과량 */
  emptyOver?: number
  /** ready인데 결과가 하나도 없을 때 핀 전체의 이유: SP 부족(최소 초과량) > 성격 충돌(칸 하나라도) > 일반 */
  empty?: PinEmptyReason
}

/** 고를 수 있는 선택지가 없는 핀의 이유(핀 비활성·빈 메뉴 문구) */
export type PinEmptyReason = { kind: 'sp-short'; over: number } | { kind: 'nature-conflict' } | { kind: 'none' }

export interface PinMenuInput {
  game: Snapshot
  /** 고정 전 값이 들어 있는 내 세트(초안) */
  mySet: PokemonSet
  locks: readonly CutLock[]
  /** 지금 실행 세대의 고정 해석 */
  resolutions: ReadonlyMap<number, LockResolution>
  lockBase: string | null
  side: 'attack' | 'defense'
  /** 그 카드의 고정 가능 단계 후보(LOCK_STAGES) */
  stages: readonly LockStageCandidate[]
  /** 카드 현재 결과 */
  current?: RollTier
}

const COMPUTING: PinMenuView = { state: 'computing', natures: [], results: [], picks: [] }

type Off = Extract<AdjustOption, { kind: 'off' }>
const off = (reason: Off['reason'], over?: number): Off => (over === undefined ? { kind: 'off', reason } : { kind: 'off', reason, over })

interface Cell {
  option: AdjustOption
  /** 후보 능력치 SP 합(ok일 때만 쓴다) */
  cost: number
  pick: PinPick | null
}

/** 쌍 후보 해석에 한 단계 위 계단을 붙인다(H 최대 단계 정확 검사용). 위 단계 후보 해석이 오류면 붙이지 않는다 */
function withNext(resolution: LockResolution, upper: LockResolution | undefined): LockResolution {
  if (resolution.kind !== 'ok' || resolution.options.shape !== 'pair' || upper === undefined) return resolution
  if (upper.kind === 'ok' && upper.options.shape === 'pair') return { kind: 'ok', options: { ...resolution.options, next: { neutral: upper.options.neutral, plus: upper.options.plus } } }
  if (upper.kind === 'unreachable' && upper.reason === undefined) return { kind: 'ok', options: { ...resolution.options, next: { neutral: null, plus: null } } }
  return resolution
}

const byStat = (a: AdjustStat, b: AdjustStat): number => STAT_IDS.indexOf(a.stat) - STAT_IDS.indexOf(b.stat)

/**
 * 공격·방어 카드 핀 메뉴. 단계 후보마다 교체할 고정(conflictingLocks)을 빼고, 성격 선택지(무보정 → v 상승 → 반대쪽 쌍 고정 중이면 반대쪽 상승) ×
 * 배분(합 최소, 방어이고 H를 공유하지 않으면 H 최대)마다 그 고정을 걸었을 때의 파생으로 SP·고를 수 있는지를 정한다.
 * 위 단계를 같은 비용 이하로 내는 아래 단계 선택지는 끈다(변동과 같은 정확 규칙). 후보가 하나라도 계산 중이면 computing.
 */
export function pinMenuView(input: PinMenuInput): PinMenuView {
  const { game, mySet, locks, resolutions, lockBase, side, stages } = input
  if (stages.length === 0 || stages.some((s) => s.candidate.kind !== 'ready')) return COMPUTING
  const ready = stages.map((s) => ({ stage: s.stage, candidate: s.candidate as Extract<LockStageCandidate['candidate'], { kind: 'ready' }> }))
  const first = ready[0].candidate.lock
  const v = (side === 'attack' ? first.stats[0] : first.stats[1]) as Boostable
  const other: Boostable | undefined = side === 'defense' ? (v === 'def' ? 'spd' : 'def') : undefined
  const kept = locks.filter((l) => !conflictingLocks(locks, first.stats).includes(l))
  const pre = deriveLocks({ game, mySet, locks: kept, resolutions, baseChoice: lockBase })
  const preBase = pre.branches.find((b) => b.id === pre.baseId)
  const sideLocked = other !== undefined && pre.lockedStats.includes(other)
  const hShared = side === 'defense' && pre.lockedStats.includes('hp')
  const own: readonly StatId[] = side === 'attack' || hShared ? [v] : ['hp', v]
  const seq = locks.reduce((m, l) => Math.max(m, l.seq), 0) + 1

  /** 무보정 선택지가 쓸 수 있는 갈래(상승이 v도, 반대쪽 쌍 고정 중 반대쪽도 아닌 갈래) */
  const neutralOk = (id: string | null): id is string => id !== null && id !== `plus:${v}` && !(sideLocked && id === `plus:${other}`)
  const neutralTarget = neutralOk(pre.baseId) ? pre.baseId : 'out'
  const choices: { id: AdjustNature['id']; plus: Boostable | null; target: string }[] = [
    { id: 'neutral', plus: null, target: neutralTarget },
    { id: 'plus', plus: v, target: `plus:${v}` },
  ]
  if (sideLocked && other !== undefined) choices.push({ id: 'other-plus', plus: other, target: `plus:${other}` })
  const natures: AdjustNature[] = choices.map((c) => ({ id: c.id, plus: c.plus, nature: preBase?.nature ?? mySet.nature, branchId: c.target, lockedSp: {} }))

  const derive = (lock: Omit<CutLock, 'seq'>, resolution: LockResolution, baseChoice: string | null): LockDerivation => {
    const res = new Map(resolutions)
    res.set(seq, resolution)
    return deriveLocks({ game, mySet, locks: [...kept, { ...lock, seq }], resolutions: res, baseChoice })
  }
  const statsOf = (d: LockDerivation, branch: Branch, plus: Boostable | null): AdjustStat[] => {
    const out: AdjustStat[] = own.map((st) => ({ stat: st, sp: branch.lockedSp[st] ?? 0, plus: st === plus, locked: false }))
    for (const st of d.lockedStats) {
      if (own.includes(st)) continue
      const shown = ((sideLocked || hShared) && (st === 'hp' || st === other)) || (preBase !== undefined && (branch.lockedSp[st] ?? 0) !== (preBase.lockedSp[st] ?? 0))
      if (shown) out.push({ stat: st, sp: branch.lockedSp[st] ?? 0, plus: st === plus, locked: true })
    }
    return out.sort(byStat)
  }
  const upperOf = (stage: string): LockResolution | undefined => {
    const up = ready.find((s) => tierRank(side, s.stage) === tierRank(side, stage) + 1)
    return up?.candidate.resolution
  }

  /** 단계 후보 하나의 선택지 칸들 */
  const cellsOf = (cand: (typeof ready)[number]['candidate']): Cell[] => {
    const lock = cand.lock
    const autoD = derive(lock, cand.resolution, lockBase)
    const auto = autoD.baseId
    const hLock: Omit<CutLock, 'seq'> = { ...lock, allocation: 'h-max' }
    const hResolution = withNext(cand.resolution, upperOf(lock.stage))
    let hAuto: string | null | undefined
    /** H 최대로 걸었을 때 자동 규칙이 고르는 갈래(합 최소와 다를 수 있다) */
    const hAutoOf = (): string | null => (hAuto === undefined ? (hAuto = derive(hLock, hResolution, lockBase).baseId) : hAuto)
    const choiceOf = (l: Omit<CutLock, 'seq'>, target: string, autoId: string | null): PinChoice => (target === autoId ? { lock: l } : { lock: l, base: target })
    // 무보정 갈래: 지금 기준 갈래가 고정을 더한 뒤에도 있으면 그것, 아니면 고정 밖, 아니면 고정 합이 가장 작은 갈래(자동 규칙과 같은 순서)
    const usable = autoD.branches.filter((b) => neutralOk(b.id))
    const neutral =
      usable.find((b) => b.id === pre.baseId) ?? usable.find((b) => b.id === 'out') ?? usable.reduce<Branch | undefined>((m, b) => (m === undefined || b.lockedSum < m.lockedSum ? b : m), undefined)
    return choices.map((c): Cell => {
      const choice = c.id === 'neutral' && neutral !== undefined ? { ...c, target: neutral.id } : c
      const d = derive(lock, cand.resolution, choice.target)
      const status = d.statuses.get(seq)
      if (status?.kind === 'sp-short') return { option: off('budget', status.over), cost: Infinity, pick: null }
      if (status?.kind === 'nature-conflict') return { option: off('no-branch'), cost: Infinity, pick: null }
      if (status?.kind !== 'active') return { option: off('unreachable'), cost: Infinity, pick: null }
      const branch = d.branches.find((b) => b.id === choice.target)
      if (branch === undefined) {
        const o = cand.resolution.kind === 'ok' ? cand.resolution.options : undefined
        const reachable = o !== undefined && (choice.id === 'plus' ? o.plus : o.neutral) !== null
        return { option: off(reachable ? 'no-branch' : 'unreachable'), cost: Infinity, pick: null }
      }
      const stats = statsOf(d, branch, choice.plus)
      const option: Extract<AdjustOption, { kind: 'ok' }> = { kind: 'ok', stats }
      const pick: PinPick = choiceOf(lock, choice.target, auto)
      if (side === 'defense' && !hShared) {
        const h = derive(hLock, hResolution, choice.target)
        const hb = h.statuses.get(seq)?.kind === 'active' ? h.branches.find((b) => b.id === choice.target) : undefined
        // 합 최소보다 H가 높을 때만(같으면 하나만, 변동과 같다)
        if (hb !== undefined && (hb.lockedSp.hp ?? 0) > (branch.lockedSp.hp ?? 0)) {
          option.hMax = statsOf(h, hb, choice.plus)
          pick.hMax = choiceOf(hLock, choice.target, hAutoOf())
        }
      }
      const cost = own.reduce((a, st) => a + (branch.lockedSp[st] ?? 0), 0)
      return { option, cost, pick }
    })
  }

  // 좋은 단계부터(공격 확정1타 → 고난수1타, 방어 확정견딤 → 저난수1타)
  const ordered = [...ready].sort((a, b) => tierRank(side, b.stage) - tierRank(side, a.stage))
  const grid = ordered.map((s) => cellsOf(s.candidate))
  // 정확 규칙: 바로 위 단계의 같은 선택지가 ok이고 비용이 같거나 작으면, 아래 단계 선택지는 고르면 위 단계가 되므로 끈다
  for (let r = 1; r < grid.length; r++) {
    grid[r] = grid[r].map((c, j) => {
      const up = grid[r - 1][j]
      return c.option.kind === 'ok' && up.option.kind === 'ok' && up.cost <= c.cost ? { option: off('unreachable'), cost: Infinity, pick: null } : c
    })
  }

  const myNature = game.data.natures[preBase?.nature ?? mySet.nature]
  const myPlus = myNature === undefined || myNature.plus === myNature.minus ? null : (myNature.plus as StatId)
  const preferred = Math.max(0, choices.findIndex((c) => c.plus === (choices.some((x) => x.plus === myPlus) ? myPlus : null)))
  const results: AdjustResult[] = []
  const picks: (PinPick | null)[][] = []
  let emptyOver: number | undefined
  let conflict = false
  grid.forEach((cells, r) => {
    for (const c of cells) {
      if (c.option.kind !== 'off') continue
      if (c.option.over !== undefined) emptyOver = Math.min(emptyOver ?? Infinity, c.option.over)
      if (c.option.reason === 'no-branch') conflict = true
    }
    const lead = cells[preferred]?.option.kind === 'ok' ? preferred : cells.reduce((best, c, i) => (cells[best].option.kind !== 'ok' || (c.option.kind === 'ok' && c.cost < cells[best].cost) ? i : best), 0)
    if (cells[lead].option.kind !== 'ok') return
    const label = ordered[r].stage as RollTier
    results.push({ label, current: label === input.current, options: cells.map((c) => c.option), lead })
    picks.push(cells.map((c) => c.pick))
  })
  const view: PinMenuView = { state: 'ready', natures, results, picks }
  if (results.length === 0) {
    if (emptyOver !== undefined) view.emptyOver = emptyOver
    view.empty = emptyOver !== undefined ? { kind: 'sp-short', over: emptyOver } : conflict ? { kind: 'nature-conflict' } : { kind: 'none' }
  }
  return view
}

/** 핀 비활성 이유: 메뉴 모델이 준비됐고 고를 수 있는 결과가 하나도 없을 때만(계산 중이면 undefined = 활성) */
export function pinDisabledReason(view: PinMenuView): PinEmptyReason | undefined {
  if (view.state !== 'ready' || view.results.length > 0) return undefined
  return view.empty ?? { kind: 'none' }
}
