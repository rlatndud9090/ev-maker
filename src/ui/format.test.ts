import { describe, expect, it } from 'vitest'
import {
  boundaryText,
  bundleText,
  categoryLabel,
  categorySymbol,
  currentText,
  fixedText,
  fromPercentInput,
  noChangeTitle,
  refsNote,
  shareText,
  spanText,
  spansOf,
  toPercentInput,
} from './format'

describe('boundaryText', () => {
  it('위쪽 경계는 "부터"와 +차이', () => {
    expect(boundaryText('atk', { sp: 28, to: 'guaranteed-ohko', delta: 8, need: 0 })).toBe('A28부터 확정 1타(+8)')
  })
  it('아래쪽 경계는 "까지 줄여도"와 −차이', () => {
    expect(boundaryText('hp', { sp: 12, to: 'guaranteed-survive', delta: -4, need: 0 })).toBe('H12까지 줄여도 확정 버팀(−4)')
  })
  it('n이 있으면 다른 능력치에서 n 필요', () => {
    expect(boundaryText('atk', { sp: 28, to: 'guaranteed-ohko', delta: 8, need: 8 })).toBe('A28부터 확정 1타(+8, 다른 능력치에서 8 필요)')
  })
  it('스피드 경계', () => {
    expect(boundaryText('spe', { sp: 20, to: 'first', delta: 4, need: 0 })).toBe('S20부터 선공(+4)')
  })
  it('현재 값이 경계면 ±0', () => {
    expect(boundaryText('def', { sp: 10, to: 'low-roll-ohko', delta: 0, need: 0 })).toBe('B10까지 줄여도 저난수 1타(±0)')
  })
})

describe('라벨', () => {
  it('구간·행동 순서 라벨과 기호', () => {
    expect(categoryLabel('mid-or-higher')).toBe('중난수 이상')
    expect(categoryLabel('second')).toBe('후공')
    expect(categoryLabel('unknown-x')).toBe('unknown-x')
    expect(categorySymbol('guaranteed-ohko')).toBe('◎')
    expect(categorySymbol('tie')).toBe('△')
    expect(categorySymbol('mid-or-higher')).toBe('×')
  })
  it('현재·고정 문구', () => {
    expect(currentText('atk', 32, 'high-roll-ohko')).toBe('현재 A32 고난수 1타')
    expect(currentText('spe', 4, undefined)).toBe('현재 S4')
    expect(fixedText('second')).toBe('항상 후공')
    expect(noChangeTitle(3, 1)).toBe('변화 없음 — 행 3개(카드 1장)')
  })
  it('묶음 SP와 점유율', () => {
    expect(bundleText([{ stat: 'hp', sp: 4, nature: 'neutral' }, { stat: 'def', sp: 12, nature: 'plus' }, { stat: 'spe', sp: 0, nature: 'minus' }])).toBe('H4 B12↑ S0↓')
    expect(shareText(0.1234)).toBe('12.3%')
  })
})

describe('spansOf', () => {
  it('연속한 같은 범주를 묶고 예산 밖 섞임을 표시한다', () => {
    const cells = [0, 1, 2, 3].map((sp) => ({ sp, category: sp < 2 ? 'a' : 'b', overBudget: sp === 3 }))
    expect(spansOf(cells)).toEqual([
      { from: 0, to: 1, category: 'a', overBudget: false },
      { from: 2, to: 3, category: 'b', overBudget: true },
    ])
    expect(spanText({ from: 5, to: 5, category: 'first', overBudget: false })).toBe('5 선공')
  })
})

describe('refsNote', () => {
  it('분류와 참조가 다를 때만', () => {
    expect(refsNote('Special', { offense: { owner: 'self', stat: 'spa' }, defense: 'def' }, 'me')).toBe('상대 B 참조')
    expect(refsNote('Physical', { offense: { owner: 'self', stat: 'def' }, defense: 'def' }, 'opponent')).toBe('상대 B로 공격')
    expect(refsNote('Special', { offense: { owner: 'self', stat: 'def' }, defense: 'def' }, 'me')).toBe('내 B로 공격, 상대 B 참조')
    expect(refsNote('Physical', { offense: { owner: 'target', stat: 'atk' }, defense: 'def' }, 'me')).toBe('상대 A로 공격')
    expect(refsNote('Physical', { offense: { owner: 'self', stat: 'atk' }, defense: 'def' }, 'me')).toBeUndefined()
    expect(refsNote('Status', { offense: null, defense: null }, 'me')).toBeUndefined()
  })
})

describe('% 입력 변환', () => {
  it('비율 ↔ %', () => {
    expect(toPercentInput(0.05)).toBe('5')
    expect(toPercentInput(0.125)).toBe('12.5')
    expect(fromPercentInput('10')).toBeCloseTo(0.1)
    expect(fromPercentInput('')).toBeNaN()
    expect(fromPercentInput('abc')).toBeNaN()
  })
})
