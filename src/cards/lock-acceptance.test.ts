// AC2 속성: 고정 중 조정 선택지(카드 조정 모델)·스피드 갈래 줄의 SP를 고정 SP와 그 갈래 성격을 내 세트에 손으로 넣은 기존 경로(고정 없는 계획)로 다시 판정해 대조한다.
import { describe, expect, it } from 'vitest'
import { tierRank, type PokemonSet } from '../core'
import type { StatId } from '../data/schema'
import { assembleTab } from './assemble'
import { createLruCache } from './cache'
import { BASE_CONDITION_ID, cardItems, itemKey } from './items'
import { type Branch, type CutLock, type LockDerivation, type LockResolution } from './lock'
import { buildSpeedChart, type SpeedBadge } from './speedChart'
import { minSpToPass } from './speedLadder'
import { resolveSpeedLocks, speedBadgeLockKey, speedBranchLines } from './speedLock'
import { planTab } from './plan'
import { computeRowTask } from './rowTask'
import { opponentKey } from './schedule'
import { readyStage, runLocked, runPlain, type LockRun } from './__fixtures__/lockRun'
import { cardInput, realData } from './testing'
import { DEFAULT_CRITERIA, type CardInput, type CardView, type TabPlan } from './types'

const { game, bo1 } = realData()
const reg = game.manifest.regulation.id
const SP_TOTAL = game.manifest.rules.spTotal
const STATS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const sp = (patch: Partial<Record<StatId, number>>): Record<StatId, number> => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })
const cache = createLruCache(200_000)

/** AC1 세트: 메가라이츄Y, 무보정, SP 전부 0, 메가스톤 외 도구 없음 */
const raichuY = (nature = 'hardy', patch: Partial<Record<StatId, number>> = {}, moves = ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch']): PokemonSet => ({
  regulation: reg,
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  mega: true,
  nature,
  sp: sp(patch),
  moves,
})
const input = (mySet: PokemonSet, topN = 6): CardInput => cardInput({ mySet, filters: { topN, selected: [] } })
const single = (stat: StatId, neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } })
const speedLockOf = (seq: number, badge?: SpeedBadge): CutLock => ({
  seq,
  kind: 'speed',
  target: badge === undefined ? { kind: 'speed', origin: 'ladder', opponentId: 'none', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null } : speedBadgeLockKey(badge),
  stage: 'first',
  stats: ['spe'],
})
const selectMove = (plan: TabPlan, moveId: string): Map<string, string> => new Map(plan.cards.map((c) => [opponentKey(c.opponent), itemKey(moveId, BASE_CONDITION_ID)]))

/** 손으로 넣은 세트: 고정 SP + 갈래 성격 */
const manualSet = (mySet: PokemonSet, b: Branch): PokemonSet => ({ ...mySet, nature: b.nature, sp: { ...mySet.sp, ...b.lockedSp } })
const branchOf = (d: LockDerivation, id: string): Branch => {
  const b = d.branches.find((x) => x.id === id)
  if (b === undefined) throw new Error(`갈래 ${id} 없음`)
  return b
}

/** 기존 경로 n·SP 부족: 손 세트에서 보는 능력치를 뺀 SP 합을 쓴 예산(고정 안 한 다른 능력치 합 = othersSp) */
function manualBudget(manual: PokemonSet, view: readonly StatId[], d: LockDerivation, needSum: number) {
  const rest = STATS.reduce((a, s) => (view.includes(s) ? a : a + manual.sp[s]), 0)
  const othersSp = STATS.reduce((a, s) => (view.includes(s) || d.lockedStats.includes(s) ? a : a + manual.sp[s]), 0)
  const n = needSum - Math.max(0, SP_TOTAL - rest)
  return n <= 0 ? { kind: 'fits' as const } : n > othersSp ? { kind: 'short' as const, m: n - othersSp } : { kind: 'need' as const, n }
}

/** 보이는 항목의 행 작업 대상(공격 행 id·방어 필터 id) */
function shownTarget(plan: TabPlan, card: CardView): { target: 'row' | 'filter'; id: string } {
  const spec = plan.cards.find((c) => c.id === card.id)
  const ref = spec === undefined ? undefined : cardItems(plan, spec).find((r) => r.key === card.shownItem)
  if (ref === undefined || ref.candidate.target === 'fixed') throw new Error(`카드 ${card.id}의 보이는 항목이 없다`)
  return { target: ref.candidate.target, id: ref.candidate.id }
}

/**
 * 조정 모델의 모든 ok 선택지를 손 세트(내 세트 SP에서 고정·조정 능력치를 바꾸고 keep 밖은 0, 판정 성격)로 다시 판정한다.
 * lead 선택지는 그 결과와 같고 나머지 ok 선택지는 그 결과 이상이다. H 최대 배분은 그 결과와 같다. 대조한 배분 수
 */
function checkAdjust(run: LockRun, mySet: PokemonSet, topN: number, card: CardView): number {
  const adjust = card.adjust
  if (adjust?.state !== 'ready') throw new Error(`카드 ${card.id} 조정 모델이 준비되지 않았다: ${adjust?.state}`)
  const tab = run.plan.tab
  const side = tab === 'attack' ? 'attack' : 'defense'
  const shown = shownTarget(run.plan, card)
  let checked = 0
  for (const result of adjust.results)
    result.options.forEach((o, i) => {
      if (o.kind !== 'ok') return
      const choice = adjust.natures[i]
      const judge = (stats: typeof o.stats) => {
        const manualSp = sp(Object.fromEntries(adjust.keep.map((s) => [s, mySet.sp[s]])))
        Object.assign(manualSp, choice.lockedSp)
        for (const st of stats) manualSp[st.stat] = st.sp
        const plan = planTab(input({ ...mySet, sp: manualSp, nature: choice.nature }, topN), tab)
        expect(plan.status).toEqual({ kind: 'ok' })
        const r = computeRowTask(plan, { kind: 'probe', target: shown.target, id: shown.id }, cache)
        if (r.kind !== 'probe') throw new Error(`단건 판정 실패: ${JSON.stringify(r)}`)
        return r.cell.category
      }
      const got = judge(o.stats)
      if (i === result.lead) expect(got, `${card.id} ${result.label} lead`).toBe(result.label)
      else expect(tierRank(side, got)).toBeGreaterThanOrEqual(tierRank(side, result.label))
      checked++
      if (o.hMax === undefined) return
      expect(judge(o.hMax), `${card.id} ${result.label} ${i} H 최대`).toBe(result.label)
      checked++
    })
  return checked
}

function chartBadges() {
  return buildSpeedChart({ game, view: bo1, myAbility: 'static', criteria: { ...DEFAULT_CRITERIA }, filters: { topN: 200, selected: [] }, customTargets: [], added: [] }).badges
}
/** S 종족값 120 래더 상대의 기본 배지 중 (S32, sign) 배분, 사용률 순위 최상위 */
function badge120(sign: 'plus' | 'neutral'): SpeedBadge {
  const found = chartBadges()
    .filter((b) => b.origin === 'ladder' && b.condition.kind === 'none' && game.data.species[b.speciesId].baseStats.spe === 120 && b.bundle.sp === 32 && b.bundle.nature === sign)
    .sort((a, b) => a.usageRank - b.usageRank)[0]
  if (found === undefined) throw new Error(`120족 ${sign} 배지 없음`)
  return found
}
const speedResolutions = (mySet: PokemonSet, locks: readonly CutLock[]) =>
  resolveSpeedLocks({ game, view: bo1, mySet, locks, criteria: { ...DEFAULT_CRITERIA }, customTargets: [], added: [], myTailwind: false })

describe('AC2: 메가라이츄Y 스피드 컷 고정 → 방어 탭 조정 선택지 = 손 세트 기존 판정', () => {
  it('최속 120족(실수치 189) 고정: S23+ 갈래 하나, 첫 방어 카드(sneasler) 고난수1타 무보정 선택지 H2 B24(H 최대 H32 B7), B 상승은 갈래 없음', () => {
    const mySet = raichuY()
    const badge = badge120('plus')
    expect(badge.speed).toBe(189)
    const locks = [speedLockOf(1, badge)]
    const speed = speedResolutions(mySet, locks)
    expect(speed.get(1)).toEqual(single('spe', null, 23))
    const run = runLocked(input(mySet), 'defense', locks, { speed, demand: true, cache })
    expect(run.derivation.branches.map((b) => [b.id, b.nature, b.lockedSp])).toEqual([['plus:spe', 'jolly', { spe: 23 }]])
    const first = run.view.cards[0]
    expect(first.opponent.id).toBe('sneasler')
    const adjust = first.adjust
    expect(adjust?.state).toBe('ready')
    expect(adjust?.natures.map((n) => [n.id, n.branchId, n.lockedSp, n.off])).toEqual([
      ['neutral', 'plus:spe', { spe: 23 }, undefined],
      ['plus', null, {}, 'no-branch'],
    ])
    const high = adjust?.results.find((r) => r.label === 'high-roll-ohko')
    expect(high?.options).toEqual([
      {
        kind: 'ok',
        stats: [
          { stat: 'hp', sp: 2, plus: false, locked: false },
          { stat: 'def', sp: 24, plus: false, locked: false },
        ],
        // H 최대: 예산 66 − 23 = 43 안에서 H32, 그 H에서 고난수1타에 닿는 최소 B7
        hMax: [
          { stat: 'hp', sp: 32, plus: false, locked: false },
          { stat: 'def', sp: 7, plus: false, locked: false },
        ],
      },
      { kind: 'off', reason: 'no-branch' },
    ])
    expect(checkAdjust(run, mySet, 6, first)).toBeGreaterThan(0)
  })

  it('준속 120족(172) 고정: S8+·S23 두 갈래, 기준이 S8+면 B·D 상승은 S23(고정 밖) 갈래로 바뀌고 모든 선택지가 손 세트 판정과 같다', () => {
    const mySet = raichuY()
    const locks = [speedLockOf(1, badge120('neutral'))]
    const speed = speedResolutions(mySet, locks)
    expect(speed.get(1)).toEqual(single('spe', 23, 8))
    for (const [baseChoice, natures] of [
      [null, [['neutral', 'out', { spe: 23 }], ['plus', 'out', { spe: 23 }]]],
      ['plus:spe', [['neutral', 'plus:spe', { spe: 8 }], ['plus', 'out', { spe: 23 }]]],
    ] as const) {
      const run = runLocked(input(mySet), 'defense', locks, { speed, baseChoice, demand: true, cache })
      expect(run.derivation.branches.map((b) => b.id)).toEqual(['plus:spe', 'out'])
      const ready = run.view.cards.filter((c) => c.adjust?.state === 'ready')
      expect(ready.length).toBeGreaterThan(0)
      for (const c of ready) expect(c.adjust?.natures.map((n) => [n.id, n.branchId, n.lockedSp])).toEqual(natures)
      expect(ready.reduce((n, c) => n + checkAdjust(run, mySet, 6, c), 0)).toBeGreaterThan(4)
    }
  })
})

describe('AC2: 공격 탭', () => {
  it('공격 컷(C) 고정 중 C를 보는 카드는 조정할 능력치가 고정이라 locked다', () => {
    const mySet = raichuY()
    const plain = runPlain(input(mySet, 12), 'attack', new Map(), cache)
    const controls = assembleTab(plain.plan, plain.results, plain.plan.mySp, new Map(), { lockControls: true })
    const cut = controls.cards.flatMap((c) => c.rows).find((r) => readyStage(r.lock?.control) !== undefined)
    const ready = readyStage(cut?.lock?.control)
    if (ready === undefined) throw new Error('고정 가능한 행 없음')
    const lock: CutLock = { ...ready.lock, seq: 1 }
    const run = runLocked(input(mySet, 12), 'attack', [lock], { demand: true, cache })
    expect(run.derivation.statuses.get(1)).toEqual({ kind: 'active' })
    expect(run.derivation.lockedStats).toEqual(['spa'])
    const withAdjust = run.view.cards.filter((c) => c.adjust !== undefined)
    expect(withAdjust.length).toBeGreaterThan(0)
    for (const c of withAdjust) expect(c.adjust?.state).toBe('locked')
  })

  it('S 고정 중 일렉트로볼(S 의존)·10만볼트 카드의 조정 선택지가 손 세트(S 고정 SP·판정 성격)와 같다', () => {
    const mySet = raichuY('timid', { hp: 2, spa: 32, spe: 32 }, ['thunderbolt', 'electroball', 'grassknot', 'focusblast'])
    const locks = [speedLockOf(1)]
    const resolved = new Map([[1, single('spe', 32, 28)]])
    const probe = runLocked(input(mySet, 12), 'attack', locks, { resolved })
    for (const moveId of ['electroball', 'thunderbolt']) {
      const selections = selectMove(probe.plan, moveId)
      const run = runLocked(input(mySet, 12), 'attack', locks, { resolved, selections, demand: true, cache })
      expect(run.derivation.branches.map((b) => b.id)).toEqual(['plus:spe', 'out'])
      const cards = run.view.cards.filter((c) => c.adjust?.state === 'ready' && c.rows.some((r) => r.moveId === moveId))
      expect(cards.length, moveId).toBeGreaterThan(0)
      expect(cards.slice(0, 3).reduce((n, c) => n + checkAdjust(run, mySet, 12, c), 0)).toBeGreaterThan(0)
    }
  })

  it('S 고정 중 자이로볼(메타그로스)·애널리틱(스타미) 카드의 조정 선택지가 손 세트와 같다', () => {
    const cases: { set: PokemonSet; moveId: string; lock: LockResolution }[] = [
      {
        set: { regulation: reg, species: 'metagross', ability: 'clearbody', item: 'leftovers', nature: 'brave', sp: sp({ hp: 2, atk: 32 }), moves: ['gyroball', 'bulletpunch', 'earthquake', 'ironhead'] },
        moveId: 'gyroball',
        lock: single('spe', 10, 4),
      },
      {
        set: { regulation: reg, species: 'starmie', ability: 'analytic', nature: 'timid', sp: sp({ hp: 2, spa: 32 }), moves: ['hydropump', 'psychic', 'icebeam', 'thunderbolt'] },
        moveId: 'hydropump',
        lock: single('spe', 20, 12),
      },
    ]
    for (const c of cases) {
      const locks = [speedLockOf(1)]
      const resolved = new Map([[1, c.lock]])
      const probe = runLocked(input(c.set, 20), 'attack', locks, { resolved })
      const selections = selectMove(probe.plan, c.moveId)
      const run = runLocked(input(c.set, 20), 'attack', locks, { resolved, selections, demand: true, cache })
      expect(run.plan.rows[Object.keys(run.plan.rows).find((id) => run.plan.rows[id].moveId === c.moveId) as string].dependsOn).toContain('spe')
      const cards = run.view.cards.filter((v) => v.adjust?.state === 'ready' && v.rows.some((r) => r.moveId === c.moveId))
      expect(cards.length, c.moveId).toBeGreaterThan(0)
      expect(cards.slice(0, 3).reduce((n, v) => n + checkAdjust(run, c.set, 20, v), 0)).toBeGreaterThan(0)
    }
  })
})

describe('AC2: 스피드 탭(speedBranchLines)', () => {
  it('공격 컷(C) 고정 중 준속 120족 배지 갈래 줄 = 손 세트(C 고정 SP·갈래 성격)의 minSpToPass', () => {
    const mySet = raichuY()
    const plain = runPlain(input(mySet, 12), 'attack', new Map(), cache)
    const controls = assembleTab(plain.plan, plain.results, plain.plan.mySp, new Map(), { lockControls: true })
    const cut = controls.cards.flatMap((c) => c.rows).find((r) => readyStage(r.lock?.control) !== undefined)
    const ready = readyStage(cut?.lock?.control)
    if (ready === undefined) throw new Error('고정 가능한 행 없음')
    const run = runLocked(input(mySet, 12), 'attack', [{ ...ready.lock, seq: 1 }], { cache })
    const badge = badge120('neutral')
    const base = branchOf(run.derivation, run.derivation.baseId as string)
    const lines = speedBranchLines({ game, mySet: manualSet(mySet, base), derivation: run.derivation, badge, myTailwind: false, mySp: mySet.sp, spTotal: SP_TOTAL })
    expect(lines.length).toBe(run.derivation.branches.length)
    for (const l of lines) {
      const b = branchOf(run.derivation, l.branchId)
      const manual = manualSet(mySet, b)
      const r = minSpToPass(game, manual, badge.speed, false)
      for (const [which, o] of [
        ['neutral', l.neutral],
        ['plus', l.plus],
      ] as const) {
        if (o === null || o === 'omitted') continue
        const m = r?.[which]
        const want = m?.kind === 'ok' ? m.sp : null
        expect(o.stats).toEqual([{ stat: 'spe', sp: want }])
        expect(o.budget).toEqual(manualBudget(manual, ['spe'], run.derivation, want as number))
      }
    }
  })
})
