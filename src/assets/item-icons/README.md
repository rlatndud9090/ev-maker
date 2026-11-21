# 도구 아이콘 (Pokémon Champions 가방 스프라이트)

- 생성: `npm run gen:images` (`scripts/data/gen-images.mjs`). 손으로 고치지 않는다. `--force`로 다시 받는다.
- 범위: `scripts/data/lib/images.mjs` `itemIconIds` = 현재 스냅샷들(`src/data/regulations/{id}/data.json`)의 도구 전체(2026-11-21 기준 166종, 메가스톤 포함).
  파티 칸(`src/app/components/PartyBar.tsx`)이 포켓몬마다 지닌 도구를 그대로 보여 주기 때문이다(2026-11-21 범위 확장).
  판정 카드에서 어떤 도구를 표시하는지는 따로 PRD R14 대상 집합(`src/cards/iconTargets.ts`, 계산에 효과를 준 도구만)이 정하며, 그 집합은 이 범위의 부분집합이다.
  원천에 없는 도구는 `manifest.json` `missing`에 남고 화면은 공통 가방 표지로 그린다. 파일: `{도구 id}.png` (예 `colburberry.png`), 48×48 PNG 원본 그대로.
- 출처: Bulbagarden Archives "Champions Bag sprites" (https://archives.bulbagarden.net/wiki/Category:Champions_Bag_sprites)
  - 파일 이름 `Bag_<English Name>_Champs_Sprite.png`(2026-11-12 수집).
  - 판 고정: `Special:FilePath`는 늘 최신 판이라, MediaWiki imageinfo API로 현재 판의 올린 시각(`uploadedAt`)·`sha1`·직접 URL을 받아
    `manifest.json`에 기록하고 받은 바이트의 sha1을 그 판과 대조한다. 다시 돌렸을 때 판이 바뀌었으면 다시 받고 WARNING을 낸다.
- 라이선스·저작권 고지: `LICENSE`(THIRD_PARTY_NOTICES.md에 그대로 실린다). 문제가 있으면 텍스트 배지(이미지 없음 폴백)로 되돌린다.
