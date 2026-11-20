import { describe, expect, it } from 'vitest'
import type { PokemonSet } from '../core'
import type { StatId } from '../data/schema'
import { assembleTab, lockBlockedReason } from './assemble'
import { BASE_CONDITION_ID, itemKey } from './items'
import { opponentKey } from './schedule'
import { buildTabView, resolveLaneLock } from './batch'
import { branchBudget, type CutLock, type LockResolution, type LockTargetKey, type Stairs } from './lock'
import { EXAMPLE_SET } from './__fixtures__/acceptance'
import { readyStage, runLocked, runPlain } from './__fixtures__/lockRun'
import { cardInput, realData } from './testing'
import type { CardInput, CardView, DamageTab, LockStageCandidate, RowLockView, RowView, TabView } from './types'

const { game } = realData()
const reg = game.manifest.regulation.id
const sp = (patch: Partial<Record<StatId, number>>): Record<StatId, number> => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })
const raichu = (nature: string, patch: Partial<Record<StatId, number>> = {}): PokemonSet => ({
  regulation: reg,
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  mega: true,
  nature,
  sp: sp(patch),
  moves: ['thunderbolt', 'focusblast', 'grassknot', 'voltswitch'],
})
const metagross = (patch: Partial<Record<StatId, number>>): PokemonSet => ({
  regulation: reg,
  species: 'metagross',
  ability: 'clearbody',
  item: 'leftovers',
  nature: 'brave',
  sp: sp(patch),
  moves: ['gyroball', 'bulletpunch', 'earthquake', 'ironhead'],
})
/** 메가라이츄Y(합 66): 일렉트로볼은 내 S에 의존한다 */
const electroRaichu: PokemonSet = {
  regulation: reg,
  species: 'raichu',
  ability: 'static',
  item: 'raichunitey',
  mega: true,
  nature: 'timid',
  sp: sp({ hp: 2, spa: 32, spe: 32 }),
  moves: ['thunderbolt', 'electroball', 'grassknot', 'focusblast'],
}
const input = (mySet: PokemonSet, topN = 6): CardInput => cardInput({ mySet, filters: { topN, selected: [] } })

const speedLock = (seq: number): CutLock => ({
  seq,
  kind: 'speed',
  target: { kind: 'speed', origin: 'ladder', opponentId: 'none', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
  stage: 'first',
  stats: ['spe'],
})
const missingTarget = (kind: 'attack' | 'defense'): LockTargetKey => ({ kind, source: 'ladder', opponentId: 'none', category: 'special', bundle: { ladder: '[]' }, item: null, itemKey: '[]' })
const single = (stat: StatId, neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } })
const pairRes = (defense: 'def' | 'spd', neutral: Stairs | null, plus: Stairs | null): LockResolution => ({ kind: 'ok', options: { shape: 'pair', defense, neutral, plus } })
const flat = (v: number): Stairs => new Array<number>(33).fill(v)

/** 모든 카드에서 그 기술 기본 조건 항목을 고른 선택 */
const selectMove = (cards: readonly { opponent: CardView['opponent'] }[], moveId: string): Map<string, string> =>
  new Map(cards.map((c) => [opponentKey(c.opponent), itemKey(moveId, BASE_CONDITION_ID)]))

const allRows = (v: TabView): RowView[] => v.cards.flatMap((c) => c.rows)
const pairLocks = (v: TabView): { card: CardView; lock: RowLockView }[] =>
  v.cards.flatMap((card) => (card.pair?.lock === undefined ? [] : [{ card, lock: card.pair.lock }]))
const rowLocks = (v: TabView): { row: RowView; card: CardView; lock: RowLockView }[] =>
  v.cards.flatMap((card) => card.rows.flatMap((row) => (row.lock === undefined ? [] : [{ row, card, lock: row.lock }])))

/** 고정 조작(control·카드 핀)만 지운 뷰 */
function withoutControls(v: TabView): TabView {
  return JSON.parse(
    JSON.stringify(v, (k, x: unknown) => {
      if (k === 'lockPin') return undefined
      if (k !== 'lock' || typeof x !== 'object' || x === null) return x
      const { control, ...rest } = x as RowLockView
      void control
      return Object.keys(rest).length === 0 ? undefined : rest
    }),
  ) as TabView
}

describe('무고정 조립 동일성(결정 18)', () => {
  it('고정이 없으면 기존 assembleTab·buildTabView와 같고 lock·adjust 필드가 없다', () => {
    for (const mySet of [raichu('hardy'), metagross({ hp: 32, atk: 32, def: 2 })])
      for (const tab of ['attack', 'defense'] as const) {
        const plain = buildTabView(input(mySet), tab)
        const run = runLocked(input(mySet), tab, [])
        expect(run.view).toEqual(plain)
        expect(assembleTab(run.plan, run.results)).toEqual(plain)
        expect(JSON.stringify(plain)).not.toMatch(/"lock"|"adjust"/)
      }
  })

  it('lockControls는 control만 더한다(지우면 기존 뷰와 같다)', () => {
    for (const tab of ['attack', 'defense'] as const) {
      const run = runPlain(input(raichu('hardy')), tab)
      const withControls = assembleTab(run.plan, run.results, run.plan.mySp, new Map(), { lockControls: true })
      expect(JSON.stringify(withControls)).toContain('"control"')
      expect(withoutControls(withControls)).toEqual(run.view)
    }
  })
})

describe('고정 중 예산(결정 16)', () => {
  it('합계 78에서 보는 능력치 SP 0인 행도 0칸은 예산 안이다(기준 갈래 예산은 0 아래로 내려가지 않는다)', () => {
    const mySet = raichu('hardy', { hp: 32, def: 2, spa: 32 })
    const run = runLocked(input(mySet), 'defense', [speedLock(1)], { resolved: new Map([[1, single('spe', 12, 8)]]) })
    expect(run.derivation.overTotal).toBe(12)
    expect(run.view.status).toEqual({ kind: 'ok' })
    const spdRows = allRows(run.view).filter((r) => r.sweepStat === 'spd' && r.cells.length > 0)
    expect(spdRows.length).toBeGreaterThan(0)
    for (const r of spdRows) {
      expect(r.cells[0]).toMatchObject({ overBudget: false, need: 0 })
    }
    // 고정 없는 같은 세트(S12)는 합계 초과 내 세트 오류다
    expect(buildTabView(input({ ...mySet, sp: { ...mySet.sp, spe: 12 } }), 'defense').status.kind).toBe('my-set-error')
  })

  it('칸 예산 = branchBudget(기준 갈래, 표시 SP, 보는 능력치), 표 칸에는 새 표시가 없다', () => {
    const mySet = raichu('hardy', { hp: 20, def: 10 })
    const run = runLocked(input(mySet), 'attack', [speedLock(1)], { resolved: new Map([[1, single('spe', 20, 12)]]) })
    const base = run.derivation.branches.find((b) => b.id === run.derivation.baseId)
    if (base === undefined) throw new Error('기준 갈래 없음')
    const { remaining } = branchBudget(run.derivation, base, run.plan.mySp, ['spa'], 66)
    expect(remaining).toBe(66 - 20 - 30)
    const rows = allRows(run.view).filter((r) => r.cells.length > 0)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows)
      for (const c of r.cells) {
        expect(c.need).toBe(Math.max(0, c.sp - remaining))
        expect(Object.keys(c).filter((k) => !['sp', 'category', 'immune', 'ohkoChance', 'minPercent', 'maxPercent', 'overBudget', 'need'].includes(k))).toEqual([])
      }
  })
})

describe('고정 중 방어 쌍(계단 모드)', () => {
  it('H가 고정된(계단 모드) 방어 탭도 쌍 행마다 합계 띠가 나온다(갱신 중에 머물지 않는다)', () => {
    const mySet = raichu('hardy')
    const stairs: Stairs = Array.from({ length: 33 }, (_, hp) => (hp < 8 ? null : Math.max(4, 20 - hp)))
    const locks: CutLock[] = [{ seq: 1, kind: 'defense', target: missingTarget('defense'), stage: 'guaranteed-survive', stats: ['hp', 'spd'] }]
    const run = runLocked(input(mySet), 'defense', locks, { resolved: new Map([[1, pairRes('spd', stairs, flat(0))]]) })
    expect(run.view.complete).toBe(true)
    // 화면이 띠를 기다리는(갱신 중) 쌍 = 변동 있는 행이 있는 쌍
    const variable = run.view.cards.filter((c) => c.pair !== undefined && c.rows.some((r) => r.status === 'ok' && !r.noChange && r.cells.length > 0))
    expect(variable.length).toBeGreaterThan(0)
    for (const c of variable) expect(c.pair?.band !== undefined || c.pair?.error !== undefined).toBe(true)
  })
})

describe('갈래 파생·고정 표시(R8·AC16)', () => {
  it('공격 컷 + 스피드 컷: 갈래 = 고정 합 66 이하·무보정안이 있는 갈래(갈래 순)', () => {
    const mySet = raichu('hardy')
    const locks: CutLock[] = [speedLock(1), { seq: 2, kind: 'attack', target: missingTarget('attack'), stage: 'high-roll-ohko', stats: ['spa'] }]
    const resolved = new Map([
      [1, single('spe', 23, 8)],
      [2, single('spa', 21, 14)],
    ])
    const run = runLocked(input(mySet), 'defense', locks, { resolved })
    // 상승 C(C14 + S23 = 37), 상승 S(C21 + S8 = 29), 고정 밖(C21 + S23 = 44) 모두 66 이하
    expect(run.derivation.branches.map((b) => b.id)).toEqual(['plus:spe', 'plus:spa', 'out'])

    // S가 상승안으로만 닿으면 상승 S 갈래만 남는다(상승 C·고정 밖 갈래는 S 무보정안이 없다)
    const conflict = runLocked(input(mySet), 'defense', locks, {
      resolved: new Map([
        [1, single('spe', null, 23)],
        [2, single('spa', 21, 14)],
      ]),
    })
    expect(conflict.derivation.branches.map((b) => b.id)).toEqual(['plus:spe'])
  })

  it('하락 자리가 없는 행은 dropWarning이고 정렬에서 빠지지 않는다', () => {
    const mySet = raichu('hardy')
    const locks: CutLock[] = [
      speedLock(1),
      { seq: 2, kind: 'attack', target: missingTarget('attack'), stage: 'high-roll-ohko', stats: ['atk'] },
      { seq: 3, kind: 'defense', target: missingTarget('defense'), stage: 'guaranteed-survive', stats: ['hp', 'def'] },
      { seq: 4, kind: 'defense', target: missingTarget('defense'), stage: 'guaranteed-survive', stats: ['hp', 'spd'] },
    ]
    const resolved = new Map([
      [1, single('spe', 20, 12)],
      [2, single('atk', 10, 4)],
      [3, pairRes('def', flat(0), flat(0))],
      [4, pairRes('spd', flat(0), flat(0))],
    ])
    const run = runLocked(input(mySet), 'attack', locks, { resolved, baseChoice: 'plus:spe', demand: true })
    expect(run.derivation.baseId).toBe('plus:spe')
    const plain = runLocked(input(mySet), 'attack', [])
    expect(run.view.cards.map((c) => c.id)).toEqual(plain.view.cards.map((c) => c.id))
    const warned = rowLocks(run.view).filter((x) => x.lock.dropWarning === true)
    expect(warned.length).toBeGreaterThan(0)
  })

  it('고정 컷 자신의 행에 lockedBy가 있고 다른 행에는 없다', () => {
    const mySet = raichu('hardy')
    const plain = runPlain(input(mySet), 'attack')
    const v = assembleTab(plain.plan, plain.results, plain.plan.mySp, new Map(), { lockControls: true })
    const hit = rowLocks(v).find((x) => readyStage(x.lock.control) !== undefined)
    const ready = hit === undefined ? undefined : readyStage(hit.lock.control)
    if (hit === undefined || ready === undefined) throw new Error('고정 가능한 공격 행 없음')
    const lock: CutLock = { ...ready.lock, seq: 1 }
    const run = runLocked(input(mySet), 'attack', [lock])
    expect(run.derivation.statuses.get(1)).toEqual({ kind: 'active' })
    const self = rowLocks(run.view).find((x) => x.row.id === hit.row.id)
    expect(self?.lock.lockedBy).toEqual([1])
    expect(rowLocks(run.view).some((x) => x.row.id !== hit.row.id && x.lock.lockedBy !== undefined)).toBe(false)
  })
})

describe('고정 조작(R1·R2·결정 6)', () => {
  const controlsOf = (mySet: PokemonSet, tab: DamageTab, selections: ReadonlyMap<string, string> = new Map()) => {
    const run = runPlain(input(mySet, 12), tab, selections)
    return { run, view: assembleTab(run.plan, run.results, run.plan.mySp, selections, { lockControls: true }) }
  }

  it('AC11: 내 S에 의존하는 일렉트로볼 행은 blocked, 10만볼트 행은 lockable(현재 판정과 무관하게 두 단계)', () => {
    const mySet = electroRaichu
    const cards = runPlain(input(mySet, 12), 'attack').plan.cards
    const electroView = controlsOf(mySet, 'attack', selectMove(cards, 'electroball')).view
    const electro = rowLocks(electroView).filter((x) => x.row.moveId === 'electroball' && x.lock.control !== undefined)
    expect(electro.length).toBeGreaterThan(0)
    for (const g of electro) expect(g.lock.control).toEqual({ kind: 'blocked', reason: 'depends-other-stat' })
    const { run, view } = controlsOf(mySet, 'attack', selectMove(cards, 'thunderbolt'))
    const iron = rowLocks(view).filter((x) => x.row.moveId === 'thunderbolt' && x.lock.control !== undefined)
    expect(iron.length).toBeGreaterThan(0)
    expect(iron.some((x) => x.lock.control?.kind === 'lockable')).toBe(true)
    for (const x of iron) {
      expect(run.plan.rows[x.row.id].dependsOn).toEqual([])
      // 모든 단계가 SP 0에서 이미 충족되거나(판정이 SP와 무관) 어느 단계에도 닿지 않는 행은 방어 탭처럼 고정 불가다
      if (x.lock.control?.kind !== 'lockable') expect(['fixed-value', 'unreachable-stage']).toContain(x.lock.control?.kind === 'blocked' ? x.lock.control.reason : undefined)
    }
    for (const { row, lock } of rowLocks(view)) if (row.noChange && lock.control !== undefined && lock.control.kind !== 'blocked') {
      const stages = lock.control.stages
      expect(stages.some((s) => s.candidate.kind !== 'ready' || (s.candidate.resolution.kind === 'ok' && s.candidate.resolution.options.shape === 'single' && [s.candidate.resolution.options.neutral, s.candidate.resolution.options.plus].some((sp) => sp !== null && sp > 0)))).toBe(true)
    }
    for (const { lock } of rowLocks(view)) {
      if (lock.control?.kind !== 'lockable') continue
      expect(lock.control.stages.map((s) => s.stage)).toEqual(['high-roll-ohko', 'guaranteed-ohko'])
    }
    // 목표 단계가 고정 단계가 아닌 행(가장 약한 판정 구간)의 조작은 e2e "R2: 현재 판정이 고난수1타인 방어 카드" 가 본다

  })

  it('방어 조작은 필터 dependsOn으로 판정한다(행 dependsOn에는 짝 능력치가 있어도 lockable)', () => {
    const { run, view } = controlsOf(raichu('hardy'), 'defense')
    const lockable = pairLocks(view).filter((x) => x.lock.control?.kind === 'lockable')
    expect(lockable.length).toBeGreaterThan(0)
    for (const { card, lock } of lockable) {
      if (lock.control?.kind !== 'lockable') continue
      expect(lock.control.stages.map((s) => s.stage)).toEqual(['low-roll-ohko', 'guaranteed-survive'])
      const spec = run.plan.cards.find((c) => c.id === card.id)
      const rows = (spec?.rowIds ?? []).map((id) => run.plan.rows[id]).filter((r) => r.gate !== undefined && card.rows.some((v) => v.id === r.id))
      expect(rows.length).toBe(2)
      expect(rows.every((r) => r.dependsOn.length > 0)).toBe(true)
      expect(run.plan.filters[rows[0].gate as string].dependsOn).toEqual([])
    }
  })

  it('방어 후보는 고정 단계 계단이 없으면 computing(그 작업), 계산하면 ready이고 레인 해석과 같다', () => {
    const mySet = raichu('hardy')
    const { view } = controlsOf(mySet, 'defense')
    const hit = pairLocks(view).find((x) => x.lock.control?.kind === 'lockable')
    if (hit?.lock.control?.kind !== 'lockable') throw new Error('고정 가능한 방어 쌍 없음')
    for (const { candidate: cand } of hit.lock.control.stages) {
      expect(cand.kind).toBe('computing')
      if (cand.kind !== 'computing') return
      expect(cand.tasks?.length).toBeGreaterThan(0)
      expect(cand.tasks?.every((t) => t.kind === 'stairs' && t.hpMin === 0)).toBe(true)
    }
    const done = runLocked(input(mySet, 12), 'defense', [], { demand: true })
    const ready = pairLocks(done.view).find((x) => x.card.id === hit.card.id)?.lock.control
    if (ready?.kind !== 'lockable') throw new Error('후보가 준비되지 않음')
    for (const { candidate } of ready.stages) {
      if (candidate.kind !== 'ready') throw new Error('후보가 준비되지 않음')
      expect(candidate.resolution).toEqual(resolveLaneLock(input(mySet, 12), { ...candidate.lock, seq: 1 }))
    }
  })

  it('공격 후보 해석 = 레인 해석', () => {
    const mySet = raichu('hardy')
    const { view } = controlsOf(mySet, 'attack')
    const ready = rowLocks(view).filter((x) => x.lock.control?.kind === 'lockable')
    expect(ready.length).toBeGreaterThan(0)
    for (const { lock } of ready.slice(0, 4)) {
      if (lock.control?.kind !== 'lockable') throw new Error('후보 대기')
      for (const { candidate } of lock.control.stages) {
        if (candidate.kind !== 'ready') throw new Error('후보 대기')
        expect(candidate.resolution).toEqual(resolveLaneLock(input(mySet, 12), { ...candidate.lock, seq: 1 }))
      }
    }
  })
})

describe('컷 전체 고정 불가 이유', () => {
  const stage = (s: LockStageCandidate['stage'], resolution: LockResolution): LockStageCandidate => ({
    stage: s,
    candidate: { kind: 'ready', lock: { kind: 'attack', target: missingTarget('attack'), stage: s, stats: ['atk'] }, resolution },
  })

  it('SP가 필요한 단계가 있거나 계산 중이면 이유 없음(고정 가능)', () => {
    expect(lockBlockedReason([stage('high-roll-ohko', single('atk', 0, 0)), stage('guaranteed-ohko', single('atk', 20, 12))])).toBeUndefined()
    expect(lockBlockedReason([stage('high-roll-ohko', { kind: 'unreachable' }), { stage: 'guaranteed-ohko', candidate: { kind: 'computing' } }])).toBeUndefined()
  })

  it('낮은 단계가 SP 0에서 이미 충족되면 fixed-value(높은 단계가 닿지 않아도)', () => {
    expect(lockBlockedReason([stage('high-roll-ohko', single('atk', 0, 0)), stage('guaranteed-ohko', single('atk', 0, 0))])).toBe('fixed-value')
    expect(lockBlockedReason([stage('high-roll-ohko', single('atk', null, 0)), stage('guaranteed-ohko', { kind: 'unreachable' })])).toBe('fixed-value')
  })

  it('어느 단계에도 닿지 않으면 SP에 따라 결과가 바뀌어도 고정할 단계가 없어 unreachable-stage', () => {
    expect(lockBlockedReason([stage('high-roll-ohko', { kind: 'unreachable' }), stage('guaranteed-ohko', { kind: 'unreachable' })])).toBe('unreachable-stage')
    expect(lockBlockedReason([stage('high-roll-ohko', single('atk', null, null)), stage('guaranteed-ohko', { kind: 'unreachable' })])).toBe('unreachable-stage')
  })
})

describe('카드 줄 핀(결정 17 개정)', () => {
  it('공격: 핀 조작 = 보이는 행의 조작, 고정 조작을 내지 않는 조립(기본)에는 핀이 없다', () => {
    const mySet = raichu('hardy')
    const run = runPlain(input(mySet), 'attack')
    expect(run.view.cards.every((c) => c.lockPin === undefined)).toBe(true)
    const v = assembleTab(run.plan, run.results, run.plan.mySp, new Map(), { lockControls: true })
    expect(v.cards.length).toBeGreaterThan(0)
    for (const card of v.cards) {
      const rowControl = card.rows.find((r) => r.lock?.control !== undefined)?.lock?.control
      expect(card.lockPin).toBeDefined()
      if (rowControl !== undefined) expect(card.lockPin?.control).toBe(rowControl)
      else expect(card.lockPin?.control.kind).toBe('blocked')
    }
  })

  it('방어: 극단 필터 통과 쌍은 쌍 조작, 통과하지 못한 카드는 fixed-value', () => {
    const run = runPlain(input(raichu('hardy'), 12), 'defense')
    const v = assembleTab(run.plan, run.results, run.plan.mySp, new Map(), { lockControls: true })
    const paired = v.cards.filter((c) => c.pair?.lock?.control !== undefined)
    expect(paired.length).toBeGreaterThan(0)
    for (const c of paired) expect(c.lockPin?.control).toBe(c.pair?.lock?.control)
    const fixed = v.cards.filter((c) => c.pair === undefined && c.rows.length > 0 && c.rows.every((r) => r.status === 'ok' && r.noChange))
    for (const c of fixed) expect(c.lockPin?.control).toEqual({ kind: 'blocked', reason: 'fixed-value' })
  })

  it('방어: 현재 판정이 고난수1타인 카드(예시 세트 대도각참 생명의구슬 +2 기습)도 두 단계 조작이고, 계산하면 두 단계 모두 고를 수 있다', () => {
    const example = input(EXAMPLE_SET, 12)
    const isTarget = (c: CardView) => c.opponent.id === 'kingambit' && c.berry?.item === 'lifeorb'
    const plain = runPlain(example, 'defense')
    const v = assembleTab(plain.plan, plain.results, plain.plan.mySp, new Map(), { lockControls: true })
    const card = v.cards.find(isTarget)
    if (card === undefined) throw new Error('대도각참 생명의구슬 카드 없음')
    const hl = card.headline
    const headline = hl.kind === 'row' ? card.rows.find((r) => r.id === hl.rowId) : undefined
    expect(headline?.current.category).toBe('high-roll-ohko')
    const control = card.lockPin?.control
    if (control?.kind !== 'lockable') throw new Error(`고정 가능하지 않음: ${JSON.stringify(control)}`)
    expect(control.stages.map((s) => s.stage)).toEqual(['low-roll-ohko', 'guaranteed-survive'])

    const done = runLocked(example, 'defense', [], { demand: true })
    const ready = done.view.cards.find(isTarget)?.lockPin?.control
    if (ready?.kind !== 'lockable') throw new Error('후보가 준비되지 않음')
    for (const { stage, candidate } of ready.stages) {
      if (candidate.kind !== 'ready') throw new Error(`${stage} 후보 대기`)
      expect(candidate.resolution.kind, stage).toBe('ok')
      expect(candidate.lock.stage).toBe(stage)
    }
  })

  it('lockedBy는 그 카드의 다른 기술 컷 고정도 센다(보이는 기술이 아니어도)', () => {
    const mySet = raichu('hardy')
    const plain = runPlain(input(mySet), 'attack')
    const v = assembleTab(plain.plan, plain.results, plain.plan.mySp, new Map(), { lockControls: true })
    const hits = rowLocks(v).filter((x) => readyStage(x.lock.control) !== undefined && x.card.items.length > 1)
    let checked = false
    for (const hit of hits) {
      const ready = readyStage(hit.lock.control)
      const other = hit.card.items.find((i) => i.key !== hit.card.shownItem)
      if (ready === undefined || other === undefined) continue
      const selections = new Map([[opponentKey(hit.card.opponent), other.key]])
      const run = runLocked(input(mySet), 'attack', [{ ...ready.lock, seq: 1 }], { selections })
      const card = run.view.cards.find((c) => c.id === hit.card.id)
      if (card === undefined) continue
      expect(card.shownItem).toBe(other.key)
      expect(card.lockPin?.lockedBy).toEqual([1])
      checked = true
      break
    }
    expect(checked, '기술이 여럿인 고정 가능 카드 없음').toBe(true)
  })
})
