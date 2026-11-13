// 테스트 전용: PRD 수용 기준 고정 입력(m-c, Bo1 2026-10 기본 메타). 앱 코드에서 import하지 않는다.
// 각 상수의 주장은 acceptance.test.ts가 코어 직접 호출로 확인한다(데이터가 바뀌면 거기서 먼저 깨진다).
import type { PokemonSet, RollTier, SpTable, SpeedOrder } from '../../core'
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
      { sp: 14, from: 'mid-roll-ohko', to: 'high-roll-ohko' },
      { sp: 17, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
    ] as Boundary<RollTier>[],
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
  current: RollTier
  boundaries: Boundary<RollTier>[]
  /** 경계마다 n(잔여 0 세트 / 잔여 4 세트). n = max(0, 칸 SP − 현재 SP − 잔여 예산) */
  need: { full: number[]; spare: number[] }
}

/**
 * 한카리아스 드래곤클로 1기, A12 무보정(노력). full = H22·A12·S32(합계 66, 잔여 0), spare = H18·A12·S32(합계 62, 잔여 4).
 * 공격 탭(상위 30·기본 표시 기준·고난수 기준 14/16·5단 판정) 표시 카드 순서 그대로. 그 밖의 래더 카드는 모두 변화 없음이다
 * (현재·무보정·상승(고집) 성격 스윕이 모두 같다).
 */
export const F1 = {
  move: 'dragonclaw',
  sweepStat: 'atk' as StatId,
  full: set({ species: 'garchomp', ability: 'roughskin', item: 'lifeorb', nature: 'hardy', sp: { hp: 22, atk: 12, spe: 32 }, moves: ['dragonclaw'] }),
  spare: set({ species: 'garchomp', ability: 'roughskin', item: 'lifeorb', nature: 'hardy', sp: { hp: 18, atk: 12, spe: 32 }, moves: ['dragonclaw'] }),
  remaining: { full: 0, spare: 4 },
  /** 상승 성격 변형(고집 +A −C). 무보정 변형은 현재 성격(노력) 그대로 */
  plusNature: 'adamant',
  /** 목표 대조용: 메가한카리아스 아닌 한카리아스 최대 묶음. 현재 A12 중난수1타 → 고난수1타 무보정 A27 / 상승 A11+ */
  targetCard: { opponent: { id: 'garchomp', spread: 'adamant:2/32/0/0/0/32' }, current: 'mid-roll-ohko', label: 'high-roll-ohko', neutral: 27, plus: 11 },
  /** 현재 성격(노력)으로는 0~32 전부 확정견딤인데 상승 성격이면 A23부터 저난수1타 → 노출(무보정 불가 / A23+) */
  plusOnly: { opponent: { id: 'froslassmega', spread: 'timid:2/0/0/32/0/32' }, fixed: 'guaranteed-survive', label: 'low-roll-ohko', plus: 23 },
  /** 현재·무보정·상승 모두 0~32 확정견딤 → 변화 없음 요약 */
  bothSame: { opponent: { id: 'kingambit', spread: 'brave:32/32/0/0/2/0' }, fixed: 'guaranteed-survive' },
  /** 공격 탭 표시 카드 순서(사용률 순 → 묶음 점유율 순). 5단 판정이라 확정견딤 → 저난수1타 경계가 있는 상대도 카드가 된다 */
  cards: [
    {
      opponent: { id: 'sneasler', spread: 'adamant:2/32/0/0/0/32' },
      bundleShare: 0.2286,
      current: 'guaranteed-survive',
      boundaries: [{ sp: 30, from: 'guaranteed-survive', to: 'low-roll-ohko' }],
      need: { full: [18], spare: [14] },
    },
    {
      opponent: { id: 'sneasler', spread: 'adamant:0/32/2/0/0/32' },
      bundleShare: 0.1413,
      current: 'guaranteed-survive',
      boundaries: [{ sp: 32, from: 'guaranteed-survive', to: 'low-roll-ohko' }],
      need: { full: [20], spare: [16] },
    },
    {
      opponent: { id: 'garchomp', spread: 'adamant:2/32/0/0/0/32' },
      bundleShare: 0.415,
      current: 'mid-roll-ohko',
      boundaries: [
        { sp: 1, from: 'guaranteed-survive', to: 'low-roll-ohko' },
        { sp: 4, from: 'low-roll-ohko', to: 'mid-roll-ohko' },
        { sp: 27, from: 'mid-roll-ohko', to: 'high-roll-ohko' },
        { sp: 30, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [0, 0, 15, 18], spare: [0, 0, 11, 14] },
    },
    {
      opponent: { id: 'garchomp', spread: 'brave:32/32/0/0/2/0' },
      bundleShare: 0.1774,
      current: 'guaranteed-survive',
      boundaries: [{ sp: 27, from: 'guaranteed-survive', to: 'low-roll-ohko' }],
      need: { full: [15], spare: [11] },
    },
    {
      opponent: { id: 'garchomp', spread: 'adamant:6/30/1/0/0/29' },
      bundleShare: 0.0501,
      current: 'mid-roll-ohko',
      boundaries: [
        { sp: 5, from: 'guaranteed-survive', to: 'low-roll-ohko' },
        { sp: 9, from: 'low-roll-ohko', to: 'mid-roll-ohko' },
        { sp: 32, from: 'mid-roll-ohko', to: 'high-roll-ohko' },
      ],
      need: { full: [0, 0, 20], spare: [0, 0, 16] },
    },
    {
      opponent: { id: 'froslassmega', spread: 'timid:2/0/0/32/0/32' },
      bundleShare: 0.4268,
      current: 'guaranteed-survive',
      boundaries: [],
      need: { full: [], spare: [] },
    },
    {
      opponent: { id: 'raichumegay', spread: 'timid:2/0/0/32/0/32' },
      bundleShare: 0.0752,
      current: 'mid-roll-ohko',
      boundaries: [
        { sp: 2, from: 'low-roll-ohko', to: 'mid-roll-ohko' },
        { sp: 21, from: 'mid-roll-ohko', to: 'high-roll-ohko' },
        { sp: 25, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [0, 9, 13], spare: [0, 5, 9] },
    },
    {
      opponent: { id: 'salamencemega', spread: 'timid:2/0/0/32/0/32' },
      bundleShare: 0.3215,
      current: 'guaranteed-survive',
      boundaries: [{ sp: 29, from: 'guaranteed-survive', to: 'low-roll-ohko' }],
      need: { full: [17], spare: [13] },
    },
    {
      opponent: { id: 'salamencemega', spread: 'timid:1/0/0/32/1/32' },
      bundleShare: 0.1319,
      current: 'guaranteed-survive',
      boundaries: [{ sp: 29, from: 'guaranteed-survive', to: 'low-roll-ohko' }],
      need: { full: [17], spare: [13] },
    },
    {
      opponent: { id: 'garchompmegaz', spread: 'modest:2/0/0/32/0/32' },
      bundleShare: 0.4452,
      current: 'high-roll-ohko',
      boundaries: [
        { sp: 12, from: 'mid-roll-ohko', to: 'high-roll-ohko' },
        { sp: 15, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [0, 3], spare: [0, 0] },
    },
    {
      opponent: { id: 'garchompmegaz', spread: 'modest:1/0/1/32/0/32' },
      bundleShare: 0.0629,
      current: 'mid-roll-ohko',
      boundaries: [
        { sp: 13, from: 'mid-roll-ohko', to: 'high-roll-ohko' },
        { sp: 16, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [1, 4], spare: [0, 0] },
    },
    {
      opponent: { id: 'garchompmegaz', spread: 'modest:0/0/4/30/0/32' },
      bundleShare: 0.0606,
      current: 'mid-roll-ohko',
      boundaries: [
        { sp: 18, from: 'mid-roll-ohko', to: 'high-roll-ohko' },
        { sp: 21, from: 'high-roll-ohko', to: 'guaranteed-ohko' },
      ],
      need: { full: [6, 9], spare: [2, 5] },
    },
    {
      opponent: { id: 'kommoo', spread: 'modest:27/0/0/32/0/7' },
      bundleShare: 0.3997,
      current: 'guaranteed-survive',
      boundaries: [{ sp: 32, from: 'guaranteed-survive', to: 'low-roll-ohko' }],
      need: { full: [20], spare: [16] },
    },
    {
      opponent: { id: 'kommoo', spread: 'modest:2/0/0/32/0/32' },
      bundleShare: 0.157,
      current: 'mid-roll-ohko',
      boundaries: [
        { sp: 7, from: 'guaranteed-survive', to: 'low-roll-ohko' },
        { sp: 11, from: 'low-roll-ohko', to: 'mid-roll-ohko' },
        { sp: 32, from: 'mid-roll-ohko', to: 'high-roll-ohko' },
      ],
      need: { full: [0, 0, 20], spare: [0, 0, 16] },
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
  /** 같은 상대가 물리 카드(H·B 묶음)와 특수 카드(H·D 묶음)로 계획된다(사이코쇼크는 물리 카드, 사이코키네시스는 특수 카드 행) */
  opponent: 'kommoo',
  /** 물리 카드에 사이코쇼크 행이 남는 상대(사이코쇼크가 세 기술 중 가장 셈) */
  physical: {
    opponent: { id: 'froslassmega', spread: 'timid:2/0/0/32/0/32' },
    move: 'psyshock',
    boundaries: [{ sp: 29, from: 'guaranteed-survive', to: 'low-roll-ohko' }] as Boundary<RollTier>[],
  },
  /**
   * 분류를 가로지른 가장 센 기술(사용자 피드백 2026-11-11): 짜랑고우거 물리 카드 대표 세트에는 사이코키네시스가 무투자 확정1타라
   * 그 물리 카드의 사이코쇼크 행(현재 C32 mid-roll-ohko)이 빠지고 카드가 목록에서 사라진다.
   */
  crossDropped: {
    opponent: { id: 'kommoo', spread: 'modest:2/0/0/32/0/32' },
    move: 'psyshock',
    stronger: 'psychic',
  },
  special: {
    opponent: { id: 'kommoo', spread: 'modest:27/0/0/32/0/7' },
    move: 'psychic',
    boundaries: [{ sp: 4, from: 'high-roll-ohko', to: 'guaranteed-ohko' }] as Boundary<RollTier>[],
  },
} as const

// ---------- F3 방어 탭 극단 필터(AC 5) ----------

export interface ExtremeCase {
  opponent: OpponentRef
  move: string
  /** 내 H·(B|D) 함께 0·무보정 / 함께 32·B(D) 상승 성격(예산 무시)의 5단 판정 */
  low: RollTier
  high: RollTier
}

/**
 * 내 세트 = EXAMPLE_SET(방어측, 노력 = 무보정). 극단 필터 상승 변형은 B → 장난꾸러기(impish, +B −C), D → 신중(careful, +D −C).
 * 상대 묶음은 그 기술 참조 공격 능력치(성격 포함) 최대 묶음, 기술은 상대 방어 탭 기본 후보(사용률 5%·나에게 1배 이상) 안.
 * "둘 다 저난수 1타"는 실데이터로 만들 수 없다: 1타 확률 ≤ 2/16이 두 극단 모두 성립하려면 H·B 0/0·무보정 → 32/32·상승의 대미지 감소가
 * 3% 미만이어야 하는데 실제 종족값에서는 15% 이상이다(상위 30 × 당시 후보 규칙 공격기 상위 5 × 보존 배분 전수 탐색 0건, __fixtures__/acceptance.test.ts).
 * 그 분기는 손으로 만든 결과 맵(handPlan) 테스트로 고정한다.
 */
export const F3 = {
  mySet: EXAMPLE_SET,
  plusNature: { def: 'impish', spd: 'careful' },
  bothSurvive: {
    opponent: { id: 'sneasler', spread: 'adamant:2/32/0/0/0/32' },
    move: 'closecombat',
    low: 'guaranteed-survive',
    high: 'guaranteed-survive',
  } as ExtremeCase,
  /** 두 극단 모두 확정1타(상승 성격으로도 못 버팀) */
  bothOhko: {
    opponent: { id: 'floettemega', spread: 'modest:16/0/12/15/0/23' },
    move: 'lightofruin',
    low: 'guaranteed-ohko',
    high: 'guaranteed-ohko',
  } as ExtremeCase,
  bothLowRoll: null,
  /**
   * 현재 성격(노력) 두 극단은 모두 확정1타라 같지만, D 상승(신중) H32·D32는 중난수1타라 필터를 통과한다.
   * 2026-11-11부터 같은 카드에서 파멸의빛(lightofruin)이 더 세서(둘 다 확정1타, 최대 대미지 비율이 큼) 이 기술은 행이 없다(F12.maxPercentTie).
   */
  plusOnly: {
    opponent: { id: 'floettemega', spread: 'modest:16/0/12/15/0/23' },
    move: 'moonblast',
    low: 'guaranteed-ohko',
    high: 'mid-roll-ohko',
    currentHigh: 'guaranteed-ohko',
  } as ExtremeCase & { currentHigh: RollTier },
  /** plusOnly와 같은 성질이고 그 카드·조건에서 가장 센 기술이라 필터를 거쳐 H 행·D 행이 생긴다(2026-11-11) */
  plusOnlyStrongest: {
    opponent: { id: 'dragonitemega', spread: 'modest:25/0/0/32/0/9' },
    move: 'dracometeor',
    low: 'guaranteed-ohko',
    high: 'high-roll-ohko',
    currentHigh: 'guaranteed-ohko',
  } as ExtremeCase & { currentHigh: RollTier },
  /** 필터를 통과해 H 행·B 행이 생기는 기술 */
  passing: {
    opponent: { id: 'garchomp', spread: 'adamant:2/32/0/0/0/32' },
    move: 'dragonclaw',
    low: 'low-roll-ohko',
    high: 'guaranteed-survive',
    hpBoundaries: [{ sp: 6, from: 'low-roll-ohko', to: 'guaranteed-survive' }] as Boundary<RollTier>[],
    defBoundaries: [{ sp: 3, from: 'low-roll-ohko', to: 'guaranteed-survive' }] as Boundary<RollTier>[],
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
  /** 방어 탭: 잠만보 땅가르기(기본 후보 안) → 그 행만 ENGINE_UNSUPPORTED(field 'move') */
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

// ---------- F12 카드·조건당 가장 센 기술 하나 + 선공기(사용자 피드백 2026-11-11) ----------

/**
 * 현재 세트(현재 SP·성격) 단건 판정의 1타 확률 → 최대 대미지 비율 → 슬롯(방어 탭은 상대 사용률) 순으로 고른다.
 * ohko·maxPercent는 코어 judgeDamage(rollSteps 14) 값(maxPercent 소수 한 자리 반올림 비교).
 */
export const F12 = {
  /** 예시 세트 공격 탭 포푸니크: 분함의발구르기가 무투자 확정1타라 드래곤클로 등은 행이 없고, 남은 행도 변화 없음이라 카드가 빠진다 */
  sneasler: {
    mySet: EXAMPLE_SET,
    opponent: { id: 'sneasler', spread: 'adamant:2/32/0/0/0/32' },
    chosen: 'stompingtantrum',
    dropped: ['earthquake', 'dragonclaw', 'rockslide'],
    probe: {
      stompingtantrum: { ohko: 1, maxPercent: 190.4 },
      earthquake: { ohko: 1, maxPercent: 188.5 },
      dragonclaw: { ohko: 0.125, maxPercent: 101.9 },
      rockslide: { ohko: 0, maxPercent: 24.2 },
    },
  },
  /** 1타 확률·최대 대미지 비율이 모두 같으면 슬롯이 앞선 지진 */
  slotTie: {
    mySet: EXAMPLE_SET,
    opponent: { id: 'sneasler', spread: 'brave:29/32/5/0/0/0' },
    chosen: 'earthquake',
    tiedWith: 'stompingtantrum',
    probe: { ohko: 1, maxPercent: 152.7 },
  },
  /** 방어 탭: 1타 확률이 같으면(둘 다 확정1타) 최대 대미지 비율이 큰 파멸의빛 */
  maxPercentTie: {
    mySet: EXAMPLE_SET,
    opponent: { id: 'floettemega', spread: 'modest:16/0/12/15/0/23' },
    chosen: 'lightofruin',
    over: 'moonblast',
    probe: { lightofruin: { ohko: 1, maxPercent: 265.9 }, moonblast: { ohko: 1, maxPercent: 181.6 } },
  },
  /** 공격 탭 선공기: 기습은 더 약해도 남는다(가장 센 기술 = 도각참). 선공기가 무효면(키키링 테일아머) 남지 않는다 */
  priority: {
    mySet: F5.swordsDance.mySet,
    opponent: { id: 'indeedeef', spread: 'bold:32/0/32/0/2/0' },
    chosen: 'kowtowcleave',
    kept: 'suckerpunch',
    dropped: ['ironhead'],
    probe: { kowtowcleave: { ohko: 1, maxPercent: 123.2 }, suckerpunch: { ohko: 0.125, maxPercent: 102.8 } },
    immune: { opponent: { id: 'farigiraf', spread: 'quiet:10/0/13/30/13/0' }, move: 'suckerpunch' },
  },
  /** 방어 탭: 상대 기본 후보 중 나에게 가장 센 기술(도각참)과 선공기(기습)만 */
  defense: {
    mySet: EXAMPLE_SET,
    opponent: { id: 'kingambit', spread: 'brave:32/32/0/0/2/0' },
    chosen: 'kowtowcleave',
    kept: 'suckerpunch',
    dropped: ['ironhead', 'lowkick'],
    probe: { kowtowcleave: { ohko: 0, maxPercent: 55.1 }, ironhead: { ohko: 0, maxPercent: 51.9 } },
  },
  /**
   * SP를 바꾸면 가장 센 기술이 분류를 넘어 바뀐다: 메가후딘 C32면 사이코키네시스(특수 카드 행, 물리 카드는 빠짐),
   * C의 32를 A로 옮기면 드레인펀치(물리 카드 행, 특수 카드는 빠짐). 같은 대표 배분이 두 분류 카드에 다 있다.
   */
  spSwitch: {
    mySet: F2.mySet,
    moved: { ...F2.mySet, sp: { ...F2.mySet.sp, atk: 32, spa: 0 } } as PokemonSet,
    opponent: { id: 'excadrill', spread: 'adamant:2/32/0/0/0/32' },
    special: { chosen: 'psychic', probe: { psyshock: 44.4, psychic: 47.1, drainpunch: 28.9 } },
    physical: { chosen: 'drainpunch', probe: { psyshock: 38.5, psychic: 40.1, drainpunch: 41.7 } },
  },
} as const
