import { describe, expect, it } from 'vitest'
import type { AdjustNature, AdjustOption, AdjustView, LockDerivation } from '../cards'
import { realData } from '../cards/testing'
import type { StatId } from '../data/schema'
import { natureIdFor } from '../ui/natureToggle'
import type { SetDraft } from '../ui/setDraft'
import { adjustAction } from './adjustAction'
import { EXAMPLE_DRAFT } from './example'

const { game } = realData()
const NEUTRAL = natureIdFor(game)
const RULES = game.manifest.rules

const draftOf = (nature: string, natureMinusAuto = false): SetDraft => ({ ...EXAMPLE_DRAFT, nature, natureMinusAuto })

const choice = (id: AdjustNature['id'], plus: AdjustNature['plus'], nature: string, extra: Partial<AdjustNature> = {}): AdjustNature => ({
  id,
  plus,
  nature,
  branchId: null,
  lockedSp: {},
  ...extra,
})

const ok = (stats: Partial<Record<StatId, number>>, locked: readonly StatId[] = [], plus?: StatId): AdjustOption => ({
  kind: 'ok',
  stats: (Object.keys(stats) as StatId[]).map((stat) => ({ stat, sp: stats[stat] as number, plus: stat === plus, locked: locked.includes(stat) })),
})

const viewOf = (natures: AdjustNature[], options: AdjustOption[], keep: StatId[], relevant: StatId[]): AdjustView => ({
  state: 'ready',
  natures,
  results: [{ label: 'guaranteed-ohko', current: false, options, lead: 0 }],
  keep,
  relevant,
})

const derivationOf = (baseId: string): LockDerivation => ({ locks: [], statuses: new Map(), branches: [], baseId, lockedStats: ['spe'], overTotal: 0 })

/** 공격 v = A: 무보정(hardy) / A 상승(adamant) */
const attackView = (relevant: StatId[] = ['atk']): AdjustView =>
  viewOf([choice('neutral', null, NEUTRAL), choice('plus', 'atk', 'adamant')], [ok({ atk: 28 }), ok({ atk: 20 }, [], 'atk')], ['atk'], relevant)

describe('adjustAction 고정 없음', () => {
  it('무보정: 초안 상승이 조정 능력치면 무보정 성격으로 바꾸고 조정 SP를 쓴다', () => {
    const action = adjustAction({ game, draft: draftOf('adamant'), derivation: null, view: attackView(), result: 0, option: 0 })
    expect(action).toEqual({ type: 'apply-adjust', sp: { atk: 28 }, nature: { nature: NEUTRAL, natureMinusAuto: false }, lockedSp: {}, keep: ['atk'], rules: RULES })
  })

  it('무보정: 초안 상승이 조정 밖이고 관여 능력치 보정이 같으면 성격을 그대로 둔다', () => {
    const view = viewOf([choice('neutral', null, NEUTRAL), choice('plus', 'spa', 'modest')], [ok({ spa: 30 }), ok({ spa: 22 }, [], 'spa')], ['spa'], ['spa'])
    const action = adjustAction({ game, draft: draftOf('timid'), derivation: null, view, result: 0, option: 0 })
    expect(action).not.toBeNull()
    expect(action).not.toHaveProperty('nature')
  })

  it('상승: 초안 상승이 v가 아니면 + 토글과 같은 자동 하락 성격을 쓴다', () => {
    const action = adjustAction({ game, draft: draftOf(NEUTRAL), derivation: null, view: attackView(), result: 0, option: 1 })
    expect(action).toMatchObject({ sp: { atk: 20 }, nature: { nature: 'adamant', natureMinusAuto: true } })
  })

  it('상승: 초안 상승이 이미 v면 성격을 생략한다', () => {
    const action = adjustAction({ game, draft: draftOf('adamant', true), derivation: null, view: attackView(), result: 0, option: 1 })
    expect(action).not.toHaveProperty('nature')
  })

  it('관여 능력치 보정이 판정 성격과 다르면 판정 성격(자동 하락 아님)으로 대신한다', () => {
    // 무보정 선택지인데 초안(timid)의 하락이 관여 능력치 A에 있다
    const neutral = adjustAction({ game, draft: draftOf('timid'), derivation: null, view: attackView(), result: 0, option: 0 })
    expect(neutral).toMatchObject({ nature: { nature: NEUTRAL, natureMinusAuto: false } })
    // D 상승의 자동 하락(물리 기술 → C)이 관여 능력치 C에 떨어진다
    const view = viewOf(
      [choice('neutral', null, NEUTRAL), choice('plus', 'spd', 'calm')],
      [ok({ hp: 10, spd: 12 }), ok({ hp: 6, spd: 8 }, [], 'spd')],
      ['hp', 'spd'],
      ['hp', 'spa', 'spd'],
    )
    const plus = adjustAction({ game, draft: draftOf(NEUTRAL), derivation: null, view, result: 0, option: 1 })
    expect(plus).toMatchObject({ sp: { hp: 6, spd: 8 }, nature: { nature: 'calm', natureMinusAuto: false } })
  })

  it('ok가 아니거나 없는 index면 null', () => {
    const off = viewOf([choice('neutral', null, NEUTRAL), choice('plus', 'atk', 'adamant')], [ok({ atk: 28 }), { kind: 'off', reason: 'budget' }], ['atk'], ['atk'])
    expect(adjustAction({ game, draft: draftOf(NEUTRAL), derivation: null, view: off, result: 0, option: 1 })).toBeNull()
    expect(adjustAction({ game, draft: draftOf(NEUTRAL), derivation: null, view: off, result: 1, option: 0 })).toBeNull()
    expect(adjustAction({ game, draft: draftOf(NEUTRAL), derivation: null, view: off, result: 0, option: 2 })).toBeNull()
  })

  it('방어 쌍 배분: H 최대를 고르면 그 H·B를 쓰고, H 최대가 없는 선택지에서 H 최대를 고르면 null', () => {
    const statsOf = (o: AdjustOption) => (o.kind === 'ok' ? o.stats : [])
    const options: AdjustOption[] = [{ kind: 'ok', stats: statsOf(ok({ hp: 4, def: 12 })), hMax: statsOf(ok({ hp: 20, def: 6 })) }, ok({ hp: 2, def: 8 }, [], 'def')]
    const view = viewOf([choice('neutral', null, NEUTRAL), choice('plus', 'def', 'bold')], options, ['hp', 'def'], ['hp', 'def'])
    const draft = draftOf(NEUTRAL)
    expect(adjustAction({ game, draft, derivation: null, view, result: 0, option: 0 })).toMatchObject({ sp: { hp: 4, def: 12 } })
    expect(adjustAction({ game, draft, derivation: null, view, result: 0, option: 0, allocation: 'min-sum' })).toMatchObject({ sp: { hp: 4, def: 12 } })
    expect(adjustAction({ game, draft, derivation: null, view, result: 0, option: 0, allocation: 'h-max' })).toMatchObject({ sp: { hp: 20, def: 6 }, keep: ['hp', 'def'] })
    expect(adjustAction({ game, draft, derivation: null, view, result: 0, option: 1, allocation: 'h-max' })).toBeNull()
  })
})

describe('adjustAction 고정 중', () => {
  const lockedSp = { spe: 29 }
  const view = viewOf(
    [
      choice('neutral', null, 'jolly', { branchId: 'plus:spe', lockedSp: { spe: 16 } }),
      choice('plus', 'atk', 'adamant', { branchId: 'out', lockedSp }),
    ],
    [ok({ atk: 28, spe: 16 }, ['spe']), ok({ atk: 20, spe: 29 }, ['spe'], 'atk')],
    ['atk'],
    ['atk'],
  )

  it('기준과 다른 갈래를 고르면 lockBase로 바꾸고 고정 능력치 값은 sp에 넣지 않는다', () => {
    const action = adjustAction({ game, draft: draftOf('jolly', true), derivation: derivationOf('plus:spe'), view, result: 0, option: 1 })
    expect(action).toEqual({
      type: 'apply-adjust',
      sp: { atk: 20 },
      nature: { nature: 'adamant', natureMinusAuto: true },
      lockBase: 'out',
      lockedSp,
      keep: ['atk'],
      rules: RULES,
    })
  })

  it('기준 갈래 그대로면 lockBase가 없고 관여 능력치 성격 확인을 하지 않는다', () => {
    const action = adjustAction({ game, draft: draftOf('jolly', true), derivation: derivationOf('plus:spe'), view, result: 0, option: 0 })
    expect(action).toEqual({ type: 'apply-adjust', sp: { atk: 28 }, lockedSp: { spe: 16 }, keep: ['atk'], rules: RULES })
  })

  it('방어 3방향: 반대쪽 상승은 성격을 두고 갈래만, 무보정은 반대쪽 상승도 무보정으로 바꾼다', () => {
    const three = viewOf(
      [
        choice('neutral', null, NEUTRAL, { branchId: 'out', lockedSp: { hp: 12, spd: 20 } }),
        choice('plus', 'def', 'impish', { branchId: 'out', lockedSp: { hp: 12, spd: 20 } }),
        choice('other-plus', 'spd', NEUTRAL, { branchId: 'plus:spd', lockedSp: { hp: 12, spd: 14 } }),
      ],
      [ok({ hp: 12, def: 18, spd: 20 }, ['hp', 'spd']), ok({ hp: 12, def: 10, spd: 20 }, ['hp', 'spd'], 'def'), ok({ hp: 12, def: 18, spd: 14 }, ['hp', 'spd'])],
      ['def'],
      ['hp', 'def'],
    )
    const derivation = derivationOf('out')
    const other = adjustAction({ game, draft: draftOf('careful', true), derivation, view: three, result: 0, option: 2 })
    expect(other).toEqual({ type: 'apply-adjust', sp: { def: 18 }, lockBase: 'plus:spd', lockedSp: { hp: 12, spd: 14 }, keep: ['def'], rules: RULES })
    const neutral = adjustAction({ game, draft: draftOf('careful', true), derivation, view: three, result: 0, option: 0 })
    expect(neutral).toEqual({
      type: 'apply-adjust',
      sp: { def: 18 },
      nature: { nature: NEUTRAL, natureMinusAuto: false },
      lockedSp: { hp: 12, spd: 20 },
      keep: ['def'],
      rules: RULES,
    })
  })
})
