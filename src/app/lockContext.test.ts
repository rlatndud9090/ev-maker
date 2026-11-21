import { describe, expect, it } from 'vitest'
import { deriveLocks, pinDisabledReason, type CardLockPin, type CutLock, type LockResolution, type LockStage, type LockStageCandidate, type LockTargetKey, type PinMenuView } from '../cards'
import { realData } from '../cards/testing'
import { toPokemonSet } from '../ui/setDraft'
import { EXAMPLE_DRAFT } from './example'
import type { LockSnapshot } from './executor'
import { lockUiValue } from './lockContext'
import type { AppAction } from './state'

const { game } = realData()

const lock: Omit<CutLock, 'seq'> = {
  kind: 'defense',
  target: { kind: 'defense', source: 'ladder', opponentId: 'opp', category: 'physical', bundle: { ladder: 'k' }, item: null, itemKey: 'earthquake' },
  stage: 'guaranteed-survive',
  stats: ['hp', 'def'],
}

/** 결과 하나·성격 선택지 하나(합 최소 H4 B20, H 최대 H32 B0). H 최대 고정은 자동 규칙 갈래가 달라 기준 갈래를 싣는다 */
const view: PinMenuView = {
  state: 'ready',
  natures: [{ id: 'plus', plus: 'def', nature: 'hardy', branchId: 'plus:def', lockedSp: {} }],
  results: [
    {
      label: 'guaranteed-survive',
      current: false,
      lead: 0,
      options: [
        {
          kind: 'ok',
          stats: [
            { stat: 'hp', sp: 4, plus: false, locked: false },
            { stat: 'def', sp: 20, plus: true, locked: false },
          ],
          hMax: [
            { stat: 'hp', sp: 32, plus: false, locked: false },
            { stat: 'def', sp: 0, plus: true, locked: false },
          ],
        },
      ],
    },
  ],
  picks: [[{ lock, hMax: { lock: { ...lock, allocation: 'h-max' }, base: 'plus:def' } }]],
}

function pinLockActions(allocation: 'min-sum' | 'h-max', v: PinMenuView = view): AppAction[] {
  const sent: AppAction[] = []
  const ui = lockUiValue({
    game,
    state: { draft: EXAMPLE_DRAFT, locks: [], lockBase: null, lockReveal: null, lockTrim: null },
    snapshot: null,
    runGeneration: 0,
    dispatch: (a) => sent.push(a),
    onAdjustCard: () => {},
    onPinMenu: () => {},
  })
  ui.pinLock(v, 0, 0, allocation)
  return sent
}

describe('lockUi.pinLock', () => {
  const spTotal = game.manifest.rules.spTotal

  it('합 최소는 그 고정 그대로, 고른 값(메뉴에 보인 고정 뒤 값)을 addingSp로 보낸다', () => {
    expect(pinLockActions('min-sum')).toEqual([{ type: 'add-lock', lock, spTotal, addingSp: { hp: 4, def: 20 } }])
  })

  it('H 최대는 그 배분의 고정·기준 갈래(hMax)를 쓰고 H 최대 값을 addingSp로 보낸다', () => {
    expect(pinLockActions('h-max')).toEqual([{ type: 'add-lock', lock: { ...lock, allocation: 'h-max' }, spTotal, base: 'plus:def', addingSp: { hp: 32, def: 0 } }])
  })

  it('H 최대 고정이 없는 선택지는 H 최대를 무시한다', () => {
    expect(pinLockActions('h-max', { ...view, picks: [[{ lock }]] })).toEqual([])
  })
})

describe('lockUi.pinDisabled(speed-bundles-pin-disable R6·AC10)', () => {
  const speedLock: CutLock = {
    seq: 1,
    kind: 'speed',
    target: { kind: 'speed', origin: 'ladder', opponentId: 's', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null },
    stage: 'first',
    stats: ['spe'],
  }
  const single = (stat: 'atk' | 'spe', neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } })
  const atkTarget: LockTargetKey = { kind: 'attack', source: 'ladder', opponentId: 'opp', category: 'physical', bundle: { ladder: 'k' }, item: null, itemKey: 'earthquake' }
  const stage = (s: LockStage, resolution: LockResolution | null): LockStageCandidate => ({
    stage: s,
    candidate: resolution === null ? { kind: 'computing' } : { kind: 'ready', lock: { kind: 'attack', target: atkTarget, stage: s, stats: ['atk'] }, resolution },
  })
  /** A 상승으로만 닿는 후보(+S 고정과 겹침) */
  const conflictPin = (): CardLockPin => ({ control: { kind: 'lockable', stages: [stage('guaranteed-ohko', single('atk', null, 30)), stage('high-roll-ohko', single('atk', null, 20))] } })
  const reachablePin = (): CardLockPin => ({ control: { kind: 'lockable', stages: [stage('guaranteed-ohko', single('atk', 28, 20)), stage('high-roll-ohko', single('atk', 20, 14))] } })

  const uiWith = (locks: readonly CutLock[], opts: { generation?: number } = {}) => {
    const resolutions = new Map<number, LockResolution>(locks.map((l) => [l.seq, single('spe', null, 12)]))
    const mySet = toPokemonSet(game, EXAMPLE_DRAFT).set
    const snapshot: LockSnapshot | null =
      locks.length === 0 ? null : { generation: 1, pending: false, derivation: deriveLocks({ game, mySet, locks, resolutions, baseChoice: null }), resolutions, planSet: null }
    return lockUiValue({
      game,
      state: { draft: EXAMPLE_DRAFT, locks, lockBase: null, lockReveal: null, lockTrim: null },
      snapshot,
      runGeneration: opts.generation ?? 1,
      dispatch: () => {},
      onAdjustCard: () => {},
      onPinMenu: () => {},
    })
  }

  it('고정이 있고 모든 단계 후보가 준비됐는데 고를 칸이 없으면 이유(성격 충돌), 메모를 거친 판정과 거치지 않은 판정이 같다', () => {
    const ui = uiWith([speedLock])
    const pin = conflictPin()
    const direct = pinDisabledReason(ui.pinMenu('attack', pin))
    expect(direct).toEqual({ kind: 'nature-conflict' })
    expect(ui.pinDisabled('attack', pin, true)).toEqual(direct)
    expect(ui.pinDisabled('attack', pin, true)).toEqual(direct)
    // 같은 입력의 다른 조립 결과 객체도 같은 판정
    expect(ui.pinDisabled('attack', conflictPin(), true)).toEqual(direct)
  })

  it('고를 수 있는 칸이 하나라도 있으면 활성', () => {
    const ui = uiWith([speedLock])
    expect(ui.pinDisabled('attack', reachablePin(), true)).toBeUndefined()
    expect(pinDisabledReason(ui.pinMenu('attack', reachablePin()))).toBeUndefined()
  })

  it('후보가 하나라도 계산 중이거나, 고정 해석이 대기 중(다른 세대)이거나, 찬 핀·고정 불가 핀·스피드 탭이면 활성', () => {
    const ui = uiWith([speedLock])
    const computing: CardLockPin = { control: { kind: 'lockable', stages: [stage('guaranteed-ohko', single('atk', null, 30)), stage('high-roll-ohko', null)] } }
    expect(ui.pinDisabled('attack', computing, true)).toBeUndefined()
    expect(uiWith([speedLock], { generation: 2 }).pinDisabled('attack', conflictPin(), true)).toBeUndefined()
    expect(ui.pinDisabled('attack', { ...conflictPin(), lockedBy: [1] }, true)).toBeUndefined()
    expect(ui.pinDisabled('attack', { control: { kind: 'blocked', reason: 'fixed-value' } }, true)).toBeUndefined()
    expect(ui.pinDisabled('speed', conflictPin(), true)).toBeUndefined()
  })

  it('밀려난(이전 세대) 탭 뷰의 핀은 같은 후보라도 판정하지 않는다(활성), 지금 세대 뷰면 판정한다', () => {
    const ui = uiWith([speedLock])
    const pin = conflictPin()
    expect(ui.pinDisabled('attack', pin, false)).toBeUndefined()
    expect(ui.pinDisabled('attack', pin, true)).toEqual({ kind: 'nature-conflict' })
    // 메모가 있어도 밀려난 뷰는 활성
    expect(ui.pinDisabled('attack', pin, false)).toBeUndefined()
  })

  it('같은 조립 결과 객체라도 후보가 계산 중 → 준비로 바뀌면(새 객체) 다시 판정한다', () => {
    const ui = uiWith([speedLock])
    const before: CardLockPin = { control: { kind: 'lockable', stages: [stage('guaranteed-ohko', single('atk', null, 30)), stage('high-roll-ohko', null)] } }
    expect(ui.pinDisabled('attack', before, true)).toBeUndefined()
    expect(ui.pinDisabled('attack', conflictPin(), true)).toEqual({ kind: 'nature-conflict' })
  })

  it('고정이 없으면 판정을 건너뛰고(활성), 판정하는 경로도 같은 결과다', () => {
    const ui = uiWith([])
    for (const pin of [reachablePin(), conflictPin()]) {
      expect(ui.pinDisabled('attack', pin, true)).toBeUndefined()
      expect(pinDisabledReason(ui.pinMenu('attack', pin))).toBeUndefined()
    }
  })
})
