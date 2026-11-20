import { describe, expect, it } from 'vitest'
import type { SpeedBadge } from '../../cards'
import { realData } from '../../cards/testing'
import { LOCKED_MARK_TEXT, badgeLabel, lockedMinSp, minSpText, toggleDetail } from './speedText'

const { game } = realData()

describe('lockedMinSp(고정 중 최소 S)', () => {
  it('예산 초과·남은 SP를 지우고(음수 남은 SP 포함) 상승 변형이 없으면 불가', () => {
    const r = lockedMinSp({ neutral: { kind: 'over-budget', sp: 19, remaining: -32 }, plus: null })
    expect(r).toEqual({ neutral: { kind: 'ok', sp: 19 }, plus: { kind: 'impossible' } })
    expect(minSpText(r)).toBe('추월: 최소 S19 / 상승 불가')
    expect(minSpText(lockedMinSp({ neutral: { kind: 'ok', sp: 20 }, plus: { kind: 'over-budget', sp: 12, remaining: 7 } }))).toBe('추월: 최소 S20 / S12↑')
  })
})

// 무고정 스피드 문구는 "↑" 표기 그대로(컷 고정 갈래 줄만 "+")
describe('minSpText(무고정)', () => {
  it('가능·예산 초과·불가 표기가 그대로다', () => {
    expect(minSpText({ neutral: { kind: 'ok', sp: 20 }, plus: { kind: 'ok', sp: 12 } })).toBe('추월: 최소 S20 / S12↑')
    expect(minSpText({ neutral: { kind: 'impossible' }, plus: { kind: 'over-budget', sp: 30, remaining: 4 } })).toBe('추월: 무보정 불가 / S30↑(예산 초과 · 남은 SP 4)')
  })
})

describe('badgeLabel 고정 표지', () => {
  const badge = {
    id: 'x',
    origin: 'ladder',
    opponentId: 'garchomp',
    speciesId: 'garchomp',
    mega: false,
    bundle: { sp: 32, nature: 'plus', share: 0.5 },
    listed: true,
    condition: { kind: 'none' },
    filterKind: null,
    speed: 169,
    item: null,
    usageRank: 1,
  } as unknown as SpeedBadge
  it('고정 대상 배지만 접근 이름 끝에 "고정됨"이 붙고, 아니면 기존 이름 그대로', () => {
    const plain = badgeLabel(game, badge, 'outsped')
    expect(badgeLabel(game, badge, 'outsped', false)).toBe(plain)
    expect(plain).not.toContain(LOCKED_MARK_TEXT)
    expect(badgeLabel(game, badge, 'outsped', true)).toBe(`${plain}, ${LOCKED_MARK_TEXT}`)
  })
})

// 배지 상세 여닫기(클릭·Enter·Space): 닫힘 → 열림, 같은 배지 → 닫힘, 다른 배지 → 그 배지로 전환
describe('toggleDetail', () => {
  it('닫힌 상태에서 배지를 누르면 그 배지 상세가 열린다', () => {
    expect(toggleDetail(null, 'a')).toBe('a')
  })
  it('열린 배지를 다시 누르면 닫힌다', () => {
    expect(toggleDetail('a', 'a')).toBeNull()
  })
  it('다른 배지를 누르면 그 배지 상세로 바뀐다', () => {
    expect(toggleDetail('a', 'b')).toBe('b')
  })
  it('열기 → 닫기 → 다시 열기를 오간다', () => {
    let open: string | null = null
    const seen: (string | null)[] = []
    for (const id of ['a', 'a', 'a', 'b', 'b']) seen.push((open = toggleDetail(open, id)))
    expect(seen).toEqual(['a', null, 'a', 'b', null])
  })
})
