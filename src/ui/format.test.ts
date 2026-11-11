import { describe, expect, it } from 'vitest'
import {
  bundleText,
  categoryLabel,
  categorySymbol,
  currentText,
  fixedText,
  fromPercentInput,
  judgementText,
  koBadge,
  orderBadge,
  parseRollSteps,
  rankText,
  rollChanceText,
  rollStepsOf,
  refsNote,
  shareText,
  spanText,
  spansOf,
  targetText,
  toPercentInput,
} from './format'

describe('targetText', () => {
  it('단일 능력치: "<판정>: 최소 A30 필요"', () => {
    expect(targetText({ label: 'guaranteed-ohko', stats: [{ stat: 'atk', sp: 30 }], need: 0 })).toBe('확정1타: 최소 A30 필요')
  })
  it('방어 쌍: H와 B를 함께', () => {
    expect(targetText({ label: 'guaranteed-survive', stats: [{ stat: 'hp', sp: 4 }, { stat: 'def', sp: 12 }], need: 0 })).toBe('확정견딤: 최소 H4 B12 필요')
  })
  it('n이 있으면 다른 능력치에서 n 필요', () => {
    expect(targetText({ label: 'high-roll-ohko', stats: [{ stat: 'atk', sp: 20 }], need: 8 })).toBe('고난수1타: 최소 A20 필요 (다른 능력치에서 8 필요)')
  })
  it('스피드는 행동 순서 라벨', () => {
    expect(targetText({ label: 'first', stats: [{ stat: 'spe', sp: 20 }], need: 0 })).toBe('선공: 최소 S20 필요')
  })
  it('판정 라벨·랭크 부호', () => {
    expect(judgementText('mid-high-roll-ohko')).toBe('중고난수1타')
    expect(judgementText('tie')).toBe('동속')
    expect(rankText(2)).toBe('+2')
    expect(rankText(-1)).toBe('−1')
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
    expect(currentText('atk', 32, 'high-roll-ohko')).toBe('현재 A32 고난수1타')
    expect(currentText('def', 0, 'low-roll-ohko')).toBe('현재 B0 저난수1타')
    expect(currentText('spe', 4, 'tie')).toBe('현재 S4 동속')
    expect(currentText('spe', 4, undefined)).toBe('현재 S4')
    expect(fixedText('second')).toBe('항상 후공')
  })
  const T = { highRoll: 14 / 16, lowRoll: 2 / 16 }
  it('결과 배지: 확정은 글자, 그 사이는 "난수1타: xx.x%" — 공격 색은 고난수 기준 단계', () => {
    expect(koBadge('attack', { ohkoChance: 1 }, T)).toEqual({ label: '확정1타', tone: 'red' })
    expect(koBadge('attack', { ohkoChance: 14 / 16 }, T)).toEqual({ label: '난수1타: 87.5%', tone: 'orange' })
    expect(koBadge('attack', { ohkoChance: 13 / 16 }, T)).toEqual({ label: '난수1타: 81.3%', tone: 'yellow' })
    expect(koBadge('attack', { ohkoChance: 0.128 }, T)).toEqual({ label: '난수1타: 12.8%', tone: 'yellow' })
    expect(koBadge('attack', { ohkoChance: 0 }, T)).toEqual({ label: '확정견딤', tone: 'green' })
  })
  it('결과 배지: 방어 색은 저난수 기준 단계(이하면 노랑)', () => {
    expect(koBadge('defense', { ohkoChance: 1 }, T)).toEqual({ label: '확정1타', tone: 'red' })
    expect(koBadge('defense', { ohkoChance: 3 / 16 }, T)).toEqual({ label: '난수1타: 18.8%', tone: 'orange' })
    expect(koBadge('defense', { ohkoChance: 2 / 16 }, T)).toEqual({ label: '난수1타: 12.5%', tone: 'yellow' })
    expect(koBadge('defense', { ohkoChance: 0 }, T)).toEqual({ label: '확정견딤', tone: 'green' })
  })
  it('결과 배지: 기준을 바꾸면 같은 확률의 색 단계가 바뀐다(문구는 그대로)', () => {
    expect(koBadge('attack', { ohkoChance: 13 / 16 }, { highRoll: 13 / 16, lowRoll: 2 / 16 })).toEqual({ label: '난수1타: 81.3%', tone: 'orange' })
    expect(koBadge('defense', { ohkoChance: 3 / 16 }, { highRoll: 14 / 16, lowRoll: 3 / 16 })).toEqual({ label: '난수1타: 18.8%', tone: 'yellow' })
  })
  it('난수 확률 문구: 소수 첫째 자리 반올림, 0.1%~99.9% 고정(확정과 혼동 금지)', () => {
    expect(rollChanceText(0.0004)).toBe('0.1%')
    expect(rollChanceText(0.0001)).toBe('0.1%')
    expect(rollChanceText(0.9996)).toBe('99.9%')
    expect(rollChanceText(0.99999)).toBe('99.9%')
    expect(rollChanceText(0.12849)).toBe('12.8%')
    expect(rollChanceText(0.12851)).toBe('12.9%')
    expect(rollChanceText(0.5)).toBe('50.0%')
  })
  it('기준 입력: 1~15 정수만 받고, 비율 ↔ n 왕복', () => {
    expect(parseRollSteps('14', 16)).toBe(14)
    expect(parseRollSteps(' 1 ', 16)).toBe(1)
    expect(parseRollSteps('15', 16)).toBe(15)
    for (const bad of ['0', '16', '-1', '2.5', '1e1', '', ' ', 'abc', '０']) expect(parseRollSteps(bad, 16)).toBeUndefined()
    expect(rollStepsOf(14 / 16, 16)).toBe(14)
    expect(rollStepsOf(2 / 16, 16)).toBe(2)
    expect(shareText(14 / 16)).toBe('87.5%')
    expect(shareText(2 / 16)).toBe('12.5%')
  })
  it('행동 순서 배지(스피드 탭): 선공·동속·후공을 글자로, 그 밖 범주·칸 없음은 배지 없음', () => {
    expect(orderBadge({ category: 'first' })).toEqual({ label: '선공', tone: 'green' })
    expect(orderBadge({ category: 'tie' })).toEqual({ label: '동속', tone: 'yellow' })
    expect(orderBadge({ category: 'second' })).toEqual({ label: '후공', tone: 'red' })
    expect(orderBadge({ category: 'guaranteed-ohko' })).toBeUndefined()
    expect(orderBadge(undefined)).toBeUndefined()
  })
  it('결과 배지: 무효는 회색, 1타 확률이 없거나 칸이 없으면 배지 없음', () => {
    expect(koBadge('attack', { immune: true, ohkoChance: 0 }, T)).toEqual({ label: '무효', tone: 'gray' })
    expect(koBadge('defense', {}, T)).toBeUndefined()
    expect(koBadge('attack', undefined, T)).toBeUndefined()
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
