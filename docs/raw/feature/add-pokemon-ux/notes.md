# Notes: 포켓몬 추가 UI/UX 개선

> 사람은 중립 역할어(`사용자`/`개발자`/`검증자`)로 지칭한다 — 개인 호칭·별명은 넣지 않는다
> (운영자 설정이 그렇게 부르라 해도). 상세: `harness/templates/examples/README.md` §5.

Date: 2026-11-18 Asia/Seoul
Unit type: feature
Status: draft

## 맥락

### 현재 추가 흐름 (2026-11-18 코드 조사, main `cae6b7c`)

- **'포켓몬 추가'** (`CustomTargetPanel`): 공격·방어(`ResultPanel`)와 스피드(`SpeedTab`)에서 같은 패널을 쓰고, 열림 상태는 탭 공통이다. 받는 값은 종 검색과 기술 1~4개뿐이고 SP·성격은 받지 않는다. 검색 후보에서 `view.entry(id)`가 있는 메타 포켓몬과 이미 추가한 목록 밖 포켓몬을 제외하며, 안내는 없다. 리듀서 `add-custom-target`도 중복 `rosterId`를 조용히 무시한다.
- **스피드 "다른 배분 추가"** (`SpeedBadgeDetail` `AddBundle`): 래더 배지 상세에만 있다. 관측 배분 목록("차트에 있음"/"+ 추가")과 직접 입력(`NumberField` S SP + ▲▼ `nat-btn` 토글)을 받는다. 판정은 `checkSpeedAddition`이 하며 `duplicate`→"이미 있음 — … 배지가 차트에 있습니다.", `invalid`→범위 안내를 낸다. 상태는 `SpeedAddedBundle {opponentId, sp, nature}`, 동일성은 `sameSpeedBundle`이다.
- **공격·방어 카드 배분 메뉴 '직접 추가'** (`CardItem` `BundleAddForm`): 래더 카드 줄에만 있다. 핵심 능력치마다 raw number input을 받고 성격 토글은 없다. 같은 배분이면 안내 없이 기존 옵션을 pin·선택한다. 상태는 `AddedBundle {tab, opponentId, category, sp}`, 동일성은 `sameBundle`이다.
- **목록 밖 포켓몬** (`CustomTarget {rosterId, moves, edits}`): 고정 프리셋 3개(`PRESETS=[0,1,2]`)를 `presetKey(tab,category,preset)`로 편집만 한다. 추가 배분 경로는 없다(`AddedBundle`이 래더 전용).
- **표시 범위:** 래더 = `filters.selected`가 있으면 그것, 없으면 `ranking.slice(0, topN)`(`opponentsOf`). 범위 밖 메타 포켓몬은 배분 추가도 목록 밖 추가도 불가하다.
- **저장:** localStorage 없음, 메모리 전용.
- **공유 부품:** `NumberField`는 재사용된다. ▲▼ 토글은 공유 컴포넌트 없이 마크업이 중복돼 있다(`MySetPanel`, `SpeedBadgeDetail`; CSS `.nat-btn` 공유). 프리셋 편집기도 `CustomEditor`(공·방)와 `PresetEditor`(스피드)에 중복돼 있다.
- **테스트:** 단위 `state.test.ts`·`speedChart.test.ts`·`plan.test.ts`·`acceptance.test.ts`. e2e `product.spec.ts`·`speed-chart.spec.ts`·`speed-chart-a11y.spec.ts`·`bundle.spec.ts`. 패널·배지 상세 컴포넌트 테스트는 없다.

### 지식 브리프 점검 (SP 구간 표)

- 활성 불변식(INV-261117-speed-base-scarf-free 등) 중 이 요구와 모순되는 것은 없다. 추가 배분은 기본 배지 규칙을 바꾸지 않고, 조건 배지는 중복 비교에서 제외한다(R4).

## 결정 (사용자 인터뷰 2026-11-18)

- 적용 탭: 스피드 + 공격·방어 모두.
- 이미 있는 포켓몬을 고르면 패널 안에서 배분을 입력한다(배지 상세로 이동하지 않는다).
- 중복 차단 기준: 같은 포켓몬 + 같은 배분만. 포켓몬 재선택 자체는 허용한다.
- 목록 밖 포켓몬도 추가 배분을 지원한다. 기준은 메타와 같은 방식(핵심 능력치 SP만, 나머지는 첫 프리셋).
- 공격·방어 입력: 분류별 핵심 능력치 SP(전체 배분 입력 아님).
- 기존 진입점(스피드 "다른 배분 추가", 카드 메뉴 '직접 추가')은 유지하고 규칙을 맞춘다.
- 표시 범위 밖 메타 포켓몬: 배분을 추가하면 보이게 한다. 기본 배지 동반 여부는 열린 질문이다.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

-

## 검증

- 자동 검증 명령: `npm test`, `npm run lint`, `npm run build`, `npx playwright test`(e2e). 관련 스펙은 `product.spec.ts`, `speed-chart.spec.ts`, `speed-chart-a11y.spec.ts`, `bundle.spec.ts`다.
- 문구가 바뀌어 단언 갱신이 필요한 기존 e2e:
  - "이미 있음 — …": `speed-chart.spec.ts`(AC26), `speed-chart-a11y.spec.ts`
  - "SP는 0~N 정수만 넣을 수 있습니다": `product.spec.ts`
- PRD 리뷰(2026-11-18): 3렌즈(판정 가능성·코드 정합·고도)로 지적 22건이 나왔다. 반박 검증 뒤 6건을 반영했다.
  - 공·방 성격 무보정 규칙
  - 공·방 배분 선택지 표현
  - 문구 확정
  - 수용 기준 공백
  - 명령을 비기능으로 이동

## 후속 작업

- 후속 작업
