// 테스트 전용: AC7b 기존 스피드 목표 문구(target.ts "한 단계 위" 규칙) 결과 고정표. 앱 코드에서 import하지 않는다.
// 값은 기존 경로 planTab(input, 'speed') → computeRowTask → assembleTab(singleTarget·cellLabel) → targetText로 낸 것이다.
// 입력은 메타 없이 재현되도록 그 행의 확정 세트(내 세트 = 계획 시점 SP, 상대 = 도구 변형까지 적용)를 그대로 담는다.
import type { PokemonSet, SpeedOrder } from '../../core'

export type LegacyClassification = '추월 목표 비교 대상' | '규칙 변경으로 결과 다름'

export type LegacyAspect = '양쪽 불가' | '무보정만 불가' | '동속 경계' | '내 순풍 켬' | '내 스카프' | '상대 스카프 조건' | '예산 초과' | '현재 유지'

/** 기존 목표 선택지: 그 최소 SP의 실제 판정, SP, 다른 능력치에서 빼야 할 SP(0 = 예산 안) */
export interface LegacyOption {
  label: SpeedOrder
  sp: number
  need: number
}

export interface SpeedMinSpLegacyCase {
  id: string
  covers: readonly LegacyAspect[]
  /** 생성 당시 메타(Bo1 m-c 기본) 카드 출처. 재현에는 쓰지 않는다 */
  source: { opponent: string; bundle: string; rowKind: 'base' | 'scarf' }
  mySet: PokemonSet
  opponentSet: PokemonSet
  myTailwind: boolean
  /** 기존 행의 성격 변형(무보정·상승 S) */
  natures: { neutral: string; plus: string }
  /** 잔여 SP 예산 = 규칙 합계 66 − mySet SP 합 */
  remaining: number
  legacy: {
    current: { sp: number; order: SpeedOrder }
    /** true면 기존 행에 목표 문구가 없었다(text·goal·선택지 null) */
    noChange: boolean
    text: string | null
    goal: 'better' | 'keep' | null
    /** null = 그 변형 "불가"(또는 목표 문구 없음) */
    neutral: LegacyOption | null
    plus: LegacyOption | null
  }
  /** 추월 목표 비교 대상: goal better이고 null 아닌 선택지 라벨이 모두 first(또는 목표 없음 + 전 칸 후공). 그 밖(동속 목표·현재 유지)은 규칙 변경 */
  classification: LegacyClassification
  reason: string
}

export const SPEED_MIN_SP_LEGACY: readonly SpeedMinSpLegacyCase[] = [
  {
    id: 'both-impossible',
    covers: ['양쪽 불가'],
    source: {
      opponent: 'sneasler',
      bundle: '[{"stat":"spe","sp":32,"nature":"neutral"}]',
      rowKind: 'base',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'lifeorb',
      nature: 'hardy',
      sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'sneasler',
      ability: 'unburden',
      item: 'whiteherb',
      nature: 'adamant',
      sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      moves: ['closecombat', 'direclaw', 'fakeout', 'protect'],
    },
    myTailwind: false,
    natures: { neutral: 'hardy', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 32, order: 'second' },
      noChange: true,
      text: null,
      goal: null,
      neutral: null,
      plus: null,
    },
    classification: '추월 목표 비교 대상',
    reason: '기존 행이 변화 없음(무보정·상승 0~32 전부 후공)이라 목표 문구가 없었다. 어느 변형도 동속조차 닿지 않으므로 엄격 추월도 양쪽 불가다.',
  },
  {
    id: 'neutral-impossible',
    covers: ['무보정만 불가'],
    source: {
      opponent: 'floettemega',
      bundle: '[{"stat":"spe","sp":32,"nature":"neutral"}]',
      rowKind: 'base',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'lifeorb',
      nature: 'hardy',
      sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'floetteeternal',
      ability: 'flowerveil',
      item: 'floettite',
      nature: 'modest',
      sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
      moves: ['protect', 'dazzlinggleam', 'moonblast', 'calmmind'],
      mega: true,
    },
    myTailwind: false,
    natures: { neutral: 'hardy', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 32, order: 'tie' },
      noChange: false,
      text: '선공: 무보정 불가 / S19+',
      goal: 'better',
      neutral: null,
      plus: { label: 'first', sp: 19, need: 0 },
    },
    classification: '추월 목표 비교 대상',
    reason: '현재 동속이라 한 단계 위 = 선공이고, 상승 선택지 라벨이 선공이다. 무보정은 S32에서도 동속이라 추월 불가다.',
  },
  {
    id: 'tie-boundary-outspeed',
    covers: ['동속 경계'],
    source: {
      opponent: 'gholdengo',
      bundle: '[{"stat":"spe","sp":32,"nature":"neutral"}]',
      rowKind: 'base',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'lifeorb',
      nature: 'hardy',
      sp: { hp: 20, atk: 32, def: 0, spa: 0, spd: 0, spe: 14 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'gholdengo',
      ability: 'goodasgold',
      item: 'lifeorb',
      nature: 'modest',
      sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
      moves: ['makeitrain', 'shadowball', 'protect', 'nastyplot'],
    },
    myTailwind: false,
    natures: { neutral: 'hardy', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 14, order: 'tie' },
      noChange: false,
      text: '선공: 최소 S15 (다른 능력치에서 1 필요) / S3+',
      goal: 'better',
      neutral: { label: 'first', sp: 15, need: 1 },
      plus: { label: 'first', sp: 3, need: 0 },
    },
    classification: '추월 목표 비교 대상',
    reason: '현재 S14가 동속 칸이고 한 단계 위 = 선공이다. 두 선택지 라벨이 모두 선공이라 S15·S3+가 곧 엄격 추월 최소 S다(S14 동속은 추월 아님).',
  },
  {
    id: 'tie-boundary-tie-goal',
    covers: ['동속 경계'],
    source: {
      opponent: 'gholdengo',
      bundle: '[{"stat":"spe","sp":32,"nature":"plus"}]',
      rowKind: 'base',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'lifeorb',
      nature: 'hardy',
      sp: { hp: 18, atk: 32, def: 0, spa: 0, spd: 0, spe: 16 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'gholdengo',
      ability: 'goodasgold',
      item: 'lifeorb',
      nature: 'timid',
      sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
      moves: ['makeitrain', 'shadowball', 'protect', 'nastyplot'],
    },
    myTailwind: false,
    natures: { neutral: 'hardy', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 16, order: 'second' },
      noChange: false,
      text: '동속: 최소 S27 (다른 능력치에서 11 필요) / S14+',
      goal: 'better',
      neutral: { label: 'tie', sp: 27, need: 11 },
      plus: { label: 'tie', sp: 14, need: 0 },
    },
    classification: '규칙 변경으로 결과 다름',
    reason: '현재 후공이라 기존 목표는 한 단계 위인 동속이고 두 선택지 라벨이 모두 동속이다. 새 규칙은 동속을 추월로 치지 않으므로 값이 다르다.',
  },
  {
    id: 'my-tailwind',
    covers: ['내 순풍 켬'],
    source: {
      opponent: 'garchomp',
      bundle: '[{"stat":"spe","sp":32,"nature":"plus"}]',
      rowKind: 'base',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'lifeorb',
      nature: 'brave',
      sp: { hp: 28, atk: 32, def: 0, spa: 0, spd: 0, spe: 6 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'choicescarf',
      nature: 'jolly',
      sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      moves: ['dragonclaw', 'rockslide', 'stompingtantrum', 'earthquake'],
    },
    myTailwind: true,
    natures: { neutral: 'bashful', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 6, order: 'second' },
      noChange: false,
      text: '선공: 최소 S5 / S0+',
      goal: 'better',
      neutral: { label: 'first', sp: 5, need: 0 },
      plus: { label: 'first', sp: 0, need: 0 },
    },
    classification: '추월 목표 비교 대상',
    reason: '내 순풍을 켠 행에서 현재 후공, 동속 칸 없이 선공으로 바로 넘어가 두 선택지 라벨이 모두 선공이다.',
  },
  {
    id: 'my-scarf',
    covers: ['내 스카프'],
    source: {
      opponent: 'raichumegay',
      bundle: '[{"stat":"spe","sp":32,"nature":"plus"}]',
      rowKind: 'base',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'choicescarf',
      nature: 'brave',
      sp: { hp: 20, atk: 32, def: 0, spa: 0, spd: 0, spe: 14 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'raichu',
      ability: 'static',
      item: 'raichunitey',
      nature: 'timid',
      sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
      moves: ['zapcannon', 'protect', 'focusblast', 'fakeout'],
      mega: true,
    },
    myTailwind: false,
    natures: { neutral: 'bashful', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 14, order: 'second' },
      noChange: false,
      text: '선공: 최소 S12 / S0+',
      goal: 'better',
      neutral: { label: 'first', sp: 12, need: 0 },
      plus: { label: 'first', sp: 0, need: 0 },
    },
    classification: '추월 목표 비교 대상',
    reason: '내 도구가 구애스카프인 행에서 현재 후공, 두 선택지 라벨이 모두 선공이다.',
  },
  {
    id: 'opponent-scarf-tie-goal',
    covers: ['상대 스카프 조건'],
    source: {
      opponent: 'basculegion',
      bundle: '[{"stat":"spe","sp":32,"nature":"neutral"}]',
      rowKind: 'scarf',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'choicescarf',
      nature: 'brave',
      sp: { hp: 24, atk: 32, def: 0, spa: 0, spd: 0, spe: 10 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'basculegion',
      ability: 'adaptability',
      item: 'choicescarf',
      nature: 'adamant',
      sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      moves: ['lastrespects', 'aquajet', 'wavecrash', 'protect'],
    },
    myTailwind: false,
    natures: { neutral: 'bashful', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 10, order: 'second' },
      noChange: false,
      text: '동속: 최소 S8 / S0+',
      goal: 'better',
      neutral: { label: 'tie', sp: 8, need: 0 },
      plus: { label: 'first', sp: 0, need: 0 },
    },
    classification: '규칙 변경으로 결과 다름',
    reason:
      '상대 스카프 행(kind scarf)에서 현재 후공이라 목표가 동속이고 무보정 선택지 라벨이 동속(S8)이다. 상승 쪽만 선공 라벨이지만 사례 전체를 규칙 변경으로 둔다.',
  },
  {
    id: 'over-budget',
    covers: ['예산 초과'],
    source: {
      opponent: 'garchompmegaz',
      bundle: '[{"stat":"spe","sp":32,"nature":"neutral"}]',
      rowKind: 'base',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'choicescarf',
      nature: 'hardy',
      sp: { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'sandveil',
      item: 'garchompitez',
      nature: 'modest',
      sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
      moves: ['protect', 'powergem', 'earthpower', 'dragonpulse'],
      mega: true,
    },
    myTailwind: false,
    natures: { neutral: 'hardy', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 0, order: 'second' },
      noChange: false,
      text: '선공: 최소 S14 (다른 능력치에서 14 필요) / S2+ (다른 능력치에서 2 필요)',
      goal: 'better',
      neutral: { label: 'first', sp: 14, need: 14 },
      plus: { label: 'first', sp: 2, need: 2 },
    },
    classification: '추월 목표 비교 대상',
    reason: '현재 후공에서 두 선택지 라벨이 모두 선공이고, 잔여 예산이 0이라 need = 그 SP − 현재 S0이 붙는다. 새 표시는 같은 S에 예산 초과 표지를 붙인다.',
  },
  {
    id: 'keep-first',
    covers: ['현재 유지'],
    source: {
      opponent: 'basculegion',
      bundle: '[{"stat":"spe","sp":32,"nature":"neutral"}]',
      rowKind: 'base',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'lifeorb',
      nature: 'hardy',
      sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'basculegion',
      ability: 'adaptability',
      item: 'focussash',
      nature: 'adamant',
      sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      moves: ['lastrespects', 'aquajet', 'wavecrash', 'protect'],
    },
    myTailwind: false,
    natures: { neutral: 'hardy', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 32, order: 'first' },
      noChange: false,
      text: '선공: 최소 S9 / S0+',
      goal: 'keep',
      neutral: { label: 'first', sp: 9, need: 0 },
      plus: { label: 'first', sp: 0, need: 0 },
    },
    classification: '규칙 변경으로 결과 다름',
    reason: '현재 이미 선공이라 기존 목표는 현재 유지(goal keep)다. ADR 결정 2에 따라 일치 판정에서 뺀다.',
  },
  {
    id: 'opponent-scarf-keep',
    covers: ['상대 스카프 조건', '내 스카프', '현재 유지'],
    source: {
      opponent: 'basculegion',
      bundle: '[{"stat":"spe","sp":32,"nature":"neutral"}]',
      rowKind: 'scarf',
    },
    mySet: {
      regulation: 'm-c',
      species: 'garchomp',
      ability: 'roughskin',
      item: 'choicescarf',
      nature: 'hardy',
      sp: { hp: 24, atk: 32, def: 0, spa: 0, spd: 0, spe: 10 },
      moves: ['earthquake', 'dragonclaw', 'rockslide', 'stompingtantrum'],
    },
    opponentSet: {
      regulation: 'm-c',
      species: 'basculegion',
      ability: 'adaptability',
      item: 'choicescarf',
      nature: 'adamant',
      sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      moves: ['lastrespects', 'aquajet', 'wavecrash', 'protect'],
    },
    myTailwind: false,
    natures: { neutral: 'hardy', plus: 'jolly' },
    remaining: 0,
    legacy: {
      current: { sp: 10, order: 'first' },
      noChange: false,
      text: '선공: 최소 S9 / S0+',
      goal: 'keep',
      neutral: { label: 'first', sp: 9, need: 0 },
      plus: { label: 'first', sp: 0, need: 0 },
    },
    classification: '규칙 변경으로 결과 다름',
    reason: '상대 스카프 행에서 현재 이미 선공이라 기존 목표는 현재 유지(goal keep)다. ADR 결정 2에 따라 일치 판정에서 뺀다.',
  },
]
