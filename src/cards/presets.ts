// 메타 목록 밖 타겟의 프리셋 가정. 통계 값 없이 커스텀 출처(as-published)로만 만든다.
import type { PokemonSet, SpTable } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import type { Assumption } from '../meta'
import type { Category, PresetEdit, PresetIndex, Tab } from './types'

export const NEUTRAL_NATURE = 'hardy'

interface PresetDef {
  sp: Partial<SpTable>
  nature: string
}

const three = (sp: Partial<SpTable>, plusNature: string): readonly [PresetDef, PresetDef, PresetDef] => [
  { sp, nature: NEUTRAL_NATURE },
  { sp, nature: plusNature },
  { sp: {}, nature: NEUTRAL_NATURE },
]

/** 키 = JSON.stringify([tab, category]) */
const PRESETS: Readonly<Record<string, readonly [PresetDef, PresetDef, PresetDef]>> = {
  [JSON.stringify(['attack', 'physical'])]: three({ hp: 32, def: 32 }, 'impish'),
  [JSON.stringify(['attack', 'special'])]: three({ hp: 32, spd: 32 }, 'careful'),
  [JSON.stringify(['defense', 'physical'])]: three({ atk: 32 }, 'adamant'),
  [JSON.stringify(['defense', 'special'])]: three({ spa: 32 }, 'modest'),
  [JSON.stringify(['speed', null])]: three({ spe: 32 }, 'jolly'),
}

const ZERO_SP: SpTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

/** 탭·분류 조합이 없으면(공격·방어 탭 null, 스피드 탭 분류) RangeError. */
export function presetDef(tab: Tab, category: Category | null, preset: PresetIndex): PresetDef {
  const row = PRESETS[JSON.stringify([tab, tab === 'speed' ? null : category])]
  if (!row || (tab !== 'speed' && category === null)) {
    throw new RangeError(`프리셋이 없는 조합이다: ${tab}·${String(category)}`)
  }
  return row[preset]
}

/**
 * 메가 폼 타겟이면 원종 + 메가스톤 + mega: true, 아니면 도구 없음. 특성은 원종 첫 슬롯,
 * 프리셋이 정하지 않은 SP는 0. edit가 있으면 덮어쓴다(item: null = 도구 없음). moves는 세트 기술.
 */
export function presetAssumption(
  game: Snapshot,
  rosterId: string,
  moves: readonly string[],
  tab: Tab,
  category: Category | null,
  preset: PresetIndex,
  edit?: PresetEdit,
): Assumption {
  const def = presetDef(tab, category, preset)
  const has = (id: string) => Object.prototype.hasOwnProperty.call(game.data.species, id)
  const entry = has(rosterId) ? game.data.species[rosterId] : undefined
  const mega = entry?.isMega ? game.data.megas.find((m) => m.forme === rosterId) : undefined
  const baseId = mega?.base ?? entry?.baseSpecies ?? rosterId
  const base = has(baseId) ? game.data.species[baseId] : undefined
  const set: PokemonSet = {
    regulation: game.manifest.regulation.id,
    species: entry?.isMega ? baseId : rosterId,
    ability: base?.abilities[0] ?? '',
    nature: def.nature,
    sp: { ...ZERO_SP, ...def.sp },
    moves: [...moves],
  }
  if (mega) {
    set.item = mega.stone
    set.mega = true
  }
  if (edit) {
    if (edit.sp) {
      for (const s of Object.keys(edit.sp) as StatId[]) {
        const v = edit.sp[s]
        if (v !== undefined) set.sp[s] = v
      }
    }
    if (edit.nature !== undefined) set.nature = edit.nature
    if (edit.ability !== undefined) set.ability = edit.ability
    if (edit.item === null) delete set.item
    else if (edit.item !== undefined) set.item = edit.item
  }
  return { target: rosterId, set, source: { kind: 'custom' }, basis: 'as-published' }
}
