import type { Snapshot } from '../data/schema'

// 포켓몬·도구 이미지 URL(npm run gen:images가 받은 같은 출처 정적 파일). 런타임 외부 요청은 없다.
// PNG는 빌드에서 data URI로 넣지 않고 별도 파일로 낸다(vite.config.ts assetsInlineLimit) — JS 번들에는 경로 문자열만 든다.

const POKEMON = import.meta.glob<string>('../assets/pokemon-icons/*.png', { eager: true, query: '?url', import: 'default' })
const ITEMS = import.meta.glob<string>('../assets/item-icons/*.png', { eager: true, query: '?url', import: 'default' })

/** 메가진화 문양(사용자 제공 WebP, src/assets/marks): 메가스톤·메가진화 겹침 표지 */
export { default as MEGA_MARK_URL } from '../assets/marks/mega.webp?url'

/** glob 결과(경로 → URL)를 파일 이름(확장자 뺀 id) → URL로. */
export function indexByFileId(globbed: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const [path, url] of Object.entries(globbed)) {
    const m = /\/([a-z0-9]+)\.png$/.exec(path)
    if (m) out.set(m[1], url)
  }
  return out
}

const POKEMON_BY_ID = indexByFileId(POKEMON)
const ITEM_BY_ID = indexByFileId(ITEMS)

/** 스냅샷 종 id(Showdown 형식) → 아이콘 URL. 없거나 받지 못한 id는 undefined(화면은 같은 크기 빈 자리). */
export const pokemonIconUrl = (speciesId: string | undefined): string | undefined =>
  speciesId === undefined ? undefined : POKEMON_BY_ID.get(speciesId)

/** 도구 id → 받은 아이콘 URL. 없으면 undefined. 화면 표시는 itemGlyphOf를 쓴다. */
export const itemIconUrl = (itemId: string | undefined): string | undefined => (itemId === undefined ? undefined : ITEM_BY_ID.get(itemId))

/** 도구 겹침 그림: 받은 PNG, 메가진화 문양(MEGA_MARK_URL), 공통 가방 표지 중 하나(깨진 이미지·텍스트 대체 없음). */
export type ItemGlyphSpec = { kind: 'img'; url: string } | { kind: 'mega' } | { kind: 'bag' }

const MEGA_STONES = new WeakMap<Snapshot, ReadonlySet<string>>()
const megaStonesOf = (game: Snapshot): ReadonlySet<string> => {
  let set = MEGA_STONES.get(game)
  if (set === undefined) {
    set = new Set(game.data.megas.map((m) => m.stone))
    MEGA_STONES.set(game, set)
  }
  return set
}

/** 메가스톤 판정(스냅숏 megas의 stone)이 PNG 조회보다 먼저다 — 메가스톤은 PNG가 있어도 메가진화 문양으로 그린다. */
export function itemGlyphOf(game: Snapshot, itemId: string): ItemGlyphSpec {
  if (megaStonesOf(game).has(itemId)) return { kind: 'mega' }
  const url = ITEM_BY_ID.get(itemId)
  return url === undefined ? { kind: 'bag' } : { kind: 'img', url }
}
