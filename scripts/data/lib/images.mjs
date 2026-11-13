// 포켓몬·도구 이미지 생성 단계의 순수 규칙(네트워크·파일 없음). scripts/data/gen-images.mjs가 쓴다.
import { cmp, toID } from './util.mjs'

/** PokeAPI/sprites Champions 메뉴(박스) 아이콘. 파일 이름은 PokeAPI pokemon 숫자 id. */
export const POKEMON_ICON_SOURCE = Object.freeze({
  repo: 'PokeAPI/sprites',
  commit: 'ba403973fdf9d0ac59175813861e6a1f8ed5020c',
  dir: 'sprites/pokemon/versions/generation-ix/champions/icons',
})

/** src: 원천 파일 이름(확장자 뺀 것). 보통 PokeAPI pokemon 숫자 id("666"), 겉모습 폼은 "{pokemon id}-{form_identifier}"("666-fancy"). */
export const pokemonIconUrl = (src) =>
  `https://raw.githubusercontent.com/${POKEMON_ICON_SOURCE.repo}/${POKEMON_ICON_SOURCE.commit}/${POKEMON_ICON_SOURCE.dir}/${src}.png`

/**
 * 상류 원천에서 서로 다른 폼이 같은 그림인 것(알려진 한계, 화면에서 구분 안 됨). gen:images가 매니페스트 sameImage에 기록하고 경고한다.
 * PokeAPI/sprites @ 고정 커밋에서 바이트 단위로 같은 파일들:
 *  - 메가냐오닉스 수컷(10314)·암컷(10326)
 *  - 포트데스(855)·진품 폼(855-antique): 게임에서도 바닥 각인 차이뿐
 *  - 그우린차(1013)·걸작 폼(1013-masterpiece): 게임에서도 바닥 각인 차이뿐
 */
export const KNOWN_SAME_IMAGE = Object.freeze(
  [
    ['meowsticfmega', 'meowsticmmega'],
    ['polteageist', 'polteageistantique'],
    ['sinistcha', 'sinistchamasterpiece'],
  ].map((g) => Object.freeze(g)),
)

/**
 * 손 매핑(스냅샷 종 id → PokeAPI pokemon 숫자 id). 자동 규칙으로 못 풀거나 잘못 푸는 것만 둔다(근거: PokeAPI pokemon_forms.csv @ 고정 커밋).
 * Showdown은 성별·색·품종 폼을 별도 원종처럼 두거나(meowsticf) 기본 폼이 PokeAPI와 다르다(maushold = 세 식구, PokeAPI 기본 925는 네 식구).
 */
export const HAND_POKEAPI_IDS = Object.freeze({
  basculegionf: 10248, // basculegion-female
  indeedeef: 10186, // indeedee-female
  maushold: 10257, // maushold-family-of-three
  mausholdfour: 925, // maushold-family-of-four(PokeAPI 기본)
  meowsticf: 10025, // meowstic-female
  meowsticfmega: 10326, // meowstic-female-mega
  meowsticmmega: 10314, // meowstic-male-mega
  squawkabillyblue: 10260, // squawkabilly-blue-plumage
  squawkabillywhite: 10262, // squawkabilly-white-plumage
  squawkabillyyellow: 10261, // squawkabilly-yellow-plumage
  taurospaldeaaqua: 10252, // tauros-paldea-aqua-breed
  taurospaldeablaze: 10251, // tauros-paldea-blaze-breed
  taurospaldeacombat: 10250, // tauros-paldea-combat-breed
})

/**
 * 스냅샷 로스터 종 → PokeAPI pokemon 숫자 id. 규칙(위에서부터 처음 맞는 것):
 *  1. HAND_POKEAPI_IDS
 *  2. pokemon_forms.csv identifier를 Showdown id 형식(toID)으로 바꿔 같은 것의 원천 파일(유일할 때만).
 *     그 폼이 기본 폼이 아니면(is_default=0: 비비용 팬시·몬스터볼 무늬, 포트데스 진품처럼 같은 pokemon id를 공유하는 겉모습 폼)
 *     원천의 폼 전용 파일 "{pokemon_id}-{form_identifier}"(예 666-fancy)을 쓴다. 기본 폼 그림(666)으로 대신하지 않는다
 *     (그 파일이 원천에 없으면 gen:images가 404 → 실패 목록·빈 자리).
 *  3. 폼 꼬리가 없는 원종(baseSpecies 없음·메가 아님·영어 이름에 "-" 없음)은 도감 번호(PokeAPI 원종 pokemon id = 전국도감 번호).
 *     "Meowstic-F"처럼 Showdown이 원종으로 두는 폼은 여기서 풀지 않는다(엉뚱한 기본 폼 아이콘 방지).
 * 못 풀면 unresolved(화면은 같은 크기 빈 자리).
 * species: [{ id, num, name, baseSpecies?, isMega }], forms: pokemon_forms.csv 행 배열(identifier, form_identifier, pokemon_id, is_default).
 * 결과 항목: { pokeapiId(pokemon 숫자 id), src(원천 파일 이름, 확장자 뺀 것), via }.
 */
export function resolvePokeapiIds(species, forms, hand = HAND_POKEAPI_IDS) {
  const byForm = new Map()
  for (const f of forms) {
    const key = toID(f.identifier)
    const pid = Number(f.pokemon_id)
    if (!Number.isInteger(pid) || pid <= 0) continue
    const cosmetic = String(f.is_default ?? '1') === '0' && Boolean(f.form_identifier)
    const src = cosmetic ? `${pid}-${f.form_identifier}` : String(pid)
    const map = byForm.get(key) ?? new Map()
    map.set(src, pid)
    byForm.set(key, map)
  }
  const resolved = {}
  const unresolved = []
  for (const s of [...species].sort((a, b) => cmp(a.id, b.id))) {
    if (Object.prototype.hasOwnProperty.call(hand, s.id)) {
      resolved[s.id] = { pokeapiId: hand[s.id], src: String(hand[s.id]), via: 'hand' }
      continue
    }
    const hits = byForm.get(s.id)
    if (hits?.size === 1) {
      const [[src, pokeapiId]] = [...hits]
      resolved[s.id] = { pokeapiId, src, via: 'form' }
      continue
    }
    if (!s.baseSpecies && !s.isMega && !String(s.name ?? '').includes('-') && Number.isInteger(s.num) && s.num > 0) {
      resolved[s.id] = { pokeapiId: s.num, src: String(s.num), via: 'num' }
      continue
    }
    unresolved.push({ id: s.id, reason: hits?.size > 1 ? `폼 identifier 다의(${[...hits.keys()].join(',')})` : '폼 identifier 없음' })
  }
  return { resolved, unresolved }
}

/** Bulbagarden Archives "Champions Bag sprites" 파일 이름: "Bag <English Name> Champs Sprite.png"(공백은 밑줄). */
export const bagSpriteFile = (englishName) => `Bag_${String(englishName).trim().replace(/\s+/g, '_')}_Champs_Sprite.png`

export const BULBA_CATEGORY = 'https://archives.bulbagarden.net/wiki/Category:Champions_Bag_sprites'
export const bulbaFilePathUrl = (file) => `https://archives.bulbagarden.net/w/index.php?title=Special:FilePath&file=${encodeURIComponent(file)}`

/**
 * MediaWiki imageinfo API(현재 판의 올린 시각·sha1·직접 URL). Special:FilePath는 늘 최신 판이라 판 고정·변경 감지에 쓴다.
 * files: 원천 파일 이름 배열(최대 50).
 */
export const bulbaImageInfoUrl = (files) =>
  `https://archives.bulbagarden.net/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=timestamp%7Csha1%7Curl&titles=${encodeURIComponent(
    files.map((f) => `File:${f}`).join('|'),
  )}`

/**
 * imageinfo 응답 → 원천 파일 이름(밑줄 형식) → { timestamp, sha1, url }. 없는 파일(missing)은 빠진다.
 * MediaWiki는 제목을 공백 형식으로 돌려주므로 밑줄로 되돌려 맞춘다.
 */
export function parseBulbaImageInfo(json) {
  const out = {}
  for (const p of json?.query?.pages ?? []) {
    const ii = p?.imageinfo?.[0]
    if (p?.missing || !ii || typeof p.title !== 'string') continue
    const file = p.title.replace(/^File:/, '').replace(/ /g, '_')
    out[file] = { timestamp: ii.timestamp, sha1: ii.sha1, url: ii.url }
  }
  return out
}

/**
 * 받은(또는 디스크) 파일을 다시 받을지. prev: 직전 매니페스트 항목, want: 이번 원천 식별자(src 또는 file), sha: 디스크 파일 sha256(없으면 undefined).
 * 파일이 없거나, 직전 매니페스트에 없거나, 원천 식별자가 바뀌었거나(손 매핑·CSV 커밋 변경), 디스크 내용이 매니페스트 sha256과 다르면 다시 받는다.
 */
export function needsDownload({ force, prev, want, wantKey, sha }) {
  if (force || sha === undefined || !prev) return true
  return prev[wantKey] !== want || prev.sha256 !== sha
}

/** 매니페스트 항목 중 sha256이 같은데 원천이 다른 묶음(같은 그림). 알려진 묶음(known)과 나머지(unexpected)로 나눈다. */
export function sameImageGroups(entries, known = KNOWN_SAME_IMAGE) {
  const bySha = new Map()
  for (const [id, e] of Object.entries(entries)) bySha.set(e.sha256, [...(bySha.get(e.sha256) ?? []), id])
  const groups = [...bySha.values()].filter((g) => g.length > 1).map((g) => g.sort(cmp))
  const knownKeys = new Set(known.map((g) => [...g].sort(cmp).join(',')))
  return {
    known: groups.filter((g) => knownKeys.has(g.join(','))).sort((a, b) => cmp(a[0], b[0])),
    unexpected: groups.filter((g) => !knownKeys.has(g.join(','))).sort((a, b) => cmp(a[0], b[0])),
  }
}

/**
 * 이번에 받는 도구: 반감열매 18종(src/cards/berries.ts RESIST_BERRIES) + 화력 도구 22종(src/cards/powerItems.ts POWER_ITEMS).
 * 두 목록의 합과 같아야 한다(단위 테스트가 확인).
 */
export const ITEM_ICON_IDS = Object.freeze([
  'babiriberry',
  'chartiberry',
  'chilanberry',
  'chopleberry',
  'cobaberry',
  'colburberry',
  'habanberry',
  'kasibberry',
  'kebiaberry',
  'occaberry',
  'passhoberry',
  'payapaberry',
  'rindoberry',
  'roseliberry',
  'shucaberry',
  'tangaberry',
  'wacanberry',
  'yacheberry',
  'lifeorb',
  'expertbelt',
  'muscleband',
  'wiseglasses',
  'blackbelt',
  'blackglasses',
  'charcoal',
  'dragonfang',
  'fairyfeather',
  'hardstone',
  'magnet',
  'metalcoat',
  'miracleseed',
  'mysticwater',
  'nevermeltice',
  'poisonbarb',
  'sharpbeak',
  'twistedspoon',
  'silverpowder',
  'silkscarf',
  'spelltag',
  'softsand',
])

/** 스냅샷들(+메타 등장 종)에서 아이콘을 받을 로스터. 같은 id는 처음 본 스냅샷 기준. */
export function rosterOf(snapshots, metaIds = []) {
  const out = new Map()
  for (const data of snapshots) {
    for (const [id, s] of Object.entries(data.species)) {
      if (!out.has(id)) out.set(id, { id, num: s.num, name: s.name?.en, baseSpecies: s.baseSpecies, isMega: s.isMega === true })
    }
  }
  const missingMeta = [...new Set(metaIds)].filter((id) => !out.has(id)).sort(cmp)
  return { species: [...out.values()].sort((a, b) => cmp(a.id, b.id)), missingMeta }
}
