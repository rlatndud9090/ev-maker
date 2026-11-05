// 게임 데이터 원천 어댑터: @pkmn/dex + @pkmn/mods 모드를 "상속 해석된 조회 인터페이스"로 노출한다.
// 추출기는 이 인터페이스만 본다. 다른 원천(Showdown 커밋 등)도 같은 모양을 돌려주면 된다.
//
// GameDataSource = {
//   mode, parentMode,
//   species(): SpeciesRecord[], moves(): MoveRecord[], items(): ItemRecord[],
//   abilities(): AbilityRecord[], natures(): NatureRecord[],
//   getSpecies(id), getMove(id), getItem(id), getAbility(id)  → record | null
//   learnset(id): Promise<string[] | null>   (그 종 자신의 목록, 없으면 null)
//   modOverrides: { pokedex, abilities, learnsets, moves, items }  (모드 파일 자체가 덮는 id 목록)
// }
import { Dex } from '@pkmn/dex'
import { PipelineError, cmp, toID } from './util.mjs'

const ABILITY_SLOTS = ['0', '1', 'H', 'S']
const dexCache = new Map()

async function loadModDex(mode) {
  if (dexCache.has(mode)) return dexCache.get(mode)
  const mod = await import(/* @vite-ignore */ `@pkmn/mods/${mode}`)
  const parentMode = mod.Scripts?.inherit
  // 상속 모드는 부모가 먼저 등록돼 있어야 @pkmn/dex가 부모 데이터를 해석한다.
  if (parentMode && !/^gen\d+$/.test(parentMode)) await loadModDex(parentMode)
  const entry = { dex: Dex.mod(mode, mod), mod, parentMode: parentMode ?? null }
  // learnset은 지연 로드된다. 자식 모드가 부모를 modData 없이 로드하면 gen+1을 찾다 실패하므로
  // 부모부터 자기 modData로 먼저 로드해 둔다.
  await entry.dex.learnsets.get(entry.dex.species.all()[0].id)
  dexCache.set(mode, entry)
  return entry
}

const keysOf = (o) => Object.keys(o ?? {}).sort(cmp)

function speciesRecord(s) {
  const abilities = []
  for (const slot of ABILITY_SLOTS) {
    const a = s.abilities?.[slot]
    if (a && !abilities.includes(a)) abilities.push(a)
  }
  return {
    id: s.id,
    name: s.name,
    num: s.num,
    forme: s.forme ?? '',
    baseSpecies: s.baseSpecies,
    changesFrom: s.changesFrom ?? null,
    types: [...s.types],
    baseStats: { ...s.baseStats },
    weightkg: s.weightkg,
    abilities,
    isNonstandard: s.isNonstandard ?? null,
    isCosmeticForme: Boolean(s.isCosmeticForme),
    battleOnly: s.battleOnly ?? null,
    requiredItem: s.requiredItem ?? null,
  }
}

function moveRecord(m) {
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    category: m.category,
    basePower: m.basePower,
    accuracy: m.accuracy,
    priority: m.priority,
    multihit: m.multihit ?? null,
    target: m.target,
    flags: keysOf(m.flags),
    isNonstandard: m.isNonstandard ?? null,
  }
}

const itemRecord = (i) => ({
  id: i.id,
  name: i.name,
  isNonstandard: i.isNonstandard ?? null,
  megaStone: i.megaStone ? { ...i.megaStone } : null,
})
const abilityRecord = (a) => ({ id: a.id, name: a.name, isNonstandard: a.isNonstandard ?? null })
const natureRecord = (n) => ({ id: n.id, name: n.name, plus: n.plus ?? null, minus: n.minus ?? null })

export async function createPkmnSource(mode) {
  const { dex, mod, parentMode } = await loadModDex(mode)
  const byId = (list) => new Map(list.map((r) => [r.id, r]))
  const species = dex.species.all().map(speciesRecord)
  const moves = dex.moves.all().map(moveRecord)
  const items = dex.items.all().map(itemRecord)
  const abilities = dex.abilities.all().map(abilityRecord)
  const natures = dex.natures.all().map(natureRecord)
  const maps = {
    species: byId(species),
    moves: byId(moves),
    items: byId(items),
    abilities: byId(abilities),
  }
  return {
    mode,
    parentMode,
    species: () => species,
    moves: () => moves,
    items: () => items,
    abilities: () => abilities,
    natures: () => natures,
    getSpecies: (id) => maps.species.get(toID(id)) ?? null,
    getMove: (id) => maps.moves.get(toID(id)) ?? null,
    getItem: (id) => maps.items.get(toID(id)) ?? null,
    getAbility: (id) => maps.abilities.get(toID(id)) ?? null,
    async learnset(id) {
      const ls = await dex.learnsets.get(toID(id))
      if (!ls?.exists || !ls.learnset) return null
      return keysOf(ls.learnset)
    },
    modOverrides: {
      pokedex: keysOf(mod.Pokedex),
      abilities: keysOf(mod.Abilities),
      learnsets: keysOf(mod.Learnsets),
      moves: keysOf(mod.Moves),
      items: keysOf(mod.Items),
    },
  }
}

export function assertPinnedPackages(config, lock, installed) {
  for (const [name, pin] of Object.entries(config.gameData.packages).concat([
    [config.engine.package, config.engine],
  ])) {
    const entry = lock.packages?.[`node_modules/${name}`]
    if (!entry) throw new PipelineError(`package-lock에 ${name} 없음`)
    if (entry.version !== pin.version || entry.integrity !== pin.integrity) {
      throw new PipelineError(
        `${name} 고정값 불일치: config ${pin.version} ${pin.integrity} / lock ${entry.version} ${entry.integrity}`,
      )
    }
    if (installed[name] !== pin.version) {
      throw new PipelineError(`${name} 설치 버전 ${installed[name]} ≠ 고정 ${pin.version} (npm ci 필요)`)
    }
  }
}
