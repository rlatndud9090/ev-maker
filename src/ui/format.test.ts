import { describe, expect, it } from 'vitest'
import {
  bundleText,
  categoryLabel,
  categorySymbol,
  categoryTone,
  currentText,
  fixedText,
  fromPercentInput,
  judgementText,
  koBadge,
  orderBadge,
  parseRollSteps,
  rankText,
  rollChanceText,
  refsNote,
  shareText,
  spanText,
  spansOf,
  targetText,
  toPercentInput,
} from './format'

describe('targetText', () => {
  const one = (stat: 'atk' | 'spe', sp: number, need = 0) => ({ stats: [{ stat, sp }], need })
  it('단일 능력치: "<판정>: 최소 A32 / A15+"(무보정 / 상승)', () => {
    expect(targetText({ label: 'guaranteed-ohko', plusStat: 'atk', neutral: one('atk', 32), plus: one('atk', 15) })).toBe('확정1타: 최소 A32 / A15+')
  })
  it('방어 쌍: H와 B를 함께, 상승 대상(B/D) 뒤에만 +', () => {
    const pair = (hp: number, d: number) => ({ stats: [{ stat: 'hp' as const, sp: hp }, { stat: 'def' as const, sp: d }], need: 0 })
    expect(targetText({ label: 'guaranteed-survive', plusStat: 'def', neutral: pair(4, 12), plus: pair(2, 8) })).toBe('확정견딤: 최소 H4 B12 / H2 B8+')
  })
  it('한쪽이 불가면 "무보정 불가"·"상승 불가"', () => {
    expect(targetText({ label: 'low-roll-ohko', plusStat: 'atk', neutral: null, plus: one('atk', 28) })).toBe('저난수1타: 무보정 불가 / A28+')
    expect(targetText({ label: 'first', plusStat: 'spe', neutral: one('spe', 20), plus: null })).toBe('선공: 최소 S20 / 상승 불가')
  })
  it('n은 선택지마다 "(다른 능력치에서 n 필요)"', () => {
    expect(targetText({ label: 'high-roll-ohko', plusStat: 'atk', neutral: one('atk', 27, 15), plus: one('atk', 11) })).toBe(
      '고난수1타: 최소 A27 (다른 능력치에서 15 필요) / A11+',
    )
  })
  it('판정 라벨(5단)·랭크 부호', () => {
    expect(judgementText('mid-roll-ohko')).toBe('중난수1타')
    expect(judgementText('low-roll-ohko')).toBe('저난수1타')
    expect(judgementText('tie')).toBe('동속')
    expect(rankText(2)).toBe('+2')
    expect(rankText(-1)).toBe('−1')
  })
})

describe('라벨', () => {
  it('범주 라벨: 5단 판정은 배지 단계명, 행동 순서, 3단 구간(dev)', () => {
    expect(categoryLabel('guaranteed-ohko')).toBe('확정1타')
    expect(categoryLabel('high-roll-ohko')).toBe('고난수1타')
    expect(categoryLabel('mid-roll-ohko')).toBe('중난수1타')
    expect(categoryLabel('low-roll-ohko')).toBe('저난수1타')
    expect(categoryLabel('guaranteed-survive')).toBe('확정견딤')
    expect(categoryLabel('mid-or-higher')).toBe('중난수 이상')
    expect(categoryLabel('second')).toBe('후공')
    expect(categoryLabel('unknown-x')).toBe('unknown-x')
  })
  it('범주 색: 배지와 같은 5색(탭 무관), 스피드는 선공 초록·후공 빨강', () => {
    expect(['guaranteed-ohko', 'high-roll-ohko', 'mid-roll-ohko', 'low-roll-ohko', 'guaranteed-survive'].map(categoryTone)).toEqual([
      'red',
      'orange',
      'yellow',
      'lime',
      'green',
    ])
    expect(categoryTone('first')).toBe('green')
    expect(categoryTone('second')).toBe('red')
    expect(categoryTone('mid-or-lower')).toBe('gray')
  })
  it('범주 기호: 탭 관점의 좋고 나쁨(공격은 확정1타 ◎, 방어는 확정견딤 ◎)', () => {
    expect(categorySymbol('attack', 'guaranteed-ohko')).toBe('◎')
    expect(categorySymbol('attack', 'high-roll-ohko')).toBe('○')
    expect(categorySymbol('attack', 'mid-roll-ohko')).toBe('△')
    expect(categorySymbol('attack', 'low-roll-ohko')).toBe('▽')
    expect(categorySymbol('attack', 'guaranteed-survive')).toBe('×')
    expect(categorySymbol('defense', 'guaranteed-ohko')).toBe('×')
    expect(categorySymbol('defense', 'guaranteed-survive')).toBe('◎')
    expect(categorySymbol('defense', 'low-roll-ohko')).toBe('○')
    expect(categorySymbol('speed', 'first')).toBe('◎')
    expect(categorySymbol('speed', 'tie')).toBe('△')
    expect(categorySymbol('speed', 'second')).toBe('×')
    expect(categorySymbol('attack', 'first')).toBe('·')
  })
  it('현재·고정 문구', () => {
    expect(currentText('atk', 32, 'high-roll-ohko')).toBe('현재 A32 고난수1타')
    expect(currentText('def', 0, 'low-roll-ohko')).toBe('현재 B0 저난수1타')
    expect(currentText('spe', 4, 'tie')).toBe('현재 S4 동속')
    expect(currentText('spe', 4, undefined)).toBe('현재 S4')
    expect(fixedText('second')).toBe('항상 후공')
  })
  const N = 14
  it('결과 배지: 5단 단계명 + 0<p<1이면 확률(chance), 확정은 확률 없이 — 공격·방어 같은 문구·색', () => {
    for (const side of ['attack', 'defense'] as const) {
      expect(koBadge(side, { ohkoChance: 1 }, N)).toEqual({ label: '확정1타', tone: 'red' })
      expect(koBadge(side, { ohkoChance: 15 / 16 }, N)).toEqual({ label: '고난수1타', tone: 'orange', chance: '93.8%' })
      expect(koBadge(side, { ohkoChance: 14 / 16 }, N)).toEqual({ label: '고난수1타', tone: 'orange', chance: '87.5%' })
      expect(koBadge(side, { ohkoChance: 8 / 16 }, N)).toEqual({ label: '중난수1타', tone: 'yellow', chance: '50.0%' })
      expect(koBadge(side, { ohkoChance: 2 / 16 }, N)).toEqual({ label: '저난수1타', tone: 'lime', chance: '12.5%' })
      expect(koBadge(side, { ohkoChance: 1 / 16 }, N)).toEqual({ label: '저난수1타', tone: 'lime', chance: '6.3%' })
      expect(koBadge(side, { ohkoChance: 0 }, N)).toEqual({ label: '확정견딤', tone: 'green' })
    }
  })
  it('결과 배지: 기준을 바꾸면 같은 확률의 단계가 바뀐다', () => {
    expect(koBadge('attack', { ohkoChance: 13 / 16 }, 13)).toMatchObject({ label: '고난수1타', tone: 'orange' })
    expect(koBadge('attack', { ohkoChance: 13 / 16 }, 14)).toMatchObject({ label: '중난수1타', tone: 'yellow' })
    expect(koBadge('defense', { ohkoChance: 3 / 16 }, 13)).toMatchObject({ label: '저난수1타', tone: 'lime' })
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
  it('기준 입력: 1~15 정수만 받는다', () => {
    expect(parseRollSteps('14', 16)).toBe(14)
    expect(parseRollSteps(' 1 ', 16)).toBe(1)
    expect(parseRollSteps('15', 16)).toBe(15)
    for (const bad of ['0', '16', '-1', '2.5', '1e1', '', ' ', 'abc', '０']) expect(parseRollSteps(bad, 16)).toBeUndefined()
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
    expect(koBadge('attack', { immune: true, ohkoChance: 0 }, N)).toEqual({ label: '무효', tone: 'gray' })
    expect(koBadge('defense', {}, N)).toBeUndefined()
    expect(koBadge('attack', undefined, N)).toBeUndefined()
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
    expect(spanText({ from: 0, to: 22, category: 'guaranteed-survive', overBudget: false })).toBe('0~22 확정견딤')
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
