import { describe, expect, it } from 'vitest'
import type { CutLock, PinMenuView } from '../cards'
import { realData } from '../cards/testing'
import { EXAMPLE_DRAFT } from './example'
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
