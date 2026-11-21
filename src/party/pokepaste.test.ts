/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { MC } from '../core/testing'
import { namesOf, pickSpecies } from '../ui/names'
import type { SetDraft } from '../ui/setDraft'
import { fetchPaste, normalizePasteUrl, parsePasteText, toDrafts, type ParsedMon } from './pokepaste'

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
const names = namesOf(MC)

interface Expected {
  species: string
  item: string
  ability: string
  nature: string
  moves: string[]
  sp: [number, number, number, number, number, number]
}

/** id로 적은 기대값 → 초안 모양(라벨). */
const expectDraft = (e: Expected): SetDraft => ({
  species: names.species.label(e.species),
  item: e.item === '' ? '' : names.items.label(e.item),
  ability: e.ability,
  nature: e.nature,
  natureMinusAuto: false,
  sp: { hp: String(e.sp[0]), atk: String(e.sp[1]), def: String(e.sp[2]), spa: String(e.sp[3]), spd: String(e.sp[4]), spe: String(e.sp[5]) },
  moves: e.moves.map((m) => (m === '' ? '' : names.moves.label(m))),
  mega: false,
  status: 'none',
  boosts: { atk: '0', def: '0', spa: '0', spd: '0', spe: '0' },
})

const GLICK: Expected[] = [
  { species: 'raichumegay', item: 'raichunitey', ability: 'lightningrod', nature: 'modest', moves: ['protect', 'zapcannon', 'focusblast', 'fakeout'], sp: [16, 0, 2, 24, 0, 24] },
  { species: 'basculegion', item: 'mysticwater', ability: 'adaptability', nature: 'adamant', moves: ['protect', 'wavecrash', 'lastrespects', 'aquajet'], sp: [12, 32, 7, 0, 0, 15] },
  { species: 'whimsicott', item: 'focussash', ability: 'prankster', nature: 'timid', moves: ['protect', 'moonblast', 'tailwind', 'encore'], sp: [2, 0, 0, 32, 0, 32] },
  { species: 'garchomp', item: 'sitrusberry', ability: 'roughskin', nature: 'adamant', moves: ['rockslide', 'stompingtantrum', 'dragonclaw', 'protect'], sp: [22, 10, 0, 0, 2, 32] },
  { species: 'floettemega', item: 'floettite', ability: 'flowerveil', nature: 'modest', moves: ['protect', 'moonblast', 'lightofruin', 'dazzlinggleam'], sp: [2, 0, 0, 32, 0, 32] },
  { species: 'gholdengo', item: 'lifeorb', ability: 'goodasgold', nature: 'modest', moves: ['protect', 'makeitrain', 'nastyplot', 'shadowball'], sp: [32, 0, 2, 10, 3, 19] },
]

const SINGLES: Expected[] = [
  { species: 'starmie', item: 'mysticwater', ability: 'analytic', nature: 'timid', moves: ['rapidspin', 'recover', 'surf', 'psychic'], sp: [26, 0, 14, 6, 0, 20] },
  { species: 'quaquaval', item: 'leftovers', ability: 'moxie', nature: 'adamant', moves: ['bulkup', 'aquastep', 'closecombat', 'substitute'], sp: [16, 10, 11, 0, 0, 29] },
  { species: 'samurotthisui', item: 'choicescarf', ability: 'sharpness', nature: 'jolly', moves: ['ceaselessedge', 'aquacutter', 'flipturn', 'suckerpunch'], sp: [0, 32, 0, 0, 2, 32] },
  { species: 'ceruledge', item: 'focussash', ability: 'weakarmor', nature: 'adamant', moves: ['swordsdance', 'bitterblade', 'poltergeist', 'shadowsneak'], sp: [0, 32, 0, 0, 2, 32] },
  { species: 'victreebelmega', item: 'victreebelite', ability: 'chlorophyll', nature: 'timid', moves: ['strengthsap', 'gigadrain', 'toxicspikes', 'encore'], sp: [32, 0, 0, 2, 0, 32] },
  { species: 'hatterene', item: 'sitrusberry', ability: 'magicbounce', nature: 'quiet', moves: ['nuzzle', 'drainingkiss', 'futuresight', 'mysticalfire'], sp: [32, 0, 21, 13, 0, 0] },
]

const mon = (over: Partial<ParsedMon> & { species: string }): ParsedMon => ({ evs: {}, moves: [], ...over })

describe('normalizePasteUrl', () => {
  const ID = '27afa251f1c9a8b7'
  const RAW = `https://pokepast.es/${ID}/raw`
  it.each([
    `https://pokepast.es/${ID}`,
    `http://pokepast.es/${ID}`,
    `pokepast.es/${ID}`,
    `https://pokepast.es/${ID}/`,
    `https://pokepast.es/${ID}/raw`,
    `https://pokepast.es/${ID}/json`,
    `https://pokepast.es/${ID}/raw/`,
    `  https://pokepast.es/${ID}  `,
    `https://pokepast.es/${ID.toUpperCase()}`,
  ])('같은 paste로 인식: %s', (input) => {
    expect(normalizePasteUrl(input)).toEqual({ ok: true, id: ID, rawUrl: RAW })
  })

  it.each([
    '',
    ID,
    `https://www.pokepast.es/${ID}`,
    `https://pokepast.es/${ID.slice(1)}`,
    `https://pokepast.es/${ID}0`,
    `https://pokepast.es/27afa251f1c9a8bz`,
    `https://pokepast.es/${ID}/edit`,
    `https://example.com/${ID}`,
    `ftp://pokepast.es/${ID}`,
    `https://pokepast.es/${ID}?x=1`,
  ])('형식 오류: %s', (input) => {
    expect(normalizePasteUrl(input)).toEqual({ ok: false, reason: 'format' })
  })
})

describe('parsePasteText', () => {
  it('glick 표본: 종 줄(메가스톤·성별)·특성·노력치·성격·기술, 레벨 등은 무시', () => {
    const mons = parsePasteText(fixture('glick-mb.txt'))
    expect(mons).toHaveLength(6)
    expect(mons[0]).toEqual({
      species: 'Raichu',
      item: 'Raichunite Y',
      ability: 'Lightning Rod',
      nature: 'Modest',
      evs: { hp: 16, def: 2, spa: 24, spe: 24 },
      moves: ['Protect', 'Zap Cannon', 'Focus Blast', 'Fake Out'],
    })
    expect(mons[1]).toMatchObject({ species: 'Basculegion', gender: 'M', item: 'Mystic Water' })
    expect(mons[1].nickname).toBeUndefined()
    expect(mons[4]).toMatchObject({ species: 'Floette-Eternal', gender: 'F', item: 'Floettite' })
  })

  it('singles 표본: 애칭+폼 직접 표기, Shiny 줄 무시', () => {
    const mons = parsePasteText(fixture('singles-ou.txt'))
    expect(mons).toHaveLength(6)
    expect(mons[4]).toEqual({
      species: 'Victreebel-Mega',
      nickname: 'Victor E. Belle',
      item: 'Victreebelite',
      ability: 'Chlorophyll',
      nature: 'Timid',
      evs: { hp: 32, spa: 2, spe: 32 },
      moves: ['Strength Sap', 'Giga Drain', 'Toxic Spikes', 'Encore'],
    })
    expect(mons[5]).toMatchObject({ species: 'Hatterene', gender: 'F' })
    expect(mons[2]).toMatchObject({ species: 'Samurott-Hisui' })
  })

  it('종 줄 조합: 애칭 (종) (M) @ 도구 / 도구 없음 / 종만', () => {
    const text = ['Nick (Garchomp) (M) @ Life Orb', '', 'Pikachu (F)', '', 'Gholdengo', '- Protect'].join('\n')
    expect(parsePasteText(text)).toEqual([
      { species: 'Garchomp', nickname: 'Nick', gender: 'M', item: 'Life Orb', evs: {}, moves: [] },
      { species: 'Pikachu', gender: 'F', evs: {}, moves: [] },
      { species: 'Gholdengo', evs: {}, moves: ['Protect'] },
    ])
  })

  it('CRLF·줄 끝 공백·팀 머리줄(===)·IVs·Tera Type 무시', () => {
    const text = '=== [gen9] Team ===\r\n\r\nGarchomp @ Life Orb   \r\nAbility: Rough Skin\r\nTera Type: Ground\r\nIVs: 0 Atk\r\nHappiness: 0\r\nEVs: 2 HP / 32 Atk / 32 Spe\r\nJolly Nature\r\n- Earthquake\r\n'
    expect(parsePasteText(text)).toEqual([
      { species: 'Garchomp', item: 'Life Orb', ability: 'Rough Skin', nature: 'Jolly', evs: { hp: 2, atk: 32, spe: 32 }, moves: ['Earthquake'] },
    ])
  })

  it('기술 줄 "- A / B" 대안 표기는 첫 대안만 쓴다', () => {
    const text = ['Garchomp', '- Earthquake / Stomping Tantrum', '- Protect/Detect', '- Swords Dance'].join('\n')
    expect(parsePasteText(text)[0].moves).toEqual(['Earthquake', 'Protect', 'Swords Dance'])
  })

  it('NBSP 등 유니코드 공백은 일반 공백으로 바꿔 읽는다', () => {
    const text = 'Nick\u00a0(Garchomp)\u00a0@\u00a0Life\u00a0Orb\nAbility:\u00a0Rough\u3000Skin\nEVs:\u00a032\u00a0Atk\u202f/\u00a032 Spe\nJolly\u00a0Nature\n-\u00a0Earthquake'
    expect(parsePasteText(text)).toEqual([
      { species: 'Garchomp', nickname: 'Nick', item: 'Life Orb', ability: 'Rough Skin', nature: 'Jolly', evs: { atk: 32, spe: 32 }, moves: ['Earthquake'] },
    ])
  })

  it('빈 텍스트·공백만 → 0마리', () => {
    expect(parsePasteText('')).toEqual([])
    expect(parsePasteText('  \n\n \t\n')).toEqual([])
  })
})

describe('toDrafts', () => {
  it('glick 표본 전체: 메가스톤 → 메가 폼, 보고 없음', () => {
    const { drafts, report } = toDrafts(parsePasteText(fixture('glick-mb.txt')), MC)
    expect(drafts).toEqual(GLICK.map(expectDraft))
    expect(report).toEqual([])
  })

  it('singles 표본 전체: 애칭 무시, 메가 폼 직접 표기, 지역 폼', () => {
    const { drafts, report } = toDrafts(parsePasteText(fixture('singles-ou.txt')), MC)
    expect(drafts).toEqual(SINGLES.map(expectDraft))
    expect(report).toEqual([])
  })

  it('메가 초안은 기존 메가 선택 경로(pickSpecies)와 같은 원종·스톤으로 풀린다', () => {
    const { drafts } = toDrafts(parsePasteText(fixture('glick-mb.txt')), MC)
    const raichu = drafts[0]!
    expect(pickSpecies(MC, raichu.species)).toEqual({ base: MC.data.species.raichu, megaStone: 'raichunitey' })
    expect(names.items.resolve(raichu.item)).toBe('raichunitey')
    const floette = drafts[4]!
    expect(pickSpecies(MC, floette.species)).toEqual({ base: MC.data.species.floetteeternal, megaStone: 'floettite' })
  })

  it('못 푼 기술·도구·성격은 그 항목만 비우고 보고', () => {
    const { drafts, report } = toDrafts(
      [mon({ species: 'Garchomp', item: 'Fake Orb', ability: 'Rough Skin', nature: 'Bogus', evs: { atk: 32 }, moves: ['Earthquake', 'Not A Move', 'Protect'] })],
      MC,
    )
    expect(drafts[0]).toMatchObject({
      species: names.species.label('garchomp'),
      item: '',
      ability: 'roughskin',
      nature: 'hardy',
      moves: [names.moves.label('earthquake'), '', names.moves.label('protect'), ''],
      sp: { hp: '0', atk: '32', def: '0', spa: '0', spd: '0', spe: '0' },
    })
    expect(report).toEqual([
      {
        index: 0,
        name: names.species.label('garchomp'),
        issues: [
          '도구 "Fake Orb"을(를) 현재 레귤레이션에서 찾을 수 없어 비웠습니다',
          '성격 "Bogus"을(를) 찾을 수 없어 보정 없는 성격으로 넣었습니다',
          '기술 "Not A Move"을(를) 현재 레귤레이션에서 찾을 수 없어 비웠습니다',
        ],
      },
    ])
  })

  it('특성: 못 풀거나 가질 수 없으면 첫 특성으로 대체하고 보고, 없으면 조용히 첫 특성', () => {
    const { drafts, report } = toDrafts(
      [mon({ species: 'Garchomp', ability: 'Nope' }), mon({ species: 'Garchomp', ability: 'Prankster' }), mon({ species: 'Garchomp' })],
      MC,
    )
    expect(drafts.map((d) => d?.ability)).toEqual(['sandveil', 'sandveil', 'sandveil'])
    expect(report.map((r) => r.index)).toEqual([0, 1])
    expect(report[0].issues[0]).toContain('특성 "Nope"을(를) 현재 레귤레이션에서 찾을 수 없어')
    expect(report[1].issues[0]).toContain('특성 "Prankster"은(는) 이 포켓몬이 가질 수 없어')
  })

  it('종을 못 풀면 그 칸 null + 보고, 나머지 칸은 유지', () => {
    const { drafts, report } = toDrafts([mon({ species: 'Missingno', nickname: 'Glitch' }), mon({ species: 'Garchomp' })], MC)
    expect(drafts[0]).toBeNull()
    expect(drafts[1]?.species).toBe(names.species.label('garchomp'))
    expect(report).toEqual([{ index: 0, name: 'Glitch', issues: ['종 "Missingno"을(를) 현재 레귤레이션에서 찾을 수 없어 칸을 비웠습니다'] }])
  })

  it('SP가 능력치당 32 또는 합계 66을 넘으면 SP 전부 0 + 보고', () => {
    const { drafts, report } = toDrafts(
      [mon({ species: 'Garchomp', evs: { hp: 4, atk: 252, spe: 252 } }), mon({ species: 'Garchomp', evs: { hp: 32, atk: 32, spe: 3 } }), mon({ species: 'Garchomp', evs: { hp: 2, atk: 32, spe: 32 } })],
      MC,
    )
    const zero = { hp: '0', atk: '0', def: '0', spa: '0', spd: '0', spe: '0' }
    expect(drafts[0]?.sp).toEqual(zero)
    expect(drafts[1]?.sp).toEqual(zero)
    expect(drafts[2]?.sp).toEqual({ ...zero, hp: '2', atk: '32', spe: '32' })
    expect(report.map((r) => r.index)).toEqual([0, 1])
    expect(report[0].issues).toEqual(['SP가 능력치당 32 또는 합계 66을 넘어 모두 비웠습니다'])
  })

  it('다른 종의 메가스톤은 비우고 보고, 메가 폼에 다른 도구면 스톤으로 바꾸고 보고', () => {
    const { drafts, report } = toDrafts([mon({ species: 'Garchomp', item: 'Raichunite Y' }), mon({ species: 'Victreebel-Mega', item: 'Leftovers' })], MC)
    expect(drafts[0]).toMatchObject({ species: names.species.label('garchomp'), item: '' })
    expect(drafts[1]).toMatchObject({ species: names.species.label('victreebelmega'), item: names.items.label('victreebelite'), ability: 'chlorophyll' })
    expect(report[0].issues).toEqual(['도구 "Raichunite Y"은(는) 이 포켓몬의 메가스톤이 아니라 비웠습니다'])
    expect(report[1].issues).toEqual([`메가 폼이라 도구 "Leftovers" 대신 메가스톤 "${names.items.label('victreebelite')}"을(를) 넣었습니다`])
  })

  it('기술 5개 이상은 앞 4개만, 나머지 보고', () => {
    const { drafts, report } = toDrafts([mon({ species: 'Garchomp', moves: ['Protect', 'Earthquake', 'Rock Slide', 'Dragon Claw', 'Swords Dance'] })], MC)
    expect(drafts[0]?.moves).toHaveLength(4)
    expect(report[0].issues).toEqual(['기술 "Swords Dance"은(는) 4개를 넘어 건너뛰었습니다'])
  })

  it('7마리 → 앞 6칸, 7번째는 건너뜀 보고', () => {
    const text = `${fixture('glick-mb.txt')}\n\n${fixture('singles-ou.txt')}`
    const { drafts, report } = toDrafts(parsePasteText(text), MC)
    expect(drafts).toEqual(GLICK.map(expectDraft))
    expect(report.map((r) => r.index)).toEqual([6, 7, 8, 9, 10, 11])
    expect(report[0]).toEqual({ index: 6, name: 'Starmie', issues: ['파티는 6마리까지라 건너뛰었습니다'] })
  })

  it('6마리 미만 → 실제 마리 수만, 빈 입력 → 빈 배열', () => {
    expect(toDrafts([mon({ species: 'Garchomp' })], MC).drafts).toHaveLength(1)
    expect(toDrafts([], MC)).toEqual({ drafts: [], report: [] })
  })
})

describe('fetchPaste', () => {
  const URL_RAW = 'https://pokepast.es/27afa251f1c9a8b7/raw'
  const respond = (body: string, status = 200) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch

  it('성공: 받은 본문을 돌려주고 rawUrl로 요청', async () => {
    const text = fixture('glick-mb.txt')
    const impl = respond(text)
    expect(await fetchPaste(URL_RAW, impl)).toEqual({ ok: true, text })
    expect(impl).toHaveBeenCalledWith(URL_RAW)
  })

  it('404 → not-found', async () => {
    expect(await fetchPaste(URL_RAW, respond('Not Found', 404))).toEqual({ ok: false, reason: 'not-found' })
  })

  it('그 밖의 실패 상태·예외 → network', async () => {
    expect(await fetchPaste(URL_RAW, respond('oops', 500))).toEqual({ ok: false, reason: 'network' })
    const reject = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await fetchPaste(URL_RAW, reject)).toEqual({ ok: false, reason: 'network' })
  })

  it('포켓몬 블록 0개 → empty', async () => {
    expect(await fetchPaste(URL_RAW, respond('\n  \n'))).toEqual({ ok: false, reason: 'empty' })
  })
})
