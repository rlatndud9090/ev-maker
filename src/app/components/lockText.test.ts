import { describe, expect, it } from 'vitest'
import { deriveLocks, itemKey, type AdjustNature, type AdjustResult, type CutLock, type LockCandidate, type LockResolution, type SpeedBranchLine, type SpeedLockCandidate } from '../../cards'
import type { LockCheckView } from '../lockContext'
import { realData } from '../../cards/testing'
import type { PokemonSet } from '../../core'
import {
  adjustLabel,
  adjustNatureName,
  adjustNaturesLabel,
  adjustOffText,
  adjustResultsLabel,
  adjustStatsSpoken,
  adjustStatsText,
  blockedText,
  branchConditionText,
  candidateOptionsText,
  pinLabel,
  pinStageView,
  branchLineSpoken,
  branchLineText,
  budgetText,
  lockCheckText,
  lockDescription,
  lockDescriptionSpoken,
  lockAllocationText,
  lockChoiceText,
  lockOptionText,
  pinEmptyMenuText,
  pinEmptyReasonText,
  pinEmptyText,
  pinResultsLabel,
  speedPinDisabledText,
  lockStatusText,
  lockedStatText,
  lockSubjectView,
  leadStats,
  trimText,
  trimsText,
} from './lockText'

const { game } = realData()
const single = (stat: 'spe' | 'atk', neutral: number | null, plus: number | null): LockResolution => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } })
const speedLock: CutLock = {
  seq: 1,
  kind: 'speed',
  target: { kind: 'speed', origin: 'ladder', opponentId: 'garchomp', bundle: { sp: 32, nature: 'plus' }, condition: 'scarf', filterKind: 'scarf' },
  stage: 'first',
  stats: ['spe'],
}
const defenseLock: CutLock = {
  seq: 2,
  kind: 'defense',
  target: { kind: 'defense', source: 'ladder', opponentId: 'garchomp', category: 'physical', bundle: { ladder: '[]' }, item: null, itemKey: itemKey('earthquake', JSON.stringify(['base'])) },
  stage: 'guaranteed-survive',
  stats: ['hp', 'def'],
}

const fits = { kind: 'fits' } as const
const line = (patch: Partial<SpeedBranchLine>): SpeedBranchLine => ({
  branchId: 'plus:spe',
  branchPlus: 'spe',
  isBase: false,
  condition: [{ stat: 'spe', sp: 12, plus: true }],
  status: 'ok',
  label: 'guaranteed-survive',
  neutral: { label: 'guaranteed-survive', stats: [{ stat: 'hp', sp: 4 }, { stat: 'def', sp: 12 }], budget: fits },
  plus: 'omitted',
  omittedPlusStat: 'spe',
  ...patch,
})

describe('lockOptionText', () => {
  const flat = (v: number | null, from = 0): (number | null)[] => Array.from({ length: 33 }, (_, h) => (h < from ? null : v))
  it('상승안 먼저 "S12+ / S20"("고정" 글자 없음), 한쪽만이면 그쪽만, 쌍은 H 0부터 최소 합 점, 해석·선택지가 없으면 undefined', () => {
    expect(lockOptionText(single('spe', 20, 12))).toBe('S12+ / S20')
    expect(lockOptionText(single('spe', null, 12))).toBe('S12+')
    expect(lockOptionText(single('spe', 20, null))).toBe('S20')
    expect(lockOptionText({ kind: 'ok', options: { shape: 'pair', defense: 'def', neutral: flat(16, 4), plus: flat(8, 2) } })).toBe('H2 B8+ / H4 B16')
    expect(lockOptionText({ kind: 'missing' })).toBeUndefined()
    expect(lockOptionText(undefined)).toBeUndefined()
  })

  it('lockedStatText: 갈래마다의 고정 값(상승 갈래 먼저)', () => {
    const mySet: PokemonSet = {
      regulation: game.manifest.regulation.id,
      species: 'raichu',
      ability: 'static',
      nature: 'hardy',
      sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: ['thunderbolt'],
    }
    const d = deriveLocks({ game, mySet, locks: [speedLock], resolutions: new Map([[1, single('spe', 20, 12)]]), baseChoice: null })
    expect(lockedStatText(d, 'spe')).toBe('S12+ / S20')
  })
})

describe('갈래 줄 문구', () => {
  it('조건 접두: 하나는 "S12+일 때:", 여럿은 " · "로', () => {
    expect(branchConditionText(line({}))).toBe('S12+일 때:')
    expect(branchConditionText(line({ condition: [{ stat: 'atk', sp: 20, plus: false }, { stat: 'spe', sp: 12, plus: true }] }))).toBe('A20 · S12+일 때:')
  })

  it('상승이 고정에 간 갈래: 상승 자리는 "상승은 S에"', () => {
    expect(branchLineText(line({}), 'defense')).toBe('S12+일 때: 확정견딤 최소 H4 B12 / 상승은 S에')
  })

  it('고정 밖 갈래: 두 선택지(방어 쌍 상승은 B/D 뒤 "+"), 예산 표지', () => {
    const l = line({
      branchId: 'out',
      branchPlus: 'out',
      condition: [{ stat: 'spe', sp: 20, plus: false }],
      neutral: { label: 'guaranteed-survive', stats: [{ stat: 'hp', sp: 4 }, { stat: 'def', sp: 16 }], budget: { kind: 'need', n: 3 } },
      plus: { label: 'guaranteed-survive', stats: [{ stat: 'hp', sp: 2 }, { stat: 'def', sp: 8 }], budget: { kind: 'short', m: 5 } },
      omittedPlusStat: undefined,
    })
    expect(branchLineText(l, 'defense')).toBe('S20일 때: 확정견딤 최소 H4 B16 (다른 능력치에서 3 필요) / H2 B8+ SP 부족(5)')
  })

  it('불가 선택지·하락 자리 없음·계산 중·고정으로 충족', () => {
    expect(branchLineText(line({ neutral: null, plus: null, omittedPlusStat: undefined }), 'attack')).toBe('S12+일 때: 확정견딤 무보정 불가 / 상승 불가')
    expect(branchLineText(line({ status: 'no-drop-slot' }), 'attack')).toBe('S12+일 때: 이 갈래는 하락 자리 없음')
    expect(branchLineText(line({ status: 'pending' }), 'attack')).toBe('S12+일 때: 계산 중…')
    const byLock = line({ neutral: { label: 'guaranteed-ohko', stats: [{ stat: 'atk', sp: 20 }], budget: fits, byLock: true }, label: 'guaranteed-ohko' })
    expect(branchLineText(byLock, 'attack')).toBe('S12+일 때: 확정1타 최소 A20 (고정으로 충족) / 상승은 S에')
  })

  it('스피드 배지 줄(SpeedBranchLine): 상승은 "+"(↑ 아님), 라벨 없으면 선공', () => {
    const s: SpeedBranchLine = {
      branchId: 'plus:atk',
      branchPlus: 'atk',
      isBase: true,
      condition: [{ stat: 'atk', sp: 20, plus: true }],
      status: 'ok',
      neutral: { label: 'first', stats: [{ stat: 'spe', sp: 20 }], budget: fits },
      plus: 'omitted',
      omittedPlusStat: 'atk',
    }
    expect(branchLineText(s, 'speed')).toBe('A20+일 때: 선공 최소 S20 / 상승은 A에')
    expect(branchLineText({ ...s, plus: { label: 'first', stats: [{ stat: 'spe', sp: 12 }], budget: fits }, omittedPlusStat: undefined }, 'speed')).toBe(
      'A20+일 때: 선공 최소 S20 / S12+',
    )
    expect(branchLineSpoken(s, 'speed')).toBe('A 20 상승일 때, 선공, 무보정 최소 S 20, 상승은 A에, 표 기준')
  })

  it('S가 고정된 상승 갈래: 무보정 자리는 생략', () => {
    const s: SpeedBranchLine = {
      branchId: 'plus:spe',
      branchPlus: 'spe',
      isBase: false,
      condition: [{ stat: 'spe', sp: 12, plus: true }],
      status: 'ok',
      neutral: 'omitted',
      plus: { label: 'first', stats: [{ stat: 'spe', sp: 14 }], budget: fits },
    }
    expect(branchLineText(s, 'speed')).toBe('S12+일 때: 선공 S14+')
  })

  it('budgetText', () => {
    expect(budgetText(fits)).toBeUndefined()
    expect(budgetText({ kind: 'need', n: 4 })).toBe('(다른 능력치에서 4 필요)')
    expect(budgetText({ kind: 'short', m: 2 })).toBe('SP 부족(2)')
  })
})

describe('상태 문구', () => {
  it('lockStatusText', () => {
    expect(lockStatusText({ kind: 'active' })).toBeUndefined()
    expect(lockStatusText({ kind: 'unreachable' })).toEqual({ text: '도달 불가' })
    expect(lockStatusText({ kind: 'unreachable', reason: 'non-monotonic' })?.text).toBe('계산 불가')
    expect(lockStatusText({ kind: 'unreachable', reason: '엔진 오류' })).toEqual({ text: '계산 불가', detail: '엔진 오류' })
    expect(lockStatusText({ kind: 'sp-short', over: 6 })).toEqual({ text: 'SP 부족(6)' })
    expect(lockStatusText({ kind: 'nature-conflict' })).toEqual({ text: '성격 충돌', detail: '상승이 필요한 고정이 겹침' })
    expect(lockStatusText({ kind: 'missing' })).toEqual({ text: '대상 없음' })
    expect(lockStatusText({ kind: 'set-error' })?.text).toBe('계산 불가')
  })

  it('lockCheckText: 계산 중은 비활성 사유가 아니라 계산 중', () => {
    expect(lockCheckText({ kind: 'ok' })).toBeUndefined()
    expect(lockCheckText({ kind: 'computing' })).toEqual({ text: '계산 중' })
    expect(lockCheckText({ kind: 'sp-short', over: 3 })).toEqual({ text: 'SP 부족(3)' })
    expect(lockCheckText({ kind: 'nature-conflict' })?.detail).toBe('상승이 필요한 고정이 겹침')
  })

  it('blockedText·trimText', () => {
    expect(blockedText('depends-other-stat')).toBe('다른 능력치에도 의존해 고정 불가')
    expect(blockedText('unreachable-stage')).toBe('고정할 단계에 닿지 않아 고정 불가')
    expect(trimText({ stat: 'spe', from: 32, to: 20 }, 66)).toBe('S 32 → 20(합계 66 초과로 줄임)')
    expect(trimsText([{ stat: 'spe', from: 32, to: 20 }, { stat: 'atk', from: 10, to: 0 }], 66)).toBe('S 32 → 20(합계 66 초과로 줄임), A 10 → 0(합계 66 초과로 줄임)')
  })
})

describe('lockDescription', () => {
  it('스피드: 상대·배분·조건(단계는 선공뿐이라 없음), 읽기 이름은 성격 보정을 말로', () => {
    const name = game.data.species.garchomp.name.ko
    expect(lockDescription(game, speedLock)).toBe(`${name} S32↑ 스카프`)
    expect(lockDescriptionSpoken(game, speedLock)).toBe(`컷 고정: ${name} S32 성격 상승 스카프`)
  })

  it('방어: 상대·기술·단계', () => {
    const name = game.data.species.garchomp.name.ko
    const move = game.data.moves.earthquake.name.ko
    expect(lockDescription(game, defenseLock)).toBe(`${name} · ${move} · 확정견딤`)
  })
})

describe('lockSubjectView(고정 목록 항목의 보이는 부분)', () => {
  it('스피드: 상대 이미지·배분 "S32↑"·스카프는 도구 이미지(조건 글자 없음), 단계 배지 없음', () => {
    const v = lockSubjectView(game, speedLock)
    expect(v).toEqual({ speciesId: 'garchomp', speciesName: game.data.species.garchomp.name.ko, bundle: 'S32↑', item: { id: 'choicescarf', name: game.data.items.choicescarf.name.ko } })
  })

  it('스피드: 순풍·랭크 조건은 글자, 프리셋은 "프리셋 N"', () => {
    const tail = lockSubjectView(game, { ...speedLock, target: { ...speedLock.target, condition: 'tailwind' } as CutLock['target'] })
    expect(tail.note).toBe('순풍')
    expect(tail.item).toBeUndefined()
    const preset = lockSubjectView(game, { ...speedLock, target: { kind: 'speed', origin: 'preset', opponentId: 'garchomp', bundle: { preset: 1 }, condition: 'rank:1', filterKind: 'rank' } })
    expect(preset.bundle).toBe('프리셋 2')
    expect(preset.note).toBe('+1')
  })

  it('방어: 배분은 래더 키의 관련 SP, 기술 글자, 단계는 카드 결과 배지(확정견딤 초록), 도구 변형이면 그 도구', () => {
    const ladder = JSON.stringify([{ stat: 'atk', sp: 32, nature: 'plus' }])
    const v = lockSubjectView(game, { ...defenseLock, target: { ...defenseLock.target, bundle: { ladder }, item: 'lifeorb' } as CutLock['target'] })
    expect(v.bundle).toBe('A32↑')
    expect(v.note).toBe(game.data.moves.earthquake.name.ko)
    expect(v.badge).toEqual({ label: '확정견딤', tone: 'green' })
    expect(v.item?.id).toBe('lifeorb')
    expect(lockSubjectView(game, defenseLock).bundle).toBeUndefined()
    expect(lockSubjectView(game, { ...defenseLock, stage: 'guaranteed-ohko' }).badge).toEqual({ label: '확정1타', tone: 'red' })
  })
})

describe('카드 줄 핀 문구', () => {
  const flat = (v: number | null, from = 0): (number | null)[] => Array.from({ length: 33 }, (_, h) => (h < from ? null : v))
  it('candidateOptionsText: 단일은 "최소 무보정 / 상승+", 쌍은 H 0부터 최소 합 점, 닿는 선택지가 없으면 undefined', () => {
    expect(candidateOptionsText(single('atk', 20, 12))).toBe('최소 A20 / A12+')
    expect(candidateOptionsText(single('atk', null, 12))).toBe('A12+')
    expect(candidateOptionsText(single('atk', 20, null))).toBe('최소 A20')
    expect(candidateOptionsText({ kind: 'ok', options: { shape: 'pair', defense: 'def', neutral: flat(16, 4), plus: flat(8, 2) } })).toBe('최소 H4 B16 / H2 B8+')
    expect(candidateOptionsText({ kind: 'unreachable' })).toBeUndefined()
  })

  it('pinLabel: 빈 핀 "컷 고정: 대상", 찬 핀 "컷 고정 해제: 대상"', () => {
    expect(pinLabel('한카리아스', false)).toBe('컷 고정: 한카리아스')
    expect(pinLabel('한카리아스', true)).toBe('컷 고정 해제: 한카리아스')
  })

  it('pinStageView: 걸 수 있으면 선택지 SP와 고정, 아니면 이유만(계산 중·SP 부족·성격 충돌·도달 불가·스피드 차단)', () => {
    const ready: Extract<LockCandidate, { kind: 'ready' }> = {
      kind: 'ready',
      lock: { kind: 'speed', target: speedLock.target, stage: 'first', stats: ['spe'] },
      resolution: single('spe', 20, 12),
    }
    const ok = pinStageView('first', ready, () => ({ kind: 'ok' }))
    expect(ok).toMatchObject({ stage: 'first', detail: '최소 S20 / S12+', lock: ready.lock })
    expect(pinStageView('guaranteed-ohko', { kind: 'computing' }, () => ({ kind: 'computing' }))).toEqual({ stage: 'guaranteed-ohko', label: '확정1타', detail: '계산 중' })
    expect(pinStageView('first', ready, () => ({ kind: 'sp-short', over: 3 })).detail).toBe('SP 부족(3)')
    expect(pinStageView('first', ready, () => ({ kind: 'nature-conflict' })).detail).toBe('성격 충돌')
    expect(pinStageView('first', ready, () => ({ kind: 'unreachable' })).lock).toBeUndefined()
    expect(pinStageView('first', { kind: 'blocked', reason: 'speed-unsupported' }, () => ({ kind: 'ok' }))).toMatchObject({ detail: blockedText('speed-unsupported') })
  })
})

describe('변동 팝오버 문구', () => {
  const n = (id: AdjustNature['id'], plus: AdjustNature['plus']): AdjustNature => ({ id, plus, nature: 'hardy', branchId: null, lockedSp: {} })

  it('버튼·메뉴 이름', () => {
    expect(adjustLabel('한카리아스')).toBe('변동: 한카리아스')
    expect(adjustResultsLabel('한카리아스')).toBe('변동할 결과: 한카리아스')
    expect(adjustNaturesLabel('확정견딤', [{ stat: 'hp', sp: 20, plus: false, locked: false }, { stat: 'def', sp: 10, plus: false, locked: false }])).toBe('성격 선택: 확정견딤 H 20, B 10')
  })

  it('성격 선택지 이름: 두 방향은 "C 상승", 방어 3방향(반대쪽 상승 선택지가 있음)은 "B 보정"/"D 보정"', () => {
    const two = [n('neutral', null), n('plus', 'spa')]
    expect(two.map((x) => adjustNatureName(two, x))).toEqual(['무보정', 'C 상승'])
    const three = [n('neutral', null), n('plus', 'def'), n('other-plus', 'spd')]
    expect(three.map((x) => adjustNatureName(three, x))).toEqual(['무보정', 'B 보정', 'D 보정'])
  })

  it('SP 표기: 상승은 "+", 고정은 읽기에서 "고정"', () => {
    const stats = [
      { stat: 'spa', sp: 20, plus: true, locked: false },
      { stat: 'spe', sp: 29, plus: false, locked: true },
    ] as const
    expect(adjustStatsText(stats)).toBe('C20+ S29')
    expect(adjustStatsSpoken(stats)).toBe('C 20 상승, S 29 고정')
  })

  it('고를 수 없는 이유', () => {
    expect(adjustOffText({ kind: 'off', reason: 'budget' })).toBe('SP 부족')
    expect(adjustOffText({ kind: 'off', reason: 'unreachable' })).toBe('닿지 않음')
    expect(adjustOffText({ kind: 'off', reason: 'no-branch' })).toBe('고정과 겹침')
    expect(adjustOffText({ kind: 'off', reason: 'budget', over: 8 })).toBe('SP 부족(8)')
  })

  it('leadStats: lead 선택지의 능력치, 고를 수 없는 lead면 빈 목록', () => {
    const stats = [{ stat: 'atk', sp: 28, plus: false, locked: false }] as const
    const r: AdjustResult = { label: 'guaranteed-ohko', current: false, lead: 1, options: [{ kind: 'off', reason: 'budget' }, { kind: 'ok', stats }] }
    expect(leadStats(r)).toEqual(stats)
    expect(leadStats({ ...r, lead: 0 })).toEqual([])
    const hMax = [
      { stat: 'hp', sp: 32, plus: false, locked: false },
      { stat: 'def', sp: 12, plus: false, locked: false },
    ] as const
    const pair: AdjustResult = { label: 'guaranteed-survive', current: false, lead: 0, options: [{ kind: 'ok', stats: [{ stat: 'def', sp: 30, plus: false, locked: false }], hMax }] }
    expect(leadStats(pair)).toEqual(hMax)
  })
})

describe('공·방 핀 메뉴·고정 목록 SP 문구(2026-11-21)', () => {
  const stairs = (f: (hp: number) => number): number[] => Array.from({ length: 33 }, (_, hp) => f(hp))
  const set: PokemonSet = { regulation: game.manifest.regulation.id, species: 'raichu', ability: 'static', nature: 'hardy', sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, moves: [] }

  it('핀 메뉴 이름·빈 목록', () => {
    expect(pinResultsLabel('한카리아스')).toBe('컷 고정할 결과: 한카리아스')
    expect(pinEmptyText(undefined)).toBe('고정할 수 있는 결과 없음')
    expect(pinEmptyText(8)).toBe('고정할 수 있는 결과 없음 · SP 부족(8)')
  })

  it('lockChoiceText: 파생 갈래 값(상승 갈래 먼저, 같은 글자 한 번), H 최대 배분이 그대로 보인다', () => {
    const res = new Map<number, LockResolution>([[1, single('spe', 20, 12)]])
    const d = deriveLocks({ game, mySet: set, locks: [speedLock], resolutions: res, baseChoice: null })
    expect(lockChoiceText(d, speedLock)).toBe('S12+ / S20')
    const pair: LockResolution = { kind: 'ok', options: { shape: 'pair', defense: 'def', neutral: stairs((hp) => Math.max(0, 16 - hp)), plus: stairs((hp) => Math.max(0, 10 - hp)) } }
    const hMax = { ...defenseLock, allocation: 'h-max' as const }
    const dd = deriveLocks({ game, mySet: set, locks: [hMax], resolutions: new Map([[2, pair]]), baseChoice: null })
    expect(lockChoiceText(dd, hMax)).toBe('H32 B0+ / H32 B0')
    const plain = deriveLocks({ game, mySet: set, locks: [defenseLock], resolutions: new Map([[2, pair]]), baseChoice: null })
    expect(lockChoiceText(plain, defenseLock)).toBe('H10 B0+ / H16 B0')
  })

  it('H 최대 표지(목록·읽기 이름)', () => {
    expect(lockAllocationText(defenseLock)).toBeUndefined()
    expect(lockAllocationText({ allocation: 'h-max' })).toBe('H 최대')
    expect(lockDescriptionSpoken(game, { ...defenseLock, allocation: 'h-max' })).toMatch(/ · H 최대$/)
  })
})

describe('핀 비활성 이유 문구(speed-bundles-pin-disable R6·R7)', () => {
  it('공·방 핀: SP 부족(n) · 성격 충돌 · 고정할 수 있는 결과 없음, 빈 메뉴 문구도 같은 이유를 쓴다', () => {
    expect(pinEmptyReasonText({ kind: 'sp-short', over: 8 })).toBe('SP 부족(8)')
    expect(pinEmptyReasonText({ kind: 'nature-conflict' })).toBe('성격 충돌')
    expect(pinEmptyReasonText({ kind: 'none' })).toBe('고정할 수 있는 결과 없음')
    expect(pinEmptyMenuText({ kind: 'sp-short', over: 8 })).toBe(pinEmptyText(8))
    expect(pinEmptyMenuText({ kind: 'nature-conflict' })).toBe('고정할 수 있는 결과 없음 · 성격 충돌')
    expect(pinEmptyMenuText({ kind: 'none' })).toBe('고정할 수 있는 결과 없음')
  })

  it('스피드 핀: 메뉴 한 줄 문구와 같은 이유, 바로 고정 가능·계산 중이면 이유 없음(활성)', () => {
    const ready: SpeedLockCandidate = {
      kind: 'ready',
      lock: { kind: 'speed', target: { kind: 'speed', origin: 'ladder', opponentId: 's', bundle: { sp: 32, nature: 'plus' }, condition: 'none', filterKind: null }, stage: 'first', stats: ['spe'] },
      resolution: { kind: 'ok', options: { shape: 'single', stat: 'spe', neutral: 20, plus: 12 } },
    }
    const checkOf = (c: LockCheckView) => () => c
    expect(speedPinDisabledText(ready, checkOf({ kind: 'ok' }))).toBeUndefined()
    expect(speedPinDisabledText(ready, checkOf({ kind: 'computing' }))).toBeUndefined()
    expect(speedPinDisabledText(ready, checkOf({ kind: 'unreachable' }))).toBe('도달 불가')
    expect(speedPinDisabledText(ready, checkOf({ kind: 'sp-short', over: 8 }))).toBe('SP 부족(8)')
    expect(speedPinDisabledText(ready, checkOf({ kind: 'nature-conflict' }))).toBe('성격 충돌')
    expect(speedPinDisabledText({ kind: 'blocked', reason: 'set-error' }, checkOf({ kind: 'ok' }))).toBe(pinStageView('first', { kind: 'blocked', reason: 'set-error' }, checkOf({ kind: 'ok' })).detail)
    expect(speedPinDisabledText({ kind: 'blocked', reason: 'speed-unsupported' }, checkOf({ kind: 'ok' }))).toBe(pinStageView('first', { kind: 'blocked', reason: 'speed-unsupported' }, checkOf({ kind: 'ok' })).detail)
    // 메뉴 한 줄 문구와 같다
    for (const c of [{ kind: 'unreachable' }, { kind: 'sp-short', over: 3 }, { kind: 'nature-conflict' }] as const) {
      expect(speedPinDisabledText(ready, checkOf(c))).toBe(pinStageView('first', ready, checkOf(c)).detail)
    }
  })
})
