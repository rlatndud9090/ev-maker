import { Dex } from '@pkmn/dex'
import { describe, expect, it } from 'vitest'
import { validateSet, type BoostTable, type PokemonSet, type ResolvedSet } from '../core'
import {
  BOOST_STATS,
  FIRST_TURN_ONLY_MOVES,
  RANK_MEANS,
  RANK_MEANS_EXCLUDED,
  REACTIONS,
  applyMeans,
  isActiveMeans,
  myMeansNotes,
  setMeans,
  usableAfterMeans,
} from './rankMeans'
import { realData } from './testing'

const { game } = realData()
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

const set = (species: string, ability: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  regulation: 'm-c',
  species,
  ability,
  nature: 'hardy',
  sp: { ...ZERO },
  moves,
  ...extra,
})
const resolved = (s: PokemonSet): ResolvedSet => validateSet(game, s)
/** 반응 규칙만 보는 테스트용: 계산 특성·도구만 바꾼 해석 결과 */
const holder = (ability: string, item?: string): ResolvedSet => ({ ...resolved(set('garchomp', 'roughskin', [])), ability, item })

const incineroar = resolved(set('incineroar', 'intimidate', ['partingshot']))
const garchomp = resolved(set('garchomp', 'roughskin', ['swordsdance']))
const intimidate = { kind: 'ability', id: 'intimidate' } as const

describe('수단·반응 데이터 상수', () => {
  it('모든 id가 스냅샷에 있다', () => {
    for (const m of RANK_MEANS) {
      const table = m.kind === 'move' ? game.data.moves : game.data.abilities
      expect(Object.hasOwn(table, m.id), `${m.kind} ${m.id}`).toBe(true)
    }
    for (const r of REACTIONS) {
      const table = r.kind === 'item' ? game.data.items : game.data.abilities
      expect(Object.hasOwn(table, r.id), `${r.kind} ${r.id}`).toBe(true)
    }
  })

  it('수단 (kind, id)는 중복되지 않는다', () => {
    const keys = RANK_MEANS.map((m) => `${m.kind}:${m.id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('확률 부가효과(문포스)·엔진 자체 상승(메테오빔)·순풍은 수단이 아니다', () => {
    const ids = RANK_MEANS.map((m) => m.id)
    for (const id of ['moonblast', 'meteorbeam', 'electroshot', 'tailwind']) expect(ids).not.toContain(id)
    expect(Object.keys(RANK_MEANS_EXCLUDED).sort()).toEqual(['electroshot', 'meteorbeam'])
  })

  it('목록 고정: 스냅샷 기술 중 무조건 자기 랭크를 올리는 기술은 전부 self 수단(같은 변화량)이거나 명시 제외다', () => {
    const dex = Dex.forGen(9)
    const pick = (b: Partial<Record<string, number>> | undefined): BoostTable => {
      const out: BoostTable = {}
      for (const s of BOOST_STATS) if (b?.[s]) out[s] = b[s]
      return out
    }
    const selfBoosts = (id: string): BoostTable | null => {
      const mv = dex.moves.get(id)
      const raw =
        (mv.target === 'self' ? mv.boosts : undefined) ??
        mv.self?.boosts ??
        (mv.secondaries ?? []).find((s) => s.chance === 100 && s.self?.boosts)?.self?.boosts
      const b = pick(raw ?? undefined)
      return BOOST_STATS.some((s) => (b[s] ?? 0) > 0) ? b : null
    }
    const found = Object.keys(game.data.moves).filter((id) => selfBoosts(id) !== null)
    // Showdown 데이터 구조(boosts·self.boosts·100% 부가효과)로 잡히는 기술이 실제로 여럿이다(빈 검사 방지)
    expect(found.length).toBeGreaterThan(20)
    for (const id of found) {
      if (Object.hasOwn(RANK_MEANS_EXCLUDED, id)) continue
      const def = RANK_MEANS.find((m) => m.kind === 'move' && m.id === id)
      expect(def?.target, id).toBe('self')
      expect(def?.boosts, id).toEqual(selfBoosts(id))
    }
    // 구조로 잡히지 않는(onHit·다단 뒤 등) 자기 랭크업 기술도 목록에 있다
    for (const id of ['scaleshot', 'stockpile', 'bellydrum', 'tidyup', 'curse']) {
      expect(Object.hasOwn(game.data.moves, id), id).toBe(true)
      expect(isActiveMeans({ kind: 'move', id }), id).toBe(true)
    }
  })
})

describe('능동 수단 분류', () => {
  it('자기 자신에게 거는 랭크업 변화기·자기 강화 공격기·가속은 능동, 상대에게 거는 하락(위협·막말내뱉기·애교·얼어붙은바람)은 아니다', () => {
    for (const id of ['swordsdance', 'dragondance', 'nastyplot', 'calmmind', 'irondefense', 'bulkup', 'agility', 'shellsmash', 'flamecharge']) {
      expect(isActiveMeans({ kind: 'move', id }), id).toBe(true)
    }
    expect(isActiveMeans({ kind: 'ability', id: 'speedboost' })).toBe(true)
    for (const id of ['partingshot', 'charm', 'icywind', 'snarl', 'screech']) expect(isActiveMeans({ kind: 'move', id }), id).toBe(false)
    expect(isActiveMeans({ kind: 'ability', id: 'intimidate' })).toBe(false)
  })

  it('반응 특성(오기·승기)과 목록 밖 기술은 수단이 아니다', () => {
    for (const id of ['defiant', 'competitive']) expect(isActiveMeans({ kind: 'ability', id })).toBe(false)
    expect(isActiveMeans({ kind: 'move', id: 'moonblast' })).toBe(false)
  })

  it('능동 수단 = 목록에서 target self인 것 전부', () => {
    expect(RANK_MEANS.filter((m) => isActiveMeans(m)).every((m) => m.target === 'self')).toBe(true)
    expect(RANK_MEANS.filter((m) => m.target === 'self').every((m) => isActiveMeans(m))).toBe(true)
  })

  it('setMeans는 세트의 능동 수단만(위협·막말내뱉기 제외)', () => {
    expect(setMeans(resolved(set('incineroar', 'intimidate', ['partingshot', 'bulkup', 'flareblitz'])))).toEqual([{ kind: 'move', id: 'bulkup' }])
  })
})

describe('첫 턴 전용 기술', () => {
  it('목록의 기술은 스냅샷에 있는 공격기다', () => {
    for (const id of FIRST_TURN_ONLY_MOVES) {
      expect(Object.hasOwn(game.data.moves, id), id).toBe(true)
      expect(game.data.moves[id].category).not.toBe('Status')
    }
    expect([...FIRST_TURN_ONLY_MOVES].sort()).toEqual(['fakeout', 'firstimpression'])
  })

  it('기술 수단 뒤에는 쓸 수 없고, 특성 수단과는 양립한다', () => {
    expect(usableAfterMeans({ kind: 'move', id: 'swordsdance' }, 'firstimpression')).toBe(false)
    expect(usableAfterMeans({ kind: 'move', id: 'swordsdance' }, 'fakeout')).toBe(false)
    expect(usableAfterMeans({ kind: 'move', id: 'swordsdance' }, 'leechlife')).toBe(true)
    expect(usableAfterMeans({ kind: 'ability', id: 'speedboost' }, 'firstimpression')).toBe(true)
  })
})

describe('applyMeans (Showdown 기준)', () => {
  it('위협 × 반응 없음 = 상대 A−1', () => {
    expect(applyMeans(game, intimidate, incineroar, garchomp)).toEqual({
      userBoosts: {},
      targetBoosts: { atk: -1 },
      reactions: [],
      whiteHerbConsumed: false,
    })
  })

  it('위협 × 오기 = A+1, 위협 × 승기 = A−1·C+2', () => {
    expect(applyMeans(game, intimidate, incineroar, holder('defiant'))).toMatchObject({ targetBoosts: { atk: 1 }, reactions: ['defiant'] })
    expect(applyMeans(game, intimidate, incineroar, holder('competitive'))).toMatchObject({
      targetBoosts: { atk: -1, spa: 2 },
      reactions: ['competitive'],
    })
  })

  it('막말내뱉기(A−1·C−1) × 오기는 수단당 1회만 A+2', () => {
    const r = applyMeans(game, { kind: 'move', id: 'partingshot' }, incineroar, holder('defiant'))
    expect(r?.targetBoosts).toEqual({ atk: 1, spa: -1 })
  })

  it('차단: 위협 × 클리어바디·하얀연기·미러아머 = 효과 없음(null)', () => {
    for (const a of ['clearbody', 'whitesmoke', 'mirrorarmor']) expect(applyMeans(game, intimidate, incineroar, holder(a))).toBeNull()
  })

  it('괴력집게는 A 하락만, 부풀린가슴은 B 하락만 막는다', () => {
    const ps = applyMeans(game, { kind: 'move', id: 'partingshot' }, incineroar, holder('hypercutter'))
    expect(ps).toMatchObject({ targetBoosts: { spa: -1 }, reactions: ['hypercutter'] })
    expect(applyMeans(game, { kind: 'move', id: 'screech' }, incineroar, holder('bigpecks'))).toBeNull()
    expect(applyMeans(game, { kind: 'move', id: 'screech' }, incineroar, holder('hypercutter'))?.targetBoosts).toEqual({ def: -2 })
  })

  it('정신력·마이페이스·둔감·배짱은 위협만 막는다', () => {
    for (const a of ['innerfocus', 'owntempo', 'oblivious', 'scrappy']) {
      expect(applyMeans(game, intimidate, incineroar, holder(a))).toBeNull()
      expect(applyMeans(game, { kind: 'move', id: 'charm' }, incineroar, holder(a))?.targetBoosts).toEqual({ atk: -2 })
    }
  })

  it('위협 × 파수견 = A+1, 위협 × 주눅 = A−1·S+1', () => {
    expect(applyMeans(game, intimidate, incineroar, holder('guarddog'))).toMatchObject({ targetBoosts: { atk: 1 }, reactions: ['guarddog'] })
    expect(applyMeans(game, intimidate, incineroar, holder('rattled'))).toMatchObject({ targetBoosts: { atk: -1, spe: 1 }, reactions: ['rattled'] })
  })

  it('심술꾸러기: 칼춤 = A−2(자기 기술 포함), 위협 = A+1(오기 없음)', () => {
    expect(applyMeans(game, { kind: 'move', id: 'swordsdance' }, holder('contrary'), garchomp)).toMatchObject({
      userBoosts: { atk: -2 },
      targetBoosts: {},
      reactions: ['contrary'],
    })
    expect(applyMeans(game, intimidate, incineroar, holder('contrary'))?.targetBoosts).toEqual({ atk: 1 })
  })

  it('껍질깨기 × 하양허브 = B·D 0, A·C·S +2, 소비', () => {
    expect(applyMeans(game, { kind: 'move', id: 'shellsmash' }, holder('toughclaws', 'whiteherb'), garchomp)).toEqual({
      userBoosts: { atk: 2, spa: 2, spe: 2 },
      targetBoosts: {},
      reactions: ['whiteherb'],
      whiteHerbConsumed: true,
    })
  })

  it('위협 × 하양허브 = 되돌려져 효과 없음, 위협 × 주눅 + 하양허브 = S+1만', () => {
    expect(applyMeans(game, intimidate, incineroar, holder('roughskin', 'whiteherb'))).toBeNull()
    expect(applyMeans(game, intimidate, incineroar, holder('rattled', 'whiteherb'))).toMatchObject({
      targetBoosts: { spe: 1 },
      reactions: ['rattled', 'whiteherb'],
      whiteHerbConsumed: true,
    })
  })

  it('자기 기술의 자기 하락은 오기·승기를 부르지 않고 차단 특성도 막지 않는다', () => {
    expect(applyMeans(game, { kind: 'move', id: 'shellsmash' }, holder('defiant'), garchomp)?.userBoosts).toEqual({
      atk: 2,
      def: -1,
      spa: 2,
      spd: -1,
      spe: 2,
    })
    expect(applyMeans(game, { kind: 'move', id: 'shellsmash' }, holder('clearbody'), garchomp)?.userBoosts.def).toBe(-1)
  })

  it('저주는 고스트 타입 사용자에게 효과 없음, 그 밖엔 A+1·B+1·S−1', () => {
    const ghost = resolved(set('annihilape', 'defiant', []))
    expect(applyMeans(game, { kind: 'move', id: 'curse' }, ghost, garchomp)).toBeNull()
    expect(applyMeans(game, { kind: 'move', id: 'curse' }, garchomp, ghost)?.userBoosts).toEqual({ atk: 1, def: 1, spe: -1 })
  })

  it('목록에 없는 수단은 null', () => {
    expect(applyMeans(game, { kind: 'move', id: 'moonblast' }, garchomp, garchomp)).toBeNull()
    expect(applyMeans(game, { kind: 'ability', id: 'swordsdance' }, garchomp, garchomp)).toBeNull()
  })
})

describe('myMeansNotes', () => {
  it('칼춤 → 물리 공격기가 있으면 공격 탭', () => {
    const notes = myMeansNotes(game, set('garchomp', 'roughskin', ['earthquake', 'swordsdance']))
    expect(notes).toEqual([{ means: { kind: 'move', id: 'swordsdance' }, tabs: ['attack'] }])
  })

  it('칼춤인데 특수 공격기만 있으면 알림 없음', () => {
    expect(myMeansNotes(game, set('garchomp', 'roughskin', ['flamethrower', 'swordsdance']))).toEqual([])
  })

  it('상대에게 거는 하락(위협·얼어붙은바람)은 알림 없음, 철벽 → 방어 탭, 용의춤 → 공격·스피드 탭', () => {
    expect(myMeansNotes(game, set('incineroar', 'intimidate', ['flareblitz', 'partingshot']))).toEqual([])
    const ability = game.data.species.abomasnow.abilities[0]
    expect(myMeansNotes(game, set('abomasnow', ability, ['icywind', 'earthquake']))).toEqual([])
    expect(myMeansNotes(game, set('metagross', 'clearbody', ['irondefense', 'meteormash']))).toEqual([
      { means: { kind: 'move', id: 'irondefense' }, tabs: ['defense'] },
    ])
    expect(myMeansNotes(game, set('altaria', game.data.species.altaria.abilities[0], ['dragondance', 'dragonclaw']))).toEqual([
      { means: { kind: 'move', id: 'dragondance' }, tabs: ['attack', 'speed'] },
    ])
    expect(myMeansNotes(game, set('garchomp', 'roughskin', ['earthquake']))).toEqual([])
  })

  it('무효 세트면 빈 배열', () => {
    expect(myMeansNotes(game, set('garchomp', 'roughskin', ['earthquake'], { sp: { ...ZERO, atk: 99 } }))).toEqual([])
  })
})
