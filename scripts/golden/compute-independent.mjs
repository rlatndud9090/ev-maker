// 독립 기준값 생성기. @smogon/calc를 import하지 않는다(엔진과 독립된 산술).
// 종족값·타입·기술 수치는 @pkmn/dex + @pkmn/mods champions에서만 읽는다.
// 사용: node scripts/golden/compute-independent.mjs          → independent.json 기록
//       node scripts/golden/compute-independent.mjs --check  → 기록된 파일과 바이트 비교
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Dex } from '@pkmn/dex'
import * as champions from '@pkmn/mods/champions'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = resolve(ROOT, 'src/core/__golden__/independent.json')
const SOURCE = '독립 산술(scripts/golden/compute-independent.mjs)'
const pkgVersion = (name) =>
  JSON.parse(readFileSync(resolve(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version

const dex = Dex.mod('champions', champions)

const LEVEL = 50
const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const DEFAULT_THRESHOLDS = { highRoll: 0.75, lowRoll: 0.1875 }

function fail(msg) {
  throw new Error(`[golden] ${msg}`)
}

// ---------- 정수 산술 ----------

/** 게임의 반올림: 소수부가 0.5 초과일 때만 올린다(.5는 내림). */
function pokeRound(x) {
  return x % 1 > 0.5 ? Math.ceil(x) : Math.floor(x)
}
/** 4096 기준 보정 1개 적용 */
function applyMod(value, mod4096) {
  return pokeRound((value * mod4096) / 4096)
}
/** 4096 기준 보정 체인 합성: M = (M * m + 2048) >> 12 */
function chainMods(mods) {
  let m = 4096
  for (const x of mods) m = (m * x + 2048) >> 12
  return m
}

// ---------- 데이터 조회(원천: @pkmn/mods champions) ----------

async function species(name) {
  const s = dex.species.get(name)
  if (!s.exists || s.isNonstandard) fail(`champions 비합법 종: ${name}`)
  return s
}
function nature(name) {
  const n = dex.natures.get(name)
  if (!n.exists) fail(`성격 없음: ${name}`)
  return n
}
async function move(name, learner) {
  const m = dex.moves.get(name)
  if (!m.exists || m.isNonstandard) fail(`champions 비합법 기술: ${name}`)
  const base = dex.species.get(learner.changesFrom ?? learner.baseSpecies ?? learner.name)
  const ls = (await dex.learnsets.get(learner.id))?.learnset ?? {}
  const lsBase = (await dex.learnsets.get(base.id))?.learnset ?? {}
  if (!ls[m.id] && !lsBase[m.id]) fail(`${learner.name}이(가) ${name}을(를) 배우지 않는다`)
  return m
}
function assertAbility(sp, ability) {
  if (!Object.values(sp.abilities).includes(ability)) fail(`${sp.name}의 특성이 아니다: ${ability}`)
}
function typeEffectiveness(moveType, defTypes) {
  let num = 1
  let den = 1
  for (const t of defTypes) {
    const code = dex.types.get(t).damageTaken[moveType]
    if (code === 1) num *= 2
    else if (code === 2) den *= 2
    else if (code === 3) return 0
    else if (code !== 0) fail(`상성 코드 해석 불가: ${moveType}→${t}=${code}`)
  }
  return num / den
}

// ---------- 실능치(챔피언스: 레벨 50, IV 31, SP 0~32) ----------

function assertSp(sp) {
  let total = 0
  for (const id of STAT_IDS) {
    const v = sp[id] ?? 0
    if (!Number.isInteger(v) || v < 0 || v > 32) fail(`SP 범위 위반 ${id}=${v}`)
    total += v
  }
  if (total > 66) fail(`SP 합계 초과 ${total}`)
}
function stats(sp, nat, spTable) {
  assertSp(spTable)
  const out = {}
  for (const id of STAT_IDS) {
    const b = sp.baseStats[id]
    const s = spTable[id] ?? 0
    if (id === 'hp') {
      out.hp = b + s + 75
    } else {
      const raw = b + s + 20
      // 정수 산술로 1.1/0.9 부동소수 오차를 피한다.
      out[id] =
        nat.plus === id ? Math.floor((raw * 11) / 10) : nat.minus === id ? Math.floor((raw * 9) / 10) : raw
    }
  }
  return out
}

// ---------- 대미지(9세대 공식, 레벨 50) ----------

/**
 * 1타분 16개 난수 대미지. 다루는 보정만 구현한다(그 외 입력은 넣지 않는다).
 * cond: { doubles, spreadTargets, helpingHand, defenderFullHp }
 */
function damageRolls(atk, def, mv, cond) {
  const physical = mv.category === 'Physical'
  if (!physical && mv.category !== 'Special') fail(`변화기: ${mv.name}`)
  const A = physical ? atk.stats.atk : atk.stats.spa
  const D = physical ? def.stats.def : def.stats.spd

  const bpMods = []
  if (cond.helpingHand) bpMods.push(6144)
  const bp = Math.max(1, applyMod(mv.basePower, chainMods(bpMods)))

  const baseRaw = Math.floor(Math.floor((Math.floor((2 * LEVEL) / 5 + 2) * bp * A) / D) / 50) + 2
  const isSpread = mv.target === 'allAdjacent' || mv.target === 'allAdjacentFoes'
  const base = cond.doubles && isSpread && (cond.spreadTargets ?? 2) > 1 ? applyMod(baseRaw, 3072) : baseRaw

  const stab = atk.species.types.includes(mv.type) ? 6144 : 4096
  const eff = typeEffectiveness(mv.type, def.species.types)
  const finalMods = []
  if (def.ability === 'Multiscale' && cond.defenderFullHp) finalMods.push(2048)
  const finalMod = chainMods(finalMods)

  const rolls = []
  for (let r = 85; r <= 100; r++) {
    let d = Math.floor((base * r) / 100)
    d = applyMod(d, stab)
    d = Math.floor(d * eff)
    if (eff === 0) {
      rolls.push(0)
      continue
    }
    d = Math.max(1, applyMod(d, finalMod))
    rolls.push(d)
  }
  return { rolls, trace: { bp, A, D, baseRaw, base, stab, eff, finalMod } }
}

/** 타별 분포 합성 전수: 조합 수 16^hits 중 합계 ≥ HP인 개수 */
function koCount(rollsPerHit, hp) {
  let sums = [0]
  for (const rolls of rollsPerHit) {
    const next = []
    for (const s of sums) for (const r of rolls) next.push(s + r)
    sums = next
  }
  return { count: sums.filter((s) => s >= hp).length, total: sums.length, min: Math.min(...sums), max: Math.max(...sums) }
}

// 구간 판정은 정수 비교로 한다(count/total 부동소수 비교 회피).
function attackBand(count, total, th = DEFAULT_THRESHOLDS) {
  if (count === total) return 'guaranteed-ohko'
  if (count >= th.highRoll * total) return 'high-roll-ohko'
  return 'mid-or-lower'
}
function defenseBand(count, total, th = DEFAULT_THRESHOLDS) {
  if (count === 0) return 'guaranteed-survive'
  if (count <= th.lowRoll * total) return 'low-roll-ohko'
  return 'mid-or-higher'
}
function boundaries(cells, key) {
  const out = []
  for (let i = 1; i < cells.length; i++) if (cells[i][key] !== cells[i - 1][key]) out.push(cells[i].sp)
  return out
}

// ---------- 세트 ----------

async function makeSet(input) {
  const sp = await species(input.species)
  assertAbility(sp, input.ability)
  const nat = nature(input.nature)
  const full = Object.fromEntries(STAT_IDS.map((id) => [id, input.sp[id] ?? 0]))
  return { input: { ...input, sp: full }, species: sp, ability: input.ability, stats: stats(sp, nat, full) }
}

function setRecord(set) {
  const { species: s, ability, nature: n, sp } = set.input
  // 메가 폼은 앱 입력(원종 + 메가스톤 + mega:true)으로 옮길 수 있게 원천의 원종·필요 도구를 함께 적는다.
  const isMega = /Mega/.test(set.species.forme ?? '')
  if (isMega && !set.species.requiredItem) fail(`${s}의 메가스톤을 원천에서 찾지 못했다`)
  return {
    species: s,
    /** 앱 PokemonSet.species에 넣을 원종(메가가 아니면 species와 같다) */
    setSpecies: isMega ? set.species.baseSpecies : s,
    mega: isMega,
    nature: n,
    ability,
    item: isMega ? set.species.requiredItem : null,
    sp,
    types: [...set.species.types],
    baseStats: { ...set.species.baseStats },
    stats: set.stats,
  }
}
function moveRecord(mv) {
  return {
    name: mv.name,
    type: mv.type,
    category: mv.category,
    basePower: mv.basePower,
    target: mv.target,
    multihit: mv.multihit ?? 1,
  }
}
function pct(n, hp) {
  return Math.round((n / hp) * 1000) / 10
}

// ---------- 사례 ----------

async function caseA() {
  const def = await makeSet({ species: 'Delphox-Mega', nature: 'Hardy', ability: 'Levitate', sp: { hp: 2 } })
  const atk0 = await makeSet({ species: 'Kingambit', nature: 'Hardy', ability: 'Defiant', sp: {} })
  const mv = await move('Sucker Punch', atk0.species)
  const cond = { doubles: true }
  const cells = []
  for (let s = 0; s <= 32; s++) {
    const atk = await makeSet({ species: 'Kingambit', nature: 'Hardy', ability: 'Defiant', sp: { atk: s } })
    const { rolls } = damageRolls(atk, def, mv, cond)
    const k = koCount([rolls], def.stats.hp)
    cells.push({
      sp: s,
      attackStat: atk.stats.atk,
      rolls,
      koCount: k.count,
      koTotal: k.total,
      ohkoChance: k.count / k.total,
      attackBand: attackBand(k.count, k.total),
    })
  }
  // notes.md 손계산(공격 187, 기본 64 → 162-192)과 대조.
  const c32 = cells[32]
  if (c32.attackStat !== 187 || c32.rolls[0] !== 162 || c32.rolls[15] !== 192) fail('사례 a SP32가 손계산 162-192와 다르다')
  const expected32 = [162, 164, 164, 168, 168, 170, 174, 174, 176, 180, 180, 182, 186, 186, 188, 192]
  if (JSON.stringify(c32.rolls) !== JSON.stringify(expected32)) fail('사례 a SP32 16개 값 불일치')
  return {
    id: 'a-kingambit-sucker-punch-atk-sweep',
    source: SOURCE,
    sweep: { side: 'attacker', stat: 'atk', range: [0, 32] },
    attacker: setRecord(atk0),
    defender: setRecord(def),
    move: moveRecord(mv),
    conditions: { gameType: 'Doubles', weather: 'none', terrain: 'none', critical: false, helpingHand: false },
    thresholds: DEFAULT_THRESHOLDS,
    defenderHp: def.stats.hp,
    cells,
    boundaries: boundaries(cells, 'attackBand'),
  }
}

async function caseB() {
  // 공격: 고집 한카리아스 공격 SP32 드래곤클로 → 무보정 망나뇽(정신력) HP SP 0~32, 방어 SP 0. 더블, 단일 대상.
  const atk = await makeSet({ species: 'Garchomp', nature: 'Adamant', ability: 'Rough Skin', sp: { atk: 32 } })
  const mv = await move('Dragon Claw', atk.species)
  const cond = { doubles: true }
  const def0 = await makeSet({ species: 'Dragonite', nature: 'Hardy', ability: 'Inner Focus', sp: {} })
  const cells = []
  for (let s = 0; s <= 32; s++) {
    const def = await makeSet({ species: 'Dragonite', nature: 'Hardy', ability: 'Inner Focus', sp: { hp: s } })
    const { rolls } = damageRolls(atk, def, mv, cond)
    const k = koCount([rolls], def.stats.hp)
    cells.push({
      sp: s,
      defenderHp: def.stats.hp,
      rolls,
      koCount: k.count,
      koTotal: k.total,
      ohkoChance: k.count / k.total,
      defenseBand: defenseBand(k.count, k.total),
    })
  }
  return {
    id: 'b-garchomp-dragon-claw-vs-dragonite-hp-sweep',
    source: SOURCE,
    sweep: { side: 'defender', stat: 'hp', range: [0, 32] },
    attacker: setRecord(atk),
    defender: setRecord(def0),
    move: moveRecord(mv),
    conditions: { gameType: 'Doubles', weather: 'none', terrain: 'none', critical: false, helpingHand: false },
    thresholds: DEFAULT_THRESHOLDS,
    cells,
    boundaries: boundaries(cells, 'defenseBand'),
  }
}

async function caseC() {
  // 겁쟁이 플라엣테(Eternal) 스피드 SP 0~32 vs 명랑 한카리아스 스피드 SP 0. 보정 없음.
  const target = await makeSet({ species: 'Garchomp', nature: 'Jolly', ability: 'Rough Skin', sp: {} })
  const base = await makeSet({ species: 'Floette-Eternal', nature: 'Timid', ability: 'Flower Veil', sp: {} })
  const cells = []
  for (let s = 0; s <= 32; s++) {
    const me = await makeSet({ species: 'Floette-Eternal', nature: 'Timid', ability: 'Flower Veil', sp: { spe: s } })
    const a = me.stats.spe
    const b = target.stats.spe
    cells.push({ sp: s, attackerSpeed: a, defenderSpeed: b, order: a > b ? 'first' : a === b ? 'tie' : 'second' })
  }
  if (cells[32].attackerSpeed !== 158) fail('사례 c SP32 스피드가 골든 158과 다르다')
  return {
    id: 'c-floette-eternal-timid-vs-garchomp-jolly-speed-sweep',
    source: SOURCE,
    sweep: { side: 'attacker', stat: 'spe', range: [0, 32] },
    attacker: setRecord(base),
    defender: setRecord(target),
    conditions: { gameType: 'Doubles', tailwind: false, weather: 'none', trickRoom: false },
    cells,
    boundaries: boundaries(cells, 'order'),
  }
}

async function caseD() {
  // 고정 2타 연속기: 고집 보만다 공격 SP32 더블윙 → 무보정 고릴타 HP SP 2.
  const atk = await makeSet({ species: 'Salamence', nature: 'Adamant', ability: 'Intimidate', sp: { atk: 32 } })
  const def = await makeSet({ species: 'Rillaboom', nature: 'Hardy', ability: 'Overgrow', sp: { hp: 2 } })
  const mv = await move('Dual Wingbeat', atk.species)
  if (mv.multihit !== 2) fail('더블윙이 고정 2타가 아니다')
  const { rolls } = damageRolls(atk, def, mv, { doubles: true })
  const perHit = [rolls, rolls]
  const k = koCount(perHit, def.stats.hp)
  return {
    id: 'd-salamence-dual-wingbeat-vs-rillaboom-multihit',
    source: SOURCE,
    attacker: setRecord(atk),
    defender: setRecord(def),
    move: moveRecord(mv),
    conditions: { gameType: 'Doubles', weather: 'none', terrain: 'none', critical: false, helpingHand: false },
    defenderHp: def.stats.hp,
    hits: 2,
    rollsPerHit: perHit,
    min: k.min,
    max: k.max,
    minPercent: pct(k.min, def.stats.hp),
    maxPercent: pct(k.max, def.stats.hp),
    koCount: k.count,
    koTotal: k.total,
    ohkoChance: k.count / k.total,
    attackBand: attackBand(k.count, k.total),
    defenseBand: defenseBand(k.count, k.total),
  }
}

async function caseE() {
  // 더블 범위기 + 도우미: 고집 맘모꾸리 공격 SP32 지진 → 신중 어흥염 HP SP32·방어 SP2.
  const atk = await makeSet({ species: 'Mamoswine', nature: 'Adamant', ability: 'Oblivious', sp: { atk: 32 } })
  const def = await makeSet({ species: 'Incineroar', nature: 'Careful', ability: 'Blaze', sp: { hp: 32, def: 2 } })
  const mv = await move('Earthquake', atk.species)
  const on = damageRolls(atk, def, mv, { doubles: true, helpingHand: true })
  const off = damageRolls(atk, def, mv, { doubles: true, helpingHand: false })
  const single = damageRolls(atk, def, mv, { doubles: false })
  // notes 실측(더블 152-180, 싱글 204-240)과 산술 대조.
  if (atk.stats.atk !== 200) fail('맘모꾸리 공격 실능이 골든 200과 다르다')
  if (off.rolls[0] !== 152 || off.rolls[15] !== 180) fail('도우미 끔 더블 지진이 152-180과 다르다')
  if (single.rolls[0] !== 204 || single.rolls[15] !== 240) fail('싱글 지진이 204-240과 다르다')
  const k = koCount([on.rolls], def.stats.hp)
  return {
    id: 'e-mamoswine-earthquake-helping-hand-vs-incineroar',
    source: SOURCE,
    attacker: setRecord(atk),
    defender: setRecord(def),
    move: moveRecord(mv),
    conditions: {
      gameType: 'Doubles',
      spreadTargets: 2,
      weather: 'none',
      terrain: 'none',
      critical: false,
      helpingHand: true,
    },
    defenderHp: def.stats.hp,
    trace: on.trace,
    rolls: on.rolls,
    min: on.rolls[0],
    max: on.rolls[15],
    minPercent: pct(on.rolls[0], def.stats.hp),
    maxPercent: pct(on.rolls[15], def.stats.hp),
    koCount: k.count,
    koTotal: k.total,
    ohkoChance: k.count / k.total,
    attackBand: attackBand(k.count, k.total),
    defenseBand: defenseBand(k.count, k.total),
    reference: {
      helpingHandOff: { rolls: off.rolls, trace: off.trace },
      singles: { rolls: single.rolls, trace: single.trace },
    },
  }
}

async function caseF() {
  // 멀티스케일 망나뇽(HP 가득): 고집 맘모꾸리 공격 SP32 고드름떨구기 → 무보정 망나뇽 HP SP 32.
  const atk = await makeSet({ species: 'Mamoswine', nature: 'Adamant', ability: 'Oblivious', sp: { atk: 32 } })
  const mk = (ability) =>
    makeSet({ species: 'Dragonite', nature: 'Hardy', ability, sp: { hp: 32 } })
  const defMs = await mk('Multiscale')
  const defIf = await mk('Inner Focus')
  const mv = await move('Icicle Crash', atk.species)
  const ms = damageRolls(atk, defMs, mv, { doubles: true, defenderFullHp: true })
  const plain = damageRolls(atk, defIf, mv, { doubles: true, defenderFullHp: true })
  for (let i = 0; i < 16; i++) {
    if (ms.rolls[i] !== pokeRound(plain.rolls[i] / 2)) fail('멀티스케일 분포가 특성 없음의 반감과 다르다')
  }
  const hp = defMs.stats.hp
  const kMs = koCount([ms.rolls], hp)
  const kPlain = koCount([plain.rolls], hp)
  return {
    id: 'f-mamoswine-icicle-crash-vs-multiscale-dragonite',
    source: SOURCE,
    attacker: setRecord(atk),
    defender: setRecord(defMs),
    move: moveRecord(mv),
    conditions: {
      gameType: 'Doubles',
      weather: 'none',
      terrain: 'none',
      critical: false,
      helpingHand: false,
      defenderCurHp: 'full',
    },
    defenderHp: hp,
    multiscale: {
      rolls: ms.rolls,
      koCount: kMs.count,
      koTotal: kMs.total,
      ohkoChance: kMs.count / kMs.total,
      attackBand: attackBand(kMs.count, kMs.total),
      defenseBand: defenseBand(kMs.count, kMs.total),
    },
    withoutMultiscale: {
      ability: 'Inner Focus',
      rolls: plain.rolls,
      koCount: kPlain.count,
      koTotal: kPlain.total,
      ohkoChance: kPlain.count / kPlain.total,
      attackBand: attackBand(kPlain.count, kPlain.total),
      defenseBand: defenseBand(kPlain.count, kPlain.total),
    },
  }
}

// ---------- 출력 ----------

const doc = {
  schema: 'ev-maker/independent-golden@1',
  source: SOURCE,
  formula: {
    level: LEVEL,
    stats: 'HP = 종족값 + SP + 75; 그 외 = floor((종족값 + SP + 20) × 성격)',
    damage:
      'base = floor(floor(floor(2L/5+2)·BP·A/D)/50)+2 → 범위기(더블) pokeRound(×3072/4096) → 난수 floor(×r/100), r=85..100 → 자속 pokeRound(×6144/4096) → 상성 floor(×eff) → 최종보정 pokeRound(×M/4096), 최소 1. 도우미는 위력 보정(6144/4096). 멀티스케일은 최종보정 2048(HP 가득일 때만).',
    pokeRound: '소수부 > 0.5면 올림, 아니면 내림(.5 내림)',
    ohko: '타별 16난수 전수 조합 중 합계 ≥ HP인 개수 / 16^타수',
  },
  dataSource: {
    dex: `@pkmn/dex@${pkgVersion('@pkmn/dex')}`,
    mods: `@pkmn/mods@${pkgVersion('@pkmn/mods')} (champions)`,
  },
  cases: [await caseA(), await caseB(), await caseC(), await caseD(), await caseE(), await caseF()],
}

const text = JSON.stringify(doc, null, 2) + '\n'
if (process.argv.includes('--check')) {
  const cur = readFileSync(OUT, 'utf8')
  if (cur !== text) {
    console.error('independent.json이 생성 결과와 다르다. 다시 생성하라.')
    process.exit(1)
  }
  console.log('independent.json 재현 일치')
} else {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT}`)
}
if (process.argv.includes('--summary')) {
  for (const c of doc.cases) {
    console.log(`\n# ${c.id}`)
    if (c.cells) {
      for (const x of c.cells) {
        const r = x.rolls ? `${x.rolls[0]}-${x.rolls[15]} [${x.rolls.join(',')}]` : `${x.attackerSpeed} vs ${x.defenderSpeed}`
        console.log(
          `SP${x.sp}`,
          x.attackStat ?? x.defenderHp ?? '',
          r,
          x.koCount !== undefined ? `${x.koCount}/${x.koTotal}` : '',
          x.attackBand ?? x.defenseBand ?? x.order,
        )
      }
      console.log('boundaries', c.boundaries)
    } else {
      console.log(JSON.stringify({ ...c, attacker: c.attacker.stats, defender: c.defender.stats }))
    }
  }
}
