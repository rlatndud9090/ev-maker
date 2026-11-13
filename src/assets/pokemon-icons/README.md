# 포켓몬 아이콘 (Pokémon Champions 메뉴 아이콘)

- 생성: `npm run gen:images` (`scripts/data/gen-images.mjs`). 손으로 고치지 않는다. `--force`로 다시 받는다.
  직전 `manifest.json`과 비교해 원천 파일(`src`)이 바뀌었거나 디스크 내용이 `sha256`과 다르면 다시 받는다.
- 파일: `{스냅샷 종 id}.png` (Showdown id 형식, 예 `garchompmegaz.png`). 최대 128×128 RGBA PNG 원본 그대로(재인코딩 없음,
  비비용 무늬 폼처럼 원천이 128×120인 것도 그대로 두고 화면에서 비율 유지).
- 출처: [PokeAPI/sprites](https://github.com/PokeAPI/sprites) `sprites/pokemon/versions/generation-ix/champions/icons/{src}.png`
  @ 커밋 `ba403973fdf9d0ac59175813861e6a1f8ed5020c` (2026-10-15T00:01:42Z)
  - `https://raw.githubusercontent.com/PokeAPI/sprites/ba403973fdf9d0ac59175813861e6a1f8ed5020c/sprites/pokemon/versions/generation-ix/champions/icons/{src}.png`
- 종 id → 원천 파일(`src`): PokeAPI/pokeapi `data/v2/csv/pokemon_forms.csv` @ `e5b79b2e15d7c50735a945936afd4cd1cfd94eae`(스냅샷 한국어 명칭과 같은 고정 커밋, sha256 검증)의
  폼 identifier 일치 → 그 pokemon id(`10309` 등). 기본 폼이 아닌 겉모습 폼(`is_default=0`, 예 비비용 팬시·몬스터볼 무늬)은
  원천의 폼 전용 파일 `{pokemon id}-{form_identifier}`(`666-fancy`). 그 밖은 원종 도감 번호, 또는 `scripts/data/lib/images.mjs` `HAND_POKEAPI_IDS`.
  결과·파일 sha256은 `manifest.json`.
- 알려진 한계(상류 원천에서 서로 다른 폼이 바이트 단위로 같은 그림, `manifest.json` `sameImage`):
  메가냐오닉스 수컷·암컷(`meowsticmmega`·`meowsticfmega`), 포트데스·진품 폼(`polteageistantique`), 그우린차·걸작 폼(`sinistchamasterpiece`).
  화면에서 이 폼들은 그림으로 구분되지 않는다(이름으로 구분).
- 용량: 351장 합계 5,072,189 B(4.84 MiB, 5 MiB 예산 안 — 단위 테스트가 확인). 표시 크기는 목록 32px·내 포켓몬 56px라
  고밀도 화면(2배)에서 112px까지 쓰므로 96px로 줄이지 않고 128px 원본을 둔다. 앱은 별도 정적 파일로 내고 목록은 지연 로드한다.
- 라이선스: 저장소 모음은 CC0 1.0 Universal(`LICENSE`는 PokeAPI/sprites `LICENCE.txt` 원문).
  "All image contents within are Copyright The Pokémon Company." 이미지 IP는 © Nintendo / Creatures Inc. / GAME FREAK inc. (The Pokémon Company)이며,
  이 프로젝트는 비공식·비상업 팬 도구로 포켓몬 식별 목적에만 쓴다.
