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

## 구현 계획

ADR 후속 작업의 5단계 순서를 따르고, 6단계로 e2e를 정리한다. 1·2단계는 동작 불변이며 기존 단위 테스트가 회귀를 잠근다. 단계마다 `npx tsc -b`, `npm run lint`, `npm run test:run`을 통과해야 다음으로 넘어간다(6단계는 `npm run test:e2e`까지).

1. **출처 판별자와 동일성·유효성 함수 통합** (domain, 동작 불변)
   - 파일: `cards/types.ts`, `cards/ids.ts`, 신규 `cards/spValue.ts`, `cards/groups.ts`, `cards/plan.ts`, `cards/speedChart.ts`, `cards/index.ts`, `app/state.ts`, 그리고 dispatch 리터럴만 고치는 `CardItem`·`SpeedBadgeDetail`·`SpeedChart`, 테스트 리터럴
   - 계약:
     - `TargetSource = 'ladder' | 'custom'`를 `AddedBundle`·`SpeedAddedBundle`·`PinnedBundle`의 필수 `source`로 둔다.
     - 동일성 키는 ids 계층의 `bundleIdentity`(+`addedBundleIdentity`·`speedBundleIdentity`) 하나로 모은다.
     - SP 검사는 `isSpValue(v, spMax)` 하나로 모은다.
     - `addedCardId`와 `addedBundleCardId`는 출처를 인자로 받는다. 래더 문자열은 지금과 같다.
     - `samePin`과 `pinOf`는 출처를 비교한다.
     - 목록 밖 타겟을 지우면 그 출처·id의 추가 배분과 고정도 함께 지운다.
   - 위험: 래더 카드 id 문자열이 바뀌면 e2e의 `data-card-id` 비교가 깨진다. ids 테스트로 문자열 동일성을 잠근다.
2. **분류·씨앗 상대 단위 추출** (domain, 동작 불변)
   - 파일: `cards/plan.ts`, `cards/speedChart.ts`, 신규 `cards/range.ts`, `cards/index.ts`, 테스트
   - 계약:
     - 표시 범위 래더 산출은 `ladderInRange(view, filters)` 하나로 모은다(plan·speedChart 공용).
     - `opponentSeeds(input, tab, target)`는 상대 하나의 분류·핵심 능력치·관측(또는 프리셋)·카드가 될 씨앗 묶음·기본 SP를 낸다.
     - planTab은 같은 내부 함수(분류·키 능력치·씨앗)를 쓴다.
     - 스피드는 상대 하나의 1위·관측·추가 배지 계산 함수와 `speedKey(sp, sign)`를 공개한다.
   - 위험: 알림 수집과 도구 제거 순서가 바뀌면 안 된다. 기존 plan·acceptance 테스트를 그대로 통과시키고, 씨앗 키 집합이 계획 카드 키와 같다는 동등성 테스트를 더한다.
3. **판정 질의 모듈** (domain)
   - 파일: 신규 `cards/addition.ts`(+테스트), 신규 `app/additionText.ts`(+테스트), `cards/index.ts`
   - 계약:
     - `targetStatus`는 후보 상태를 낸다(메타 목록 / 표시 범위 밖 / 추가됨 / 새 포켓몬).
     - `speedAdditionQuery`와 `damageAdditionQuery`는 표시 중 키, 분류·핵심 능력치, 관측 줄 상태(추가 가능 / 표시 중 / 보정 있음), 기본값을 낸다.
     - `judgeSpeedAddition`과 `judgeDamageAddition`은 ok / 이미 존재 / 잘못된 값 / 더할 배분 없음 중 하나를 낸다.
     - app 계층 `additionMessage`가 판정을 R4·R5 문구로 바꾼다.
   - 위험: 질의가 2단계 씨앗 함수를 거치지 않고 자체 비교식을 만들면 화면 표시와 판정이 갈라진다.
4. **범위 밖 파생 노출과 목록 밖 추가 배분** (domain)
   - 파일: `cards/plan.ts`, `cards/speedChart.ts`, `cards/groups.ts`, `cards/types.ts`, 테스트
   - 계약:
     - 표시 범위 밖이어도 이 탭에 추가 배분이 있는 래더는 "추가분만" 상대로 낸다. 사용률 순 자리에 두고, 중복 기준 집합은 빈 집합에서 시작한다. 관측·기본·조건 줄과 배지는 내지 않는다.
     - 목록 밖 타겟은 첫 프리셋을 기준으로 추가 배분 씨앗과 배지를 낸다(출처 custom).
     - `SpeedBadge`에 `source`를 둔다.
     - groups는 출처와 상관없이 고정을 비교하고, 목록 밖 사용자 추가 카드는 프리셋 앞에 둔다.
   - 위험: 스피드 1위 가정이 표시 중 상대와 어긋나지 않게 같은 루프에서 플래그로만 가른다. 추가분만 상대의 반감열매·화력 도구 변형에 관측 씨앗이 새면 안 된다.
5. **진입점 3곳 연결과 패널 개편** (ui, ADR 결정 2)
   - 파일: `app/ProductApp.tsx`, `CustomTargetPanel.tsx`, `Combobox.tsx`, 신규 `NatureToggle.tsx`, `SpeedBadgeDetail.tsx`, `SpeedChart.tsx`, `SpeedTab.tsx`, `ResultPanel.tsx`, `CardItem.tsx`, CSS, `cards/speedChart.ts`(`checkSpeedAddition` 제거)
   - 계약:
     - 패널 열림과 고른 대상은 앱 계층 상태로 두어 탭 전환에도 남긴다.
     - 패널은 검색(상태 태그) → 선택 칩("다시 검색") → 모드 본문 순서의 한 열이다.
     - 공·방 관측 줄 중 핵심 능력치에 보정이 붙은 줄은 비활성 처리하고 이유를 보인다.
     - 추가에 성공하면 패널을 닫고 앱 계층의 공개(reveal) 요청으로 새 배지나 카드 줄에 포커스와 스크롤을 옮긴다.
     - 카드 메뉴 '직접 추가'는 출처와 상관없이 보인다. 중복이면 안내만 하고 기존 선택지로 옮기지 않는다.
   - 위험:
     - 탭 전환 때 패널이 다시 마운트되며 포커스를 빼앗지 않아야 한다(처음 열 때만 자동 포커스).
     - CardItem은 memo 비교라 판정 콜백을 안정 참조로 넘긴다.
     - 목록 밖 프리셋 줄에는 핀을 두지 않는다(PRD R6 "프리셋은 지울 수 없다").
6. **e2e 갱신·신규** (test)
   - 파일: `e2e/speed-chart.spec.ts`(AC26), `e2e/product.spec.ts`, `e2e/product-toolbar.spec.ts`, `e2e/speed-chart-a11y.spec.ts`, 신규 `e2e/add-pokemon.spec.ts`
   - 계약:
     - 갱신: 패널 region 이름("포켓몬 추가"), "이미 존재합니다 — …" 문구, `SP는 0~32 정수로 입력해 주세요.` 문구.
     - AC26의 범위 축소는 "추가 배지만 남음"으로 바꾼다.
     - "관측 배분과 같은 값이면 그 배분을 고정" 시나리오는 중복 안내로 바꾼다.
     - 신규: ADR 검증 e2e 6건과 세 진입점의 잘못된 SP 문구.
   - 위험: 검색 후보가 로스터 전체로 늘어 `Enter`가 첫 후보를 고르는 기존 헬퍼가 다른 종을 집을 수 있다. 정확한 이름을 넣는다.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

- G: 추가 배분 상대 id는 출처(ladder/custom)와 함께 비교한다. 메타 전환으로 메타 id와 목록 밖 rosterId 공간이 겹칠 수 있다(`src/cards/ids.ts`, `src/app/state.ts`).
- G: 방어 탭 핵심 능력치는 기술 순서대로 나와 STAT_IDS 순이 아니다(예: 목숨걸기 [spa, hp]). 배분 키·카드 id는 STAT_IDS 순으로 정규화해야 패널 경로와 계획 카드 id가 맞는다(`src/cards/ids.ts`).
- G: 내용이 채워진 채 새로 마운트되는 live region은 스크린리더가 읽지 않는다. 안내 영역은 늘 마운트해 두고 내용만 채운다(`src/app/useAnnounce.ts`).
- INV: "추가분만" 상대(표시 범위 밖 메타 포켓몬)는 관측·기본·조건 줄과 배지를 내지 않고, 씨앗 중복 기준을 빈 집합에서 시작한다(`src/cards/plan.ts`, `src/cards/speedChart.ts`).
- INV: 추가 판정(중복·유효성)은 화면 표시와 같은 씨앗 함수에서 나온다. 진입점별 비교식을 따로 두지 않는다(`src/cards/addition.ts`).

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
- 공·방 관측 줄의 boosted·addable은 실제 질의로는 범위 밖 '추가분만' 상대에서만 생긴다. 범위 안은 관측 묶음이 모두 카드라 shown이다. 그래서 'addable 줄 → judge ok → planTab 카드'와 '범위 밖 같은 보정 줄은 boosted' 통합 단언은 추가분만 노출(plan.ts opponentSeeds·opponentsOf)이 들어간 뒤에야 성립한다. 그 단계에서 addition.test.ts에 넣는다.
- 스피드 쪽 범위 밖 질의는 addedOnly 래더 계산이 들어간 뒤 shownKeys가 빈 집합이어야 한다. 그때 speedAdditionQuery가 ladderInRange로 addedOnly를 넘겨야 하므로 addition.ts를 고친다.
- 추가분만 노출이 들어갔다. 위 두 통합 단언은 addition.test.ts에 있다. 공·방은 범위 밖 무보정 관측이 addable이고 그대로 추가하면 사용자 카드만 생긴다. 스피드는 범위 밖 shownKeys가 빈 집합이고 1위 값이 ok다.
- 범위 판정은 range.ts(ladderInRange·ladderOpponents·isInRange) 한곳에서만 한다. plan·speedChart·addition이 모두 이것을 쓴다.
- 화면 쪽에서 볼 것:
  - 목록 밖 추가 배지는 origin 'added', source 'custom'이다. SpeedBadgeDetail은 `ladder = origin !== 'preset'`이고, speedLadder의 rowTier는 share null이면 1이다. 그래서 화면은 이 배지를 래더 추가와 같은 줄로 다룬다. 화면 단계에서는 source로 가른다.
  - e2e AC26 단언은 범위 밖 추가 배지가 남는 동작으로 바꿔야 한다.
- e2e: `add-pokemon.spec.ts`가 R3·R4·R6·R7·R9·R10과 400px·키보드 흐름을 다룬다. 패널 조작(openAddPanel·pickAddTarget·addCustomTarget)은 helpers.ts에 있다.
  - 배지 상세 직접 입력 폼에 noValidate가 없어 범위 밖 SP(33)에서 브라우저 검증이 제출을 막고 안내가 뜨지 않았다. 패널·카드 메뉴처럼 noValidate를 붙였다.
  - 범위 밖 추가분만 노출 줄도 방어 탭 화력 도구 행이 함께 붙는다(모두 data-added-only). 도구 행을 뺀 줄이 하나다.
  - 패널 검색창의 Esc는 열린 후보 목록을 먼저 닫고, 다음 Esc가 패널을 닫는다.
  - 첫 프리셋 도구 편집이 목록 밖 추가 배분에 반영되는 것은 단위 테스트(plan.test.ts)로만 확인한다.

- 구현 검증(2026-11-18, main 루프 재실행):
  - `harness:gate`(lint·build·`test:run`)를 통과했다. 단위 테스트는 70개 파일, 1312건이다.
  - 전체 e2e 1차는 146건 통과·1건 실패였다. 실패한 `product-toolbar.spec.ts:142`는 단독 3회 반복에서 모두 통과해 플레이키로 판단했다.
- 자체 코드리뷰(3렌즈 + 반박 검증): 확정 결함 4건을 수정했다.
  - 방어 탭 패널 카드 id 순서
  - 미리 채워진 live region
  - 분류 변경 시 입력 어긋남
  - 배지 상세 "차트에 있음" 문구
- 배지 상세·카드 메뉴의 안내 지움 e2e 단언을 추가했다.
- 400px·키보드 흐름은 `e2e/add-pokemon.spec.ts` 시나리오로 확인했다. 사람이 직접 화면을 보는 확인은 아직 하지 않았다.

## 후속 작업

- 후속 작업
