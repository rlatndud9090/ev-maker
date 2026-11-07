# EV Maker

포켓몬 챔피언스(더블·VGC 우선) 파티의 SP(Stat Points) 조정 도우미. 현재는 계산 코어, 레귤레이션별 게임 데이터 스냅샷, 개발용 확인 페이지까지 있다.
제품 방향은 [위키](docs/wiki/index.md), 이 단계의 요구·결정은 [PRD](docs/raw/feature/champions-calc-data-core/prd.md)와 [ADR](docs/raw/feature/champions-calc-data-core/adr.md)에 있다.

## 개발

Node 버전은 `.nvmrc`(22.18)를 따른다.

```sh
npm ci
npm run dev          # 확인 페이지 (Vite 개발 서버)
npm run test:run     # Vitest 전체
npm run test:e2e     # Playwright (정적 빌드 후 미리보기 서버로 실행, 처음이면 npx playwright install chromium)
npm run lint
npm run build
```

## 게임 데이터 스냅샷 생성

스냅샷(`src/data/regulations/<id>/`)과 리포트(`data/reports/<id>/`)는 생성물이고 저장소에 커밋한다. 원천 버전·시각·한국어 원천 커밋과 파일 해시는 `scripts/data/sources.config.json`에 고정돼 있다.

```sh
npm run gen:snapshot                      # 동결되지 않은 레귤레이션만 다시 만든다
npm run gen:snapshot -- --force           # 동결된 레귤레이션까지 다시 만든다
npm run gen:snapshot -- --record-hashes   # PokeAPI CSV 해시를 설정에 기록한다(원천 커밋을 올릴 때)
npm run gen:snapshot -- --out-root <dir> --cache-dir <dir>   # 다른 위치로 출력·캐시
```

- PokeAPI CSV는 `.cache/pokeapi/<커밋>/`에 없을 때만 내려받고, 해시가 다르면 실패한다. 캐시가 있으면 네트워크 없이 생성된다.
- 같은 원천이면 생성물은 바이트 단위로 같다. 생성 후 `git status`에 변경이 없어야 정상이다.
- 새 레귤레이션을 넣는 순서
  1. `sources.config.json`과 `src/data/regulations/index.json`에 레귤레이션과 원천 모드를 추가한다.
  2. 생성한다.
  3. `data/reports/<id>/diff.md`를 공개된 신규 목록과 대조한다.
  4. 직전 레귤레이션을 동결(`frozen: true`)한다.
- 보정표: 게임 데이터는 `scripts/data/overrides/game.json`, 한국어는 `scripts/data/overrides/ko.json`이다. 항목마다 출처와 확인일을 단다.
- 고지 파일(`src/data/licenses.json`, `THIRD_PARTY_NOTICES.md`)은 이 명령만 쓴다. 저장소에 커밋된 `src/data/meta/index.json`을 읽어 Smogon 통계 출처(월·매치·URL·공개 시각)를 함께 적는다.

## 메타 통계 스냅샷 생성

메타 스냅샷(`src/data/meta/<레귤레이션>/<월>-<bo1|bo3>.json`, 인덱스 `src/data/meta/index.json`)과 리포트(`data/reports/meta/<레귤레이션>/<월>-<매치>/`)는 Smogon chaos JSON(1760 컷)에서 만든 생성물이고 저장소에 커밋한다. 원천 URL·sha256·공개 시각은 `scripts/data/meta.config.json`에 기록한다.

```sh
npm run gen:meta -- --regulation m-c --month 2026-10 --record   # 원천을 받아 sha256·공개 시각(Last-Modified)만 기록한다(생성 안 함)
npm run gen:meta -- --regulation m-c --month 2026-10            # 기록된 원천으로 Bo1·Bo3 스냅샷을 만든다
npm run gen:meta -- --regulation m-c --month 2026-10 --match bo3   # 한 매치 방식만
npm run gen:meta -- --regulation m-c --month 2026-10 --force    # 이미 있는 스냅샷을 다시 만든다(기록과 다른 원천을 다시 기록할 때도)
npm run gen:meta -- ... --out-root <dir> --cache-dir <dir>       # 다른 위치로 출력·캐시
```

- 절차
  1. `--record`로 원천을 기록한다. 이미 기록된 값과 다르면 `--force` 없이는 실패한다.
  2. 같은 레귤레이션·월로 생성한다. 기록이 없거나 캐시 해시가 기록과 다르면 실패한다.
  3. `data/reports/meta/` 리포트(위반 종류별 개수·빠진 점유율, 빈 칸 수, 메가 점검, 보존 통계, 크기)를 대조한다.
  4. `npm run gen:snapshot`으로 고지 파일을 갱신한다. 메타 명령은 고지를 쓰지 않으며, 빼먹으면 재현성 테스트가 실패한다.
  5. 생성물·리포트·고지를 함께 커밋한다.
- 원천 캐시는 `.cache/smogon/<월>/chaos/`에 둔다. 캐시가 있으면 네트워크 없이 생성된다. 메타 명령은 PokeAPI 캐시가 필요 없다.
- 이미 있는 스냅샷은 `--force` 없이 다시 만들지 않는다(건너뜀).
- 메타 스냅샷 매니페스트는 생성 당시 게임 데이터 `data.json`의 sha256을 담는다. 동결되지 않은 m-c의 `data.json`이 바뀌면, 같은 변경 안에서 최신 월 메타를 `npm run gen:meta -- --regulation m-c --month <최신 월> --force`로 다시 만든다(원천 캐시나 재다운로드 필요).

## 라이선스

번들하는 데이터·코드의 라이선스와 출처는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있다.
