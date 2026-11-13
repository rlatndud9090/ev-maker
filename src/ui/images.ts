// 포켓몬·도구 이미지 URL(npm run gen:images가 받은 같은 출처 정적 파일). 런타임 외부 요청은 없다.
// PNG는 빌드에서 data URI로 넣지 않고 별도 파일로 낸다(vite.config.ts assetsInlineLimit) — JS 번들에는 경로 문자열만 든다.

const POKEMON = import.meta.glob<string>('../assets/pokemon-icons/*.png', { eager: true, query: '?url', import: 'default' })
const ITEMS = import.meta.glob<string>('../assets/item-icons/*.png', { eager: true, query: '?url', import: 'default' })

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

/** 도구 id → 아이콘 URL. 없으면 undefined(화면은 텍스트 배지). */
export const itemIconUrl = (itemId: string | undefined): string | undefined => (itemId === undefined ? undefined : ITEM_BY_ID.get(itemId))
