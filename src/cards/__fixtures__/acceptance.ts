// 테스트 전용: PRD 수용 기준 고정 입력(m-c, Bo1 2026-10 기본 메타). 앱 코드에서 import하지 않는다.
// 각 상수의 주장은 acceptance.test.ts가 코어 직접 호출로 확인한다(데이터가 바뀌면 거기서 먼저 깨진다).
import type { AttackBand, DefenseBand, PokemonSet, SpTable, SpeedOrder } from '../../core'
import type { MetaEntry } from '../../data/meta-schema'
import type { StatId } from '../../data/schema'
import { observedSpreadAssumption } from '../../meta'
import type { MetaView } from '../../meta'
import { syntheticEntry } from '../testing'

const REGULATION = 'm-c'

const sp = (patch: Partial<SpTable>): SpTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...patch })

const set = (s: Omit<PokemonSet, 'regulation' | 'sp'> & { sp: Partial<SpTable> }): PokemonSet => ({
  regulation: REGULATION,
  ...s,
  sp: sp(s.sp),
})

/** 메타 항목 id + 묶음 대표 보존 배분 키(spreads.kept의 key). */
export interface OpponentRef {
  id: string
  spread: string
}

/** 상대 카드 대표 세트 = 그 보존 배분의 관측 배분 가정(observedSpreadAssumption). */
export function opponentSet(view: MetaView, ref: OpponentRef): PokemonSet {
  const entry = view.entry(ref.id)
  if (!entry) throw new Error(`메타 항목 ${ref.id}이 없다`)
  const index = entry.spreads.kept.findIndex(([key]) => key === ref.spread)
  if (index < 0) throw new Error(`${ref.id}에 보존 배분 ${ref.spread}이 없다`)
  return observedSpreadAssumption(view, ref.id, index).set
}

export interface Boundary<C extends string = string> {
  sp: number
  from: C
  to: C
}

// ---------- F9 예시 세트(src/app/example.ts EXAMPLE_DRAFT가 풀리는 세트) ----------

/** 한카리아스 노력 H2·A32·S32(합계 66) 생명의구슬, 물리 4기. 첫 기술 지진은 내 A를 참조한다. */
export const EXAMPLE_SET: PokemonSet = set({
  species: 'garchomp',
  ability: 'roughskin',
  item: 'lifeorb',
  nature: 'hardy',
  sp: { hp: 2, atk: 32, spe: 32 },
  moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
})

/** 세 탭 모두 표시 카드가 생기는 근거(예시 세트 기준 판정이 0~32 안에서 바뀌는 매치업). */
export const F9 = {
  attack: {
    opponent: { id: 'charizardmegay', spread: 'quiet:32/0/2/32/0/0' },
    move: 'rockslide',
    boundaries: [
      { sp: 11, from: 'mid-or-lower', to: 'high-roll-ohko' },
      { sp: 17, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
    ] as Boundary<AttackBand>[],
  },
  // 방어 탭은 F3.passing, 스피드 탭은 F4.myTailwind의 상대(기본 행 0~32 판정 변화)를 쓴다.
  speed: {
    opponent: { id: 'basculegion', spread: 'adamant:2/32/0/0/0/32' },
    boundaries: [
      { sp: 8, from: 'second', to: 'tie' },
      { sp: 9, from: 'tie', to: 'first' },
    ] as Boundary<SpeedOrder>[],
  },
} as const

// ---------- F1 공격 탭 고정 입력(AC 2) ----------

export interface F1Card {
  opponent: OpponentRef
  /** 묶음 점유율(H·B 묶음, 소수 넷째 자리) */
  bundleShare: number
  current: AttackBand
  boundaries: Boundary<AttackBand>[]
  /** 경계마다 n(잔여 0 세트 / 잔여 4 세트). n = max(0, 칸 SP − 현재 SP − 잔여 예산) */
  need: { full: number[]; spare: number[] }
}

/**
 * 한카리아스 드래곤클로 1기, A12. full = H22·A12·S32(합계 66, 잔여 0), spare = H18·A12·S32(합계 62, 잔여 4).
 * 공격 탭(상위 30·기본 기준) 표시 카드 순서 그대로. 그 밖의 래더 카드는 모두 변화 없음이다.
 */
export const F1 = {
  move: 'dragonclaw',
  sweepStat: 'atk' as StatId,
  full: set({ species: 'garchomp', ability: 'roughskin', item: 'lifeorb', nature: 'hardy', sp: { hp: 22, atk: 12, spe: 32 }, moves: ['dragonclaw'] }),
  spare: set({ species: 'garchomp', ability: 'roughskin', item: 'lifeorb', nature: 'hardy', sp: { hp: 18, atk: 12, spe: 32 }, moves: ['dragonclaw'] }),
  remaining: { full: 0, spare: 4 },
  /** 점유율 최대 묶음(한카리아스 사용률 7위의 H·B 최대 묶음)이 첫 카드다 */
  cards: [
    {
      opponent: { id: 'garchomp', spread: 'adamant:2/32/0/0/0/32' },
      bundleShare: 0.415,
      current: 'mid-or-lower',
      boundaries: [
        { sp: 20, from: 'mid-or-lower', to: 'high-roll-ohko' },
        { sp: 30, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [8, 18], spare: [4, 14] },
    },
    {
      opponent: { id: 'garchomp', spread: 'adamant:6/30/1/0/0/29' },
      bundleShare: 0.0501,
      current: 'mid-or-lower',
      boundaries: [{ sp: 28, from: 'mid-or-lower', to: 'high-roll-ohko' }],
      need: { full: [16], spare: [12] },
    },
    {
      opponent: { id: 'raichumegay', spread: 'timid:2/0/0/32/0/32' },
      bundleShare: 0.0752,
      current: 'mid-or-lower',
      boundaries: [
        { sp: 17, from: 'mid-or-lower', to: 'high-roll-ohko' },
        { sp: 25, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [5, 13], spare: [1, 9] },
    },
    {
      opponent: { id: 'garchompmegaz', spread: 'modest:2/0/0/32/0/32' },
      bundleShare: 0.4452,
      current: 'high-roll-ohko',
      boundaries: [
        { sp: 6, from: 'mid-or-lower', to: 'high-roll-ohko' },
        { sp: 15, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [0, 3], spare: [0, 0] },
    },
    {
      opponent: { id: 'garchompmegaz', spread: 'modest:1/0/1/32/0/32' },
      bundleShare: 0.0629,
      current: 'high-roll-ohko',
      boundaries: [
        { sp: 7, from: 'mid-or-lower', to: 'high-roll-ohko' },
        { sp: 16, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [0, 4], spare: [0, 0] },
    },
    {
      opponent: { id: 'garchompmegaz', spread: 'modest:0/0/4/30/0/32' },
      bundleShare: 0.0606,
      current: 'high-roll-ohko',
      boundaries: [
        { sp: 12, from: 'mid-or-lower', to: 'high-roll-ohko' },
        { sp: 21, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [0, 9], spare: [0, 5] },
    },
    {
      opponent: { id: 'kommoo', spread: 'modest:2/0/0/32/0/32' },
      bundleShare: 0.157,
      current: 'mid-or-lower',
      boundaries: [{ sp: 28, from: 'mid-or-lower', to: 'high-roll-ohko' }],
      need: { full: [16], spare: [12] },
    },
  ] as F1Card[],
} as const

// ---------- F2 혼합 세트·참조가 분류와 다른 기술(AC 4) ----------

/** 메가후딘 조심 H2·C32·S32: 사이코쇼크(특수, 참조 B) + 사이코키네시스(특수, 참조 D) + 드레인펀치(물리). */
export const F2 = {
  mySet: set({
    species: 'alakazam',
    ability: 'magicguard',
    item: 'alakazite',
    mega: true,
    nature: 'modest',
    sp: { hp: 2, spa: 32, spe: 32 },
    moves: ['psyshock', 'psychic', 'drainpunch'],
  }),
  sweepStat: 'spa' as StatId,
  /** 같은 상대가 물리 카드(H·B 묶음, 사이코쇼크 행)와 특수 카드(H·D 묶음, 사이코키네시스 행)로 둘 다 표시된다 */
  opponent: 'kommoo',
  physical: {
    opponent: { id: 'kommoo', spread: 'modest:2/0/0/32/0/32' },
    move: 'psyshock',
    boundaries: [
      { sp: 15, from: 'mid-or-lower', to: 'high-roll-ohko' },
      { sp: 23, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
    ] as Boundary<AttackBand>[],
  },
  special: {
    opponent: { id: 'kommoo', spread: 'modest:27/0/0/32/0/7' },
    move: 'psychic',
    boundaries: [{ sp: 4, from: 'high-roll-ohko', to: 'guaranteed-ohko' }] as Boundary<AttackBand>[],
  },
} as const

// ---------- F3 방어 탭 극단 필터(AC 5) ----------

export interface ExtremeCase {
  opponent: OpponentRef
  move: string
  /** 내 H·(B|D) 함께 0 / 함께 32(성격 그대로, 예산 무시)의 방어 구간 */
  low: DefenseBand
  high: DefenseBand
}

/**
 * 내 세트 = EXAMPLE_SET(방어측). 상대 묶음은 그 기술 참조 공격 능력치(성격 포함) 최대 묶음, 기술은 상대 공격기 상위 5 안.
 * "둘 다 저난수 1타"는 실데이터로 만들 수 없다: 16단계 난수(85~100%)에서 1타 확률 ≤ 3/16이 두 극단 모두 성립하려면
 * H·B 0/0 → 32/32의 대미지 감소가 3% 미만이어야 하는데 실제 종족값에서는 15% 이상이다(상위 30 × 로스터 전 종 탐색 0건).
 * 그 분기는 손으로 만든 결과 맵(handPlan) 테스트로 고정한다.
 */
export const F3 = {
  mySet: EXAMPLE_SET,
  bothSurvive: {
    opponent: { id: 'sneasler', spread: 'adamant:2/32/0/0/0/32' },
    move: 'closecombat',
    low: 'guaranteed-survive',
    high: 'guaranteed-survive',
  } as ExtremeCase,
  bothMidOrHigher: {
    opponent: { id: 'floettemega', spread: 'modest:16/0/12/15/0/23' },
    move: 'moonblast',
    low: 'mid-or-higher',
    high: 'mid-or-higher',
  } as ExtremeCase,
  bothLowRoll: null,
  /** 필터를 통과해 H 행·B 행이 생기는 기술 */
  passing: {
    opponent: { id: 'garchomp', spread: 'adamant:2/32/0/0/0/32' },
    move: 'dragonclaw',
    low: 'low-roll-ohko',
    high: 'guaranteed-survive',
    hpBoundaries: [{ sp: 6, from: 'low-roll-ohko', to: 'guaranteed-survive' }] as Boundary<DefenseBand>[],
    defBoundaries: [{ sp: 3, from: 'low-roll-ohko', to: 'guaranteed-survive' }] as Boundary<DefenseBand>[],
  },
} as const

// ---------- F4 스피드 탭(AC 7) ----------

/** 내 세트 = EXAMPLE_SET(S32). 상대는 점유율 최대 S 묶음 대표. */
export const F4 = {
  mySet: EXAMPLE_SET,
  /** 구애스카프 ≥ 10%·대표 도구 스카프 아님 → 스카프 행 있음(스카프를 씌우면 0~32 전부 후공이라 변화 없음 요약으로 간다) */
  scarf: {
    opponent: { id: 'basculegion', spread: 'adamant:2/32/0/0/0/32' },
    scarfShare: 0.1464,
    item: 'focussash',
    scarfOrder: 'second' as SpeedOrder,
  },
  /** 구애스카프 < 10% → 스카프 행 없음(기본 행은 0~32 안에서 바뀐다) */
  noScarf: {
    opponent: { id: 'gholdengo', spread: 'timid:2/0/0/32/0/32' },
    scarfShare: 0.0422,
    boundaries: [
      { sp: 27, from: 'second', to: 'tie' },
      { sp: 28, from: 'tie', to: 'first' },
    ] as Boundary<SpeedOrder>[],
  },
  /** 대표 도구가 스카프 → 스카프 아닌 행(도구 = 스카프를 뺀 최다 도구) */
  nonScarf: {
    opponent: { id: 'garchomp', spread: 'adamant:2/32/0/0/0/32' },
    item: 'lifeorb',
    baseOrder: 'second' as SpeedOrder,
    boundaries: [{ sp: 32, from: 'second', to: 'tie' }] as Boundary<SpeedOrder>[],
  },
  /** 현재 S32에서 내 순풍을 켜면 후공 → 선공 */
  myTailwind: { opponent: { id: 'sneasler', spread: 'adamant:2/32/0/0/0/32' }, off: 'second' as SpeedOrder, on: 'first' as SpeedOrder },
  /** 현재 S32에서 상대 순풍을 켜면 선공 → 후공 */
  opponentTailwind: { opponent: { id: 'basculegion', spread: 'adamant:2/32/0/0/0/32' }, off: 'first' as SpeedOrder, on: 'second' as SpeedOrder },
} as const

// ---------- F5 랭크 행(AC 8) ----------

const kingambit = (ability: string, moves: string[]): PokemonSet =>
  set({ species: 'kingambit', ability, item: 'blackglasses', nature: 'adamant', sp: { hp: 32, atk: 32, spd: 2 }, moves })

/** 공격 탭 물리 카드. 위협은 내 A를 1 내리고, 오기면 반응 +2로 최종 +1. */
export const F5 = {
  threat: { opponent: 'incineroar', ability: 'intimidate', share: 0.9973 },
  /** 위협 < 10%: 사용률 37위라 상위 30 밖 — 선택 필터로 넣는다 */
  threatBelow: { opponent: 'arcaninehisui', ability: 'intimidate', share: 0.042 },
  defiant: { mySet: kingambit('defiant', ['kowtowcleave', 'suckerpunch', 'ironhead', 'lowkick']), myBoosts: { atk: 1 } },
  nonDefiant: { mySet: kingambit('supremeoverlord', ['kowtowcleave', 'suckerpunch', 'ironhead', 'lowkick']), myBoosts: { atk: -1 } },
  /** 내 칼춤 → 공격 탭 물리 카드마다 A+2 랭크 행 */
  swordsDance: { mySet: kingambit('defiant', ['kowtowcleave', 'suckerpunch', 'ironhead', 'swordsdance']), myBoosts: { atk: 2 } },
  move: 'kowtowcleave',
} as const

// ---------- F6·F10 목록 밖 타겟(AC 11) ----------

export const F6 = {
  /** Bo1·Bo3 2026-10 메타 목록 밖, 로스터에 있음 */
  outside: 'rotomwash',
  /** 메타 목록 밖 메가 폼: 프리셋은 원종 + 메가스톤 + mega: true */
  outsideMega: { rosterId: 'lucariomega', base: 'lucario', stone: 'lucarionite' },
  /** 메타 목록 안 종 → customTargetConflicts */
  conflict: 'garchomp',
} as const

/** 워시로토무 타겟 기술: 물리 1·특수 1·랭크 수단(일렉트릭네트, 상대 S−1) 1. */
export const F10 = {
  rosterId: 'rotomwash',
  moves: ['hydropump', 'poltergeist', 'electroweb'],
  physical: 'poltergeist',
  special: 'hydropump',
  rankMeans: 'electroweb',
} as const

// ---------- F7 오류 격리(AC 12) ----------

export const F7 = {
  /** 방어 탭: 잠만보 땅가르기(상위 5 안) → 그 행만 ENGINE_UNSUPPORTED(field 'move') */
  rowError: { opponent: 'snorlax', move: 'fissure', code: 'ENGINE_UNSUPPORTED', field: 'move' },
  /** 공격 탭: 따라큐 탈 → 그 상대 행 전부 ENGINE_UNSUPPORTED(field 'defender.ability'), 다른 상대는 정상 */
  opponentAbilityError: { opponent: 'mimikyu', code: 'ENGINE_UNSUPPORTED', field: 'defender.ability' },
  /** 상대 세트 해석 실패(카드 error) 합성 레시피: 어흥염 대표 세트에 배울 수 없는 기술 */
  opponentCardError: { opponent: 'incineroar', illegalMove: 'psychic', code: 'ILLEGAL_MOVE' },
  /** 내 세트 오류 */
  mySet: {
    /** 모든 탭: SP 합계 70 */
    spTotal: { set: { ...EXAMPLE_SET, sp: sp({ hp: 2, atk: 32, def: 4, spe: 32 }) }, code: 'SP_TOTAL_EXCEEDED' },
    /** 스피드 탭만: 퀵드로(행동 순서 특성) */
    speedOnly: {
      set: set({ species: 'slowbrogalar', ability: 'quickdraw', nature: 'hardy', sp: { hp: 32, atk: 32 }, moves: ['psychic'] }),
      field: 'ability',
    },
    /** 방어 탭만: 내가 방어측일 때 탈 */
    defenseOnly: {
      set: set({ species: 'mimikyu', ability: 'disguise', item: 'lifeorb', nature: 'adamant', sp: { hp: 32, atk: 32, spe: 2 }, moves: ['playrough'] }),
      attacker: { id: 'sneasler', spread: 'adamant:2/32/0/0/0/32' },
      move: 'direclaw',
      field: 'defender.ability',
    },
  },
} as const

/** 레시피: 대표 세트에 배울 수 없는 기술을 넣은 항목. */
export function withIllegalRepresentativeMove(base: MetaEntry, move: string): MetaEntry {
  const e = syntheticEntry(base, {})
  e.representative.set.moves = [move, ...e.representative.set.moves.slice(1)]
  return e
}

// ---------- F8 셸암즈·하양허브 연속기(AC 11a·12) ----------

export const F8 = {
  /** 내 기술 셸암즈 → 탭 안내(owner 'me'), 행·카드 없음 */
  myShellSideArm: set({ species: 'slowbrogalar', ability: 'regenerator', nature: 'hardy', sp: { hp: 32, spa: 32 }, moves: ['shellsidearm', 'psychic'] }),
  /** 상대 기술 셸암즈: 실제 메타 사용자 없음 → shellSideArmEntry 레시피(방어 탭 카드 머리 안내, owner 'opponent') */
  opponentShellSideArm: 'slowbrogalar',
  /**
   * 내 하양허브 + 껍질깨기 + 연속기: 껍질깨기 랭크 행(A·C·S +2, B·D 하락은 하양허브가 되돌림)에서 연속기 행만 WHITE_HERB_MULTIHIT.
   * 하락만 있는 수단(위협 등)은 하양허브가 되돌려 랭크 변화가 없으니 랭크 행 자체가 생기지 않는다.
   */
  myWhiteHerb: {
    mySet: set({ species: 'barbaracle', ability: 'toughclaws', item: 'whiteherb', nature: 'adamant', sp: { hp: 2, atk: 32, spe: 32 }, moves: ['shellsmash', 'rockblast', 'stoneedge'] }),
    means: 'shellsmash',
    multihit: 'rockblast',
    other: 'stoneedge',
  },
  /** 상대 하양허브 + 껍질깨기 + 연속기: 실제 메타에 없음 → whiteHerbShellSmashEntry 레시피(방어 탭 랭크 행 오류, 내 세트 = EXAMPLE_SET) */
  opponentWhiteHerb: { opponent: 'barbaracle', means: 'shellsmash', multihit: 'rockblast' },
} as const

/** 레시피: base의 분포를 빌려 야도란(가라르의 모습)(셸암즈 사용자) 항목을 만든다. */
export function shellSideArmEntry(base: MetaEntry): MetaEntry {
  return syntheticEntry(base, {
    id: 'slowbrogalar',
    mega: undefined,
    abilities: { regenerator: 1 },
    items: { shares: { leftovers: 1 }, keptShare: 1, excludedShare: 0 },
    moves: { shares: { shellsidearm: 0.95, psychic: 0.8, protect: 0.6 }, keptShare: 2.35, excludedShare: 0 },
    representative: {
      set: set({ species: 'slowbrogalar', ability: 'regenerator', item: 'leftovers', nature: 'hardy', sp: { hp: 32, spa: 32 }, moves: ['shellsidearm', 'psychic', 'protect'] }),
      basis: 'modal-combination',
    },
  })
}

/** 레시피: base의 분포를 빌려 하양허브·껍질깨기·록블라스트 거북손데스 항목을 만든다. */
export function whiteHerbShellSmashEntry(base: MetaEntry): MetaEntry {
  return syntheticEntry(base, {
    id: 'barbaracle',
    mega: undefined,
    abilities: { toughclaws: 1 },
    items: { shares: { whiteherb: 1 }, keptShare: 1, excludedShare: 0 },
    moves: { shares: { shellsmash: 0.95, rockblast: 0.9, stoneedge: 0.8, protect: 0.5 }, keptShare: 3.15, excludedShare: 0 },
    representative: {
      set: set({ species: 'barbaracle', ability: 'toughclaws', item: 'whiteherb', nature: 'adamant', sp: { hp: 2, atk: 32, spe: 32 }, moves: ['shellsmash', 'rockblast', 'stoneedge', 'protect'] }),
      basis: 'modal-combination',
    },
  })
}

// ---------- F11 관여 능력치 S(ADR 결정 3 개정) ----------

const archaludon = (moves: string[]): PokemonSet =>
  set({ species: 'archaludon', ability: 'stamina', item: 'leftovers', nature: 'modest', sp: { hp: 32, def: 2, spa: 32 }, moves })

/** 자이로볼(스피드 의존) 세트는 내 S를 바꾸면 대미지가 바뀌고, 러스터캐논만 쓰는 세트는 그대로다. */
export const F11 = {
  dependent: { mySet: archaludon(['gyroball', 'flashcannon']), move: 'gyroball' },
  independent: { mySet: archaludon(['flashcannon', 'dracometeor']), move: 'flashcannon' },
  opponent: { id: 'floettemega', spread: 'modest:16/0/12/15/0/23' },
  /** 비교할 내 S(32는 합계 98이라 예산 무시 평가로 본다) */
  speeds: [0, 32],
} as const
