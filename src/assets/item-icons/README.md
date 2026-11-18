# 도구 아이콘 (Pokémon Champions 가방 스프라이트)

- 생성: `npm run gen:images` (`scripts/data/gen-images.mjs`). 손으로 고치지 않는다. `--force`로 다시 받는다.
- 범위: `scripts/data/lib/images.mjs` `ITEM_ICON_IDS` 42종 = PRD R14 대상 집합(판정 계산에 관여해 화면에 표시하는 도구, `src/cards/iconTargets.ts`)
  = 반감열매 18종(`src/cards/berries.ts` `RESIST_BERRIES`) + 화력 도구 22종(`src/cards/powerItems.ts` `POWER_ITEMS`, 2026-11-14 수집)
  + 스피드 배수 도구 2종(core `SPEED_ITEM_MODIFIERS`: 구애스카프·검은철구, 2026-11-15 수집). '순서 비교 불가' 원인 도구는 번들된 전 메타 기준 현재 없다. 메가스톤은 받지 않는다(앱 자체 공통 표지). 파일: `{도구 id}.png` (예 `colburberry.png`), 48×48 PNG 원본 그대로.
- 출처: Bulbagarden Archives "Champions Bag sprites" (https://archives.bulbagarden.net/wiki/Category:Champions_Bag_sprites)
  - 파일 이름 `Bag_<English Name>_Champs_Sprite.png`(2026-11-12 수집).
  - 판 고정: `Special:FilePath`는 늘 최신 판이라, MediaWiki imageinfo API로 현재 판의 올린 시각(`uploadedAt`)·`sha1`·직접 URL을 받아
    `manifest.json`에 기록하고 받은 바이트의 sha1을 그 판과 대조한다. 다시 돌렸을 때 판이 바뀌었으면 다시 받고 WARNING을 낸다.
- 라이선스·저작권 고지: `LICENSE`(THIRD_PARTY_NOTICES.md에 그대로 실린다). 문제가 있으면 텍스트 배지(이미지 없음 폴백)로 되돌린다.
