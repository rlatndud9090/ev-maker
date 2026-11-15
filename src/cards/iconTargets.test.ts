/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import type { MetaEntry } from '../data/meta-schema'
import { RESIST_BERRIES } from './berries'
import { iconTargets } from './iconTargets'
import { POWER_ITEMS } from './powerItems'
import { realData, syntheticEntry } from './testing'

const { game, bo1 } = realData()
const entry = (id: string): MetaEntry => {
  const e = bo1.meta.entries.find((x) => x.id === id)
  if (e === undefined) throw new Error(`실데이터에 ${id}가 없다`)
  return e
}
const withItem = (base: MetaEntry, item: string, shares: Record<string, number>): MetaEntry =>
  syntheticEntry(base, { representative: { ...base.representative, set: { ...base.representative.set, item } }, items: { ...base.items, shares } })

describe('iconTargets (R14 합집합)', () => {
  it('메타가 없어도 기존 반감열매·화력 도구 전부와 구애스카프가 들어간다', () => {
    const t = iconTargets(game, [])
    for (const id of [...Object.keys(RESIST_BERRIES), ...POWER_ITEMS]) expect(t.get(id), id).toContain('existing')
    expect(t.get('choicescarf')).toContain('scarf')
  })

  it('래더 가정 세트 도구를 넣는다(메가 항목은 종별 메가스톤)', () => {
    const base = withItem(entry('sneasler'), 'quickclaw', { quickclaw: 0.9 })
    const t = iconTargets(game, [{ ...bo1.meta, entries: [base, entry('charizardmegay')] }])
    expect(t.get('quickclaw')).toContain('ladder-set')
    expect(t.get('charizarditey')).toContain('ladder-set')
  })

  it('대표 도구가 구애스카프면 그 밖 최다 도구(non-scarf)를 넣고, 기준값과 무관하다', () => {
    const scarfer = withItem(entry('garchomp'), 'choicescarf', { choicescarf: 0.5, quickclaw: 0.3, lifeorb: 0.2 })
    expect(iconTargets(game, [{ ...bo1.meta, entries: [scarfer] }]).get('quickclaw')).toEqual(['non-scarf'])
  })

  it('메가 항목은 스카프 규칙을 부르지 않는다(앱의 스카프 조건 생략과 같다)', () => {
    const mega = entry('charizardmegay')
    const fake = syntheticEntry(mega, { items: { ...mega.items, shares: { charizarditey: 0.5, quickclaw: 0.5 } } })
    expect(iconTargets(game, [{ ...bo1.meta, entries: [fake] }]).has('quickclaw')).toBe(false)
  })

  it('목록 밖 타겟 프리셋 도구 = 메가 폼 타겟의 메가스톤(도구 없음 프리셋은 넣지 않는다)', () => {
    const t = iconTargets(game, [])
    const presetIds = [...t].filter(([, s]) => s.includes('preset')).map(([id]) => id)
    const stones = new Set(game.data.megas.map((m) => m.stone))
    expect(presetIds.length).toBeGreaterThan(0)
    for (const id of presetIds) expect(stones.has(id), id).toBe(true)
  })

  it('결과는 id 순 정렬이고 근거도 정렬돼 있다', () => {
    const ids = [...iconTargets(game, [bo1.meta]).keys()]
    expect(ids).toEqual([...ids].sort())
    for (const s of iconTargets(game, [bo1.meta]).values()) expect([...s]).toEqual([...s].sort())
  })
})
