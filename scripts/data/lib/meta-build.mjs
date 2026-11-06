// 메타 변환: 원천 키 정규화·게임 데이터 조인, 위반 판정·제외, 분포·주변분포·표본 지표, 대표 세트, 리포트 객체.
import { NO_ITEM } from '../../../src/data/meta-schema.ts'
import { PipelineError, cmp, toID } from './util.mjs'

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const ALIAS_KINDS = ['species', 'items', 'abilities', 'moves']

export const VIOLATION_KINDS = [
  'unlinked-species',
  'species-not-in-roster',
  'unlinked-item',
  'item-not-in-roster',
  'unlinked-ability',
  'illegal-ability',
  'unlinked-move',
  'illegal-move',
  'unknown-nature',
  'sp-over-max',
  'sp-over-total',
  'unlinked-teammate',
  'teammate-not-in-roster',
]

/** 점유율은 소수 넷째 자리, 표본 가중값은 소수 둘째 자리로 반올림한다. */
export const roundShare = (x) => Math.round(x * 1e4) / 1e4
export const round2 = (x) => Math.round(x * 100) / 100
const round1 = (x) => Math.round(x * 10) / 10
const sum = (values) => values.reduce((a, b) => a + b, 0)

/** aliases.meta = { <kind>: { <원천 id>: { id, note } } } */
export function validateMetaAliases(meta) {
  if (meta === undefined) return
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) throw new PipelineError('aliases.meta가 객체가 아니다')
  for (const [kind, table] of Object.entries(meta)) {
    if (!ALIAS_KINDS.includes(kind)) throw new PipelineError(`aliases.meta: 알 수 없는 종류 ${kind}`)
    for (const [from, to] of Object.entries(table ?? {})) {
      if (toID(from) !== from || typeof to?.id !== 'string' || toID(to.id) !== to.id || typeof to.note !== 'string' || !to.note) {
        throw new PipelineError(`aliases.meta.${kind}.${from}: { id, note } 형식이어야 한다`)
      }
    }
  }
}

/** 값을 내림차순·동률 키 오름차순으로 정렬한 [키, 값] 배열. */
const byWeight = (entries) => [...entries].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))

function addTo(map, key, v) {
  map.set(key, (map.get(key) ?? 0) + v)
}

/**
 * 원천 → { entries(대표 세트 미검증), report, weightedBattles }.
 * game: { manifest, data }, pkmn: createPkmnSource 결과, rules: 레귤레이션 rules.
 */
export function transformSource({ raw, regulation, params, game, pkmn, rules, aliases }) {
  const { data } = game
  const alias = (kind, id) => aliases?.[kind]?.[id]?.id ?? id
  const details = []
  const violation = (kind, species, value, weight, W) =>
    details.push({ kind, species, value, weight: roundShare(weight), share: W === undefined ? undefined : roundShare(weight / W) })

  let totalWeight = 0
  const candidates = []
  const unlinkedAboveMin = []
  const megaCheck = { checked: 0, stoneNotTop: [], abilityOutsideForm: [] }
  const blank = { species: 0, weight: 0 }

  const sourceKeys = Object.keys(raw.data).sort(cmp)
  for (const key of sourceKeys) {
    const e = raw.data[key]
    const W = sum(Object.values(e.Abilities))
    totalWeight += W
    const id = alias('species', toID(key))
    const forme = Object.hasOwn(data.species, id) ? data.species[id] : null
    if (!forme) {
      const kind = pkmn.getSpecies(id) ? 'species-not-in-roster' : 'unlinked-species'
      violation(kind, id, key, W)
      if (kind === 'unlinked-species' && e.usage >= params.minUsage) unlinkedAboveMin.push(key)
      continue
    }
    const base = forme.isMega ? data.species[forme.baseSpecies] : forme
    const ex = { items: 0, moves: 0, spreads: 0 }

    const abilities = new Map()
    for (const [k, v] of Object.entries(e.Abilities)) {
      const a = alias('abilities', toID(k))
      if (forme.abilities.includes(a)) {
        if (v > 0) addTo(abilities, a, v)
      } else {
        violation(Object.hasOwn(data.abilities, a) || pkmn.getAbility(a) ? 'illegal-ability' : 'unlinked-ability', id, a, v, W)
        if (forme.isMega) megaCheck.abilityOutsideForm.push({ species: id, ability: a })
      }
    }

    const items = new Map()
    for (const [k, v] of Object.entries(e.Items)) {
      const it = alias('items', toID(k))
      if (it === NO_ITEM || Object.hasOwn(data.items, it)) {
        if (v > 0) addTo(items, it, v)
      } else {
        violation(pkmn.getItem(it) ? 'item-not-in-roster' : 'unlinked-item', id, it, v, W)
        ex.items += v
      }
    }

    const moves = new Map()
    for (const [k, v] of Object.entries(e.Moves)) {
      if (k === '') {
        blank.species++
        blank.weight += v
        continue
      }
      const m = alias('moves', toID(k))
      if (base.learnset.includes(m)) {
        if (v > 0) addTo(moves, m, v)
      } else {
        violation(Object.hasOwn(data.moves, m) || pkmn.getMove(m) ? 'illegal-move' : 'unlinked-move', id, m, v, W)
        ex.moves += v
      }
    }

    const spreads = new Map()
    for (const [k, v] of Object.entries(e.Spreads)) {
      const [natureRaw, nums] = k.split(':')
      const nature = toID(natureRaw)
      const sp = nums.split('/').map(Number)
      const norm = `${nature}:${sp.join('/')}`
      let kind = null
      if (!Object.hasOwn(data.natures, nature)) kind = 'unknown-nature'
      else if (sp.some((x) => x > rules.spMaxPerStat)) kind = 'sp-over-max'
      else if (sum(sp) > rules.spTotal) kind = 'sp-over-total'
      if (kind) {
        violation(kind, id, norm, v, W)
        ex.spreads += v
      } else if (v > 0) addTo(spreads, norm, v)
    }

    const teammates = new Map()
    for (const [k, v] of Object.entries(e.Teammates)) {
      const t = alias('species', toID(k))
      if (Object.hasOwn(data.species, t)) {
        if (v > 0) addTo(teammates, t, v)
      } else violation(pkmn.getSpecies(t) ? 'teammate-not-in-roster' : 'unlinked-teammate', id, t, v, W)
    }

    if (forme.isMega) {
      megaCheck.checked++
      const top = byWeight(Object.entries(e.Items).map(([k, v]) => [alias('items', toID(k)), v]))[0]?.[0]
      if (top !== forme.requiredItem) megaCheck.stoneNotTop.push({ species: id, top: top ?? null, stone: forme.requiredItem })
    }

    if (e.usage < params.minUsage) continue
    candidates.push({ key, id, forme, base, e, W, abilities, items, moves, spreads, teammates, ex })
  }

  candidates.sort((a, b) => b.e.usage - a.e.usage || cmp(a.id, b.id))
  const entries = candidates.map((c, i) => buildEntry(c, i + 1, params, regulation))

  details.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.species, b.species) || cmp(a.value, b.value))
  const violations = {}
  for (const k of VIOLATION_KINDS) {
    const ds = details.filter((d) => d.kind === k)
    violations[k] = { count: ds.length, weight: roundShare(sum(ds.map((d) => d.weight))) }
  }
  const kept = entries.map((en) => en.spreads.keptShare)
  const short = entries.filter((en) => en.spreads.keptRaw < params.spreadTarget)
  const exhausted = short.filter((en) => en.spreads.kept.length < params.spreadMax).map((en) => en.id)
  const report = {
    species: { source: sourceKeys.length, listed: entries.length },
    violations,
    violationDetails: details,
    blankMoves: { species: blank.species, weight: roundShare(blank.weight) },
    unlinkedAboveMin,
    mega: {
      checked: megaCheck.checked,
      listed: entries.filter((en) => en.mega).length,
      stoneNotTop: megaCheck.stoneNotTop,
      abilityOutsideForm: megaCheck.abilityOutsideForm,
    },
    retention: {
      spreadTarget: params.spreadTarget,
      spreadMax: params.spreadMax,
      reachedTarget: entries.length - short.length,
      hitMax: short.length - exhausted.length,
      exhausted: exhausted.length,
      exhaustedSpecies: exhausted,
      keptShareMin: kept.length ? Math.min(...kept) : null,
      keptShareMean: kept.length ? roundShare(sum(kept) / kept.length) : null,
    },
  }
  for (const en of entries) delete en.spreads.keptRaw
  return { entries, report, weightedBattles: round1(totalWeight / 12) }
}

function shares(map, W, min = 0) {
  const out = {}
  let kept = 0
  for (const [k, v] of map) {
    if (v / W < min) continue
    out[k] = roundShare(v / W)
    kept += v / W
  }
  return { shares: out, kept }
}

function buildEntry(c, rank, params, regulation) {
  const { W } = c
  const items = shares(c.items, W, params.itemMin)
  const moves = shares(c.moves, W, params.moveMin)

  const sortedSpreads = byWeight(c.spreads)
  const kept = []
  let cum = 0
  for (const [k, v] of sortedSpreads) {
    kept.push([k, roundShare(v / W)])
    cum += v / W
    if (cum >= params.spreadTarget || kept.length >= params.spreadMax) break
  }

  const natures = new Map()
  const marginal = Object.fromEntries(STATS.map((s) => [s, new Map()]))
  for (const [k, v] of c.spreads) {
    const [nature, nums] = k.split(':')
    addTo(natures, nature, v)
    nums.split('/').forEach((x, i) => addTo(marginal[STATS[i]], x, v))
  }

  const teammates = {}
  for (const [k, v] of byWeight(c.teammates).slice(0, params.teammatesTop)) teammates[k] = roundShare(v / W)

  const entry = {
    id: c.id,
    rank,
    usage: c.e.usage,
    sample: { weighted: round2(W), raw: c.e['Raw count'] },
    abilities: shares(c.abilities, W).shares,
    items: { shares: items.shares, keptShare: roundShare(items.kept), excludedShare: roundShare(c.ex.items / W) },
    moves: { shares: moves.shares, keptShare: roundShare(moves.kept), excludedShare: roundShare(c.ex.moves / W) },
    spreads: { kept, keptShare: roundShare(cum), excludedShare: roundShare(c.ex.spreads / W), keptRaw: cum },
    natures: shares(natures, W).shares,
    spMarginal: Object.fromEntries(STATS.map((s) => [s, shares(marginal[s], W).shares])),
    teammates,
    representative: representative(c, sortedSpreads, regulation),
  }
  if (c.forme.isMega) entry.mega = { base: c.base.id, stone: c.forme.requiredItem }
  return entry
}

function representative(c, sortedSpreads, regulation) {
  const top = sortedSpreads[0]
  const topAbility = byWeight(c.abilities)[0]?.[0]
  if (!top || !topAbility) throw new PipelineError(`${c.id}: 대표 세트를 만들 spread·특성이 없다(위반 제외 후)`)
  const [nature, nums] = top[0].split(':')
  const spValues = nums.split('/').map(Number)
  const set = {
    regulation,
    species: c.base.id,
    ability: topAbility,
    nature,
    sp: Object.fromEntries(STATS.map((s, i) => [s, spValues[i]])),
    moves: byWeight(c.moves).slice(0, 4).map(([m]) => m),
  }
  const out = { set, basis: 'modal-combination' }
  if (c.forme.isMega) {
    set.item = c.forme.requiredItem
    set.mega = true
    const sourceTop = c.base.abilities.includes(topAbility)
    set.ability = sourceTop ? topAbility : c.base.abilities[0]
    out.abilityBasis = sourceTop ? 'source-top' : 'base-first-slot'
  } else {
    const topItem = byWeight(c.items)[0]?.[0]
    if (topItem !== undefined && topItem !== NO_ITEM) set.item = topItem
  }
  return out
}
