import { describe, expect, it } from 'vitest'
import type { PokemonSet } from '../core'
import { buildTabView } from './batch'
import { defaultOption, groupCards } from './groups'
import { planTab } from './plan'
import { precomputeCardIds } from './schedule'
import { cardInput, realData } from './testing'
import { DAMAGE_TABS } from './types'

const { game } = realData()
const chomp: PokemonSet = {
  regulation: game.manifest.regulation.id,
  species: 'garchomp',
  ability: 'roughskin',
  item: 'lifeorb',
  nature: 'hardy',
  sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  moves: ['earthquake', 'dragonclaw', 'stoneedge', 'stompingtantrum'],
}

// speed-bundles-pin-disable R6: 미리 계산 기본 대상은 화면 기본 선택(그룹마다 defaultOption, 도구 변형 그룹 포함)을 덮는다. 화면이 알린 보이는 카드가 여기에 더해진다
describe('미리 계산 기본 대상(먼저 계산할 카드 + 도구 변형) ⊇ 그룹 기본 선택', () => {
  for (const tab of DAMAGE_TABS) {
    it(`${tab}: 그룹마다 기본 선택 카드가 precomputeCardIds에 든다`, () => {
      const input = cardInput({ mySet: chomp, filters: { topN: 20, selected: [] } })
      const primary = precomputeCardIds(planTab(input, tab))
      const groups = groupCards(buildTabView(input, tab).cards, tab)
      expect(groups.length).toBeGreaterThan(0)
      expect(groups.map((g) => defaultOption(g).id).filter((id) => !primary.has(id))).toEqual([])
    })
  }
})
