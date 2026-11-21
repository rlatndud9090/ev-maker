# Notes: 스피드 탭 기본 배분 전부 표시와 고정 불가 핀 비활성화

> 사람은 중립 역할어(`사용자`/`개발자`/`검증자`)로 지칭한다 — 개인 호칭·별명은 넣지 않는다
> (운영자 설정이 그렇게 부르라 해도). 상세: `harness/templates/examples/README.md` §5.

Date: 2026-11-21 Asia/Seoul
Unit type: feature
Status: draft

## 맥락

- 사용자 요청(2026-11-21)은 두 가지다. 원문은 PRD 배경에 있다.
  - 성격 충돌로 고를 것이 없는 핀은 비활성이어야 한다.
  - 스피드 탭 기본 표시를 "SP 배분 최소 이상 전부"로 바꾸고, 같은 실수치 줄은 사용률 순으로 놓는다.
- 사용자가 보낸 화면은 PR #9 이전 UI다(방어 핀 메뉴에 "저난수1타"·"확정견딤" 둘 다 "성격 충돌"). PR #9 이후 같은 상황은 "고정할 수 있는 결과 없음" 한 줄짜리 빈 메뉴다.
- 이 단위가 뒤집는 기존 결정은 다음과 같다.
  - `speed-tab-revamp` PRD R2(같은 줄 점유율 순)·R3(1위 하나)·R15("스피드 탭에서 SP 배분 기준은 쓰이지 않는다")
  - 같은 단위 ADR 결정 3(기본 배지 선정)
  - `add-pokemon-ux` PRD R4 예시("스피드 2위 이하 배분")·ADR 결정 1(스피드 표시 중 키)
  - `speed-tab-revamp` ADR 결정 3 "순풍: 기본 배지마다 하나"(이제 1위 기본 배지에만)
  - `cut-lock-budget` PRD AC4·ADR 결정 8(해석 입력)·결정 17 개정(빈 핀 → 사유 메뉴)

  accepted 문서 본문은 고치지 않는다. 대체 관계는 이 단위 ADR 머리에 적었다.

### 배지 수 집계(조사 단계, 메타 JSON 직접 집계)

| 스냅숏 | 래더 상대 | 기본 배지(이전 → 이후) | 상대당 최대 |
| --- | --- | --- | --- |
| bo1 상위 100, 기준 5% | 79 | 79 → 약 215 | 7(망나뇽) |
| bo3 상위 100, 기준 5% | 68 | 68 → 약 192 | 6(님피아) |

조건 배지는 1위에만 붙으므로 그 수는 그대로다. 구현 후 성능 e2e 로그의 "배지 수(기본값/전부 켬)"로 다시 확인한다.

## 코드 지도

### 요청 2: 스피드 기본 배지·순서

- `src/cards/speedChart.ts`
  - `:347-357` `ladderBundles`는 `bundlesOf(..., { bundleShareMin: 0 })`로 전 S 묶음을 내고, 묶음마다 스카프 없는 대표 가정 세트(`b.set`)를 붙인다. 이것이 기본 배지 세트가 된다(ADR 1 선택지 A).
  - `:382-389`에서 계산 가능 묶음이 0개면 unsupported 또는 none이다. 그대로 둔다.
  - `:390-392`에 1위 하나만 `base`로 꺼내는 부분이 있다. 이 부분을 "기준 이상 전부, 없으면 1위(동률 → 실수치 높은 쪽)"로 바꾼다. 기준은 계산 가능 묶음(`ok`)에 적용한다. 공용 `bundlesOf`의 minority 동률 규칙(대표 키 순)은 쓰지 않는다.
  - `:399` 조건 배지는 기본 배지 중 점유율 최고(= 기존 `top`)에만 붙인다.
  - `:401-415` `onChart` 집합은 기본 배지 키 전부에서 시작한다. 추가 배분이 기본 키와 같으면 건너뛴다(흡수). `options[].onChart`도 이 집합을 쓴다.
  - 반환 타입 `LadderSpeedOpponent.base: SpeedBadge | null`을 배열(예: `bases`)로 바꿔야 한다. `top`은 조건·추가 배지 기준으로 남긴다. `addedOnly`면 빈 배열이다.
  - `:474-483` `buildSpeedChart`가 기본·조건·추가 배지를 모으는 부분도 함께 바꾼다.
  - `:108` `SpeedChartInput.criteria` Pick에 `bundleShareMin`을 더한다.
  - 이전 결정을 적은 주석(`:99`, `:362`, `:374`)도 고친다.
- `src/cards/speedLadder.ts`
  - `:57-83` `compareInRow`를 바꾼다. 래더 배지(tier 0·1)를 합쳐 다음 순서로 비교한다.
    1. `usageRank` 오름차순
    2. 점유율 있음 먼저, 점유율 내림
    3. 기본 먼저(조건 뒤)
    4. 직접 입력은 `addedOrder`
    5. id

    tier 2(preset)는 그대로 둔다. `usageRank`는 `entry.rank`라 작을수록 사용률이 높다. 목록 밖은 0이지만 tier 2라 섞이지 않는다.
  - `:52-55` `visibleBadges`는 바꿀 필요가 없다.
- `src/cards/speedLock.ts`
  - `:86` `ResolveSpeedLocksInput.criteria`에 `bundleShareMin`을 더한다.
  - `:138-147` force 경로도 같은 기준을 쓴다(ADR 2). 대상이 빠지면 기존 `missing`이다. `findBadge`(`:104-110`)의 출처 무시 폴백이 기본↔추가 전환을 받아 준다.
- `src/app/ProductApp.tsx:249-251` `speedInput`과 `src/app/lockRuntime.ts:18-23`은 이미 `state.criteria` 전체를 넘긴다. 타입만 맞으면 된다.
- `src/app/state.ts:312-318`에서 `bundleShareMin`은 이미 `DAMAGE_CRITERIA_KEYS`라 바꾸면 세대가 오른다. 스피드는 동기 계산이라 다음 렌더에 반영된다.
- `src/cards/addition.ts:68-86` `speedAdditionQuery`의 `shownKeys`가 새 `onChart`를 따른다. 기준 이상 묶음은 duplicate가 된다(PRD R5). `CustomTargetPanel.tsx:121`에서는 `bundleShareMin`이 이미 전달된다.
- 지우기(`SpeedChart.tsx:349`, `SpeedBadgeDetail.tsx:87`)는 `origin==='added'`만 된다. 기본 배지는 지울 수 없다(PRD 비목표).

### 요청 1: 핀 비활성

- 공·방 카드 핀
  - `src/app/components/CardItem.tsx:202-217` `CardPin`은 지금 `control.kind==='blocked'`일 때만 `disabledReason`을 넘긴다. 여기에 "판정된 결과 없음" 이유를 더한다.
  - `src/cards/lockPin.ts:70-186` `pinMenuView`
    - `:72` 후보 하나라도 계산 중이면 COMPUTING이다.
    - `:133-135` 상태를 `off('budget' | 'no-branch' | 'unreachable')`로 나눈다.
    - `:176-185` ok 칸이 없는 결과는 빼고, 빈 결과면 `emptyOver`를 둔다.

    여기에 빈 결과 이유를 더한다(ADR 3). 이유는 `over` 있음 → SP 부족, `no-branch` 칸이 하나라도 있음 → 성격 충돌, 그 밖 → 일반이다. 빈 결과일 때 남는 `unreachable` 칸은 "정확 규칙"으로 끈 칸이 아니다(그 규칙은 위 단계가 ok일 때만 끄므로 결과가 비지 않는다). 그래서 "전부 `no-branch`"가 아니라 "하나라도"다. 메뉴 칸 문구 `'no-branch': '고정과 겹침'`(`lockText.ts:401`)은 그대로 두고, 핀 이유는 `lockCheckText`의 "성격 충돌"을 쓴다.
  - `src/app/lockContext.ts:133-145` `pinMenu()`
    - 지금은 열렸을 때만 불린다.
    - 판정용 함수(예: `pinDisabledReason(tab, pin)`)를 더한다. 메모는 `lockUiValue`가 만든 값 하나 안에서 `pin.control`(단계 후보 목록) 객체를 키로 하는 WeakMap이 맞다. (고정 파생, 탭, 카드 id) 키는 같은 파생 동안 후보가 computing → ready로 바뀌는 것을 놓쳐 "활성"이 굳는다. `lockUiValue`는 `ProductApp.tsx:210-211`에서 draft·locks·lockBase·스냅숏이 바뀔 때만 다시 만들어진다.
    - 후보 결과는 실행 세대마다 새 `TabRun.results`에 쌓인다(`executor.ts:589-608`). 세대가 오르면 후보가 다시 computing이라 핀은 활성으로 돌아간다(ADR 3 "세대가 바뀌면 다시 모른다").
    - 고정이 없으면 판정을 건너뛸 수 있다. 고정이 없으면 H+B 최대가 64라 SP 부족이 없고, 성격 충돌도 없으며, 어느 단계에도 닿지 않는 카드는 이미 `blocked('unreachable-stage')`로 막힌다. 건너뛰는 경로와 판정하는 경로가 같은 결과임을 단위 테스트로 고정한다(ADR 3).
    - `pending`이거나, `control.kind!=='lockable'`이거나, 단계 후보 중 하나라도 `computing`이면 `undefined`(활성)다.
  - `src/app/components/AdjustPopover.tsx:102-108`의 빈 메뉴 문구도 같은 이유 문구를 쓴다(`lockText.ts:409-415` `pinEmptyText`).
  - `src/app/components/CutPin.tsx:85-171` `MenuCutPin`
    - `disabled = !locked && disabledReason!==undefined`(`:93`)를 그대로 쓴다.
    - 열린 상태에서 `disabled`로 바뀌면 메뉴를 닫고 버튼에 포커스를 두고 알림을 낸다. 지금 `useAdjustMenu`는 `shown = open && enabled`(`useAdjustMenu.ts:27`)라, `enabled`가 false가 되면 메뉴만 사라지고 `open`은 true로 남으며 메뉴 안 포커스는 body로 빠진다. 다시 활성이 되면 메뉴가 저절로 열린다. 그래서 `enabled`가 true → false로 바뀔 때 `open`을 지우고 `btnRef`로 포커스하는 처리를 더한다.
  - 방어 후보는 계단 작업이 필요하다(`assemble.ts:369-388`). 지금 이 작업은 `onPinMenu` → `executor.setDetailCards`(`executor.ts:653-663`)로만 돈다. 고정이 있으면 아래 "공·방 후보 미리 계산"의 새 층으로도 돈다(ADR 3 선택지 D).
- 공·방 후보 미리 계산(ADR 3 선택지 D, 사용자 결정 2026-11-21)
  - 현재 구조(`src/app/executor.ts`)
    - `TabRun.queue`는 4층(`Tier = 0|1|2|3`)이다. 0 수요, 1 메뉴·상세(`MENU_TIER`), 2 먼저 계산할 카드(`primary`), 3 나머지다.
    - `refresh`(`:240-254`)가 `explore`(메뉴)와 `lockDemandOf`(`:235-238`, `assembler.candidates(results, t.detail)`)를 합쳐 1층을 만든다.
    - `priority`(`:214-221`)는 활성 탭 early → 다른 탭 early → 활성 탭 late → 다른 탭 late 순이다. 1층은 stage 1·2·4·5(`[t,0,1]`, `[t,1,1]`, `[t,3,1]`, `[t,4,1]`)다.
    - `flags`(`:274-279`)의 `complete`는 `COUNTED_TIERS = [0,2,3]`만 센다.
    - `candidates`(`src/cards/assemble.ts:904-933`)는 카드마다 `buildCard`로 보이는 고정 조작의 계산 중 단계 후보 작업(stage4 갈래·변형, stage5 계단·쌍)과 조정 대기 작업을 모은다. 이미 결과가 있는 키는 뺀다.
  - 바꿀 것
    1. 층을 하나 더한다. `Tier = 0|1|2|3|4`, `PRECOMPUTE_TIER = 4`, `Tiers<T>`·`zeroPos`·`queue` 초기값을 5칸으로 늘린다. `COUNTED_TIERS`는 `[0,2,3]` 그대로 둔다. 그래서 `complete`·진행률·완료 표식(perf mark)이 바뀌지 않는다. `menuLeft`처럼 `precomputeLeft`를 따로 둘 수 있다(성능 측정용 표식).
    2. `TabRun`에 `precompute: boolean`(그 실행에 고정이 하나라도 있음 = `run.lock !== null`, 스피드 고정 포함)과 `visible: ReadonlySet<string>`(화면이 알린 보이는 카드)을 더한다. `execute`의 plan 단계(`:486-497`)에서 `menus`·`details`처럼 `visibles[tab]`을 넣는다.
    3. `refresh`에서 4층을 만든다. 조건은 `t.precompute`이고 0·2·3층에 남은 작업이 없을 때(`assembler.pending`이 빈 경우)다. 대상은 `primary ∪ visible`에서 `detail`을 뺀 집합이다(상세 층과 중복 소비를 피한다. 중복이어도 `take`가 결과 있는 키를 건너뛰면 무해한지 확인한다). 큐는 `assembler.candidates(results, 대상)`이다. 조건이 아니면 `EMPTY_QUEUE`다. 기존 층이 남은 동안 모든 대상 카드의 `buildCard`를 대기열 갱신마다 돌리지 않으려는 조건이다.
    4. `priority`에 4층 슬롯을 맨 뒤에 더한다. 순서는 `[...first.flatMap(late), ...others.flatMap(late), ...first.flatMap(pre), ...others.flatMap(pre)]`이고 `pre = (t) => [[t,3,4],[t,4,4]]`다. `candidates`는 stage4·5만 내기 때문이다. `nextUnit`은 작업마다 우선순위를 처음부터 훑으므로 수요·메뉴·상세가 생기면 바로 앞선다.
    5. 새 공개 메서드 `setVisibleCards(tab, cardIds)`를 `setDetailCards`(`:653-663`)와 같은 꼴로 둔다. 같은 집합이면 무시하고, 바뀌면 `t.visible`을 갈고 `dirty`·`ensureLoop()`다.
    6. 4층 대기열을 다 쓴 뒤 결과가 늘어 새 후보 작업(예: 계단 다음 칸)이 생기면 `dirty`로 다시 만든다. `take`의 "목록을 다 쓰면 낡은 대기열만 다시 만든다" 동작을 그대로 쓴다.
  - 화면 쪽
    - `src/app/components/ResultPanel.tsx:196`의 `rows`(그룹마다 `chosenOption` 카드 하나)가 보이는 카드다. 이 id 목록을 `onMenuCards`처럼 콜백으로 올리고, `ProductApp.tsx:193-200` 근처에서 `executor.setVisibleCards(tab, ids)`로 넘긴다.
    - 보고 있지 않은 탭은 마지막으로 알린 집합이 남는다. 한 번도 열지 않은 탭은 빈 집합이라 `primary`만 대상이다. `primary`는 기본 선택(`chosenOption`의 `defaultOption`)과 같은 카드다(`schedule.ts:318-335` 주석). 구현 때 두 정의가 같은지 단위 테스트로 확인한다.
  - 성능 측정
    - 완료 표식과 별도로 "미리 계산 끝" 표식(예: `cards:precompute-done`, detail에 generation)을 `flags`의 4층 잔량이 0이 될 때 남긴다. 고정 3개 시나리오(`e2e/product-perf.spec.ts:585-660`)에서 실행 세대 시작 표식(`COMPUTE_START_MARK`)부터 두 탭의 이 표식까지를 잰다.
    - 측정 중 Long Task와 프레임 간격은 기존 계측(`:426-478`의 프레임 간격 방식)을 재사용한다.
- 스피드 배지 핀
  - `src/app/components/SpeedBadge.tsx:31-43` `SpeedPin`은 `items={() => [pinStageView('first', pinCandidate(b), ui.check)]}`이고 `disabledReason`이 없다.
  - 렌더 때 확정 세트 기준 판정(메모)으로 `disabledReason`을 넘긴다(ADR 4). 판정은 `lock===undefined`이고 `check`가 computing이 아닐 때 한다. 이유는 `label`·`detail` 문구다.
  - `src/app/components/SpeedChart.tsx:199-201` `pinCandidate`는 `lockSet`(드래그 중 `shownSp`)에 묶여 있다. 판정용은 확정 SP 기준의 별도 메모 함수로 둔다. 클릭 경로는 그대로 둔다.
  - `src/cards/speedLock.ts:70-79` `speedLockCandidate`는 `blocked('set-error' | 'speed-unsupported')` 또는 `ready`를 낸다. `ready`의 해석은 `unreachable`일 수 있다.
  - `CutPin.tsx:176-330` `DirectCutPin`은 이미 `disabledReason`을 받는다(`disabled` → `shown=false`, 누름 무시, aria-disabled·title·sr-only 설명). `SpeedPin`이 그 값을 넘기기만 하면 된다. 다만 `shown = open && !locked && !disabled`라 "계산 중" 메뉴가 열린 채 비활성이 되면 `open`이 남는다. `MenuCutPin`과 같이 `open`을 지우고 핀으로 포커스하는 처리를 더한다.

## 결정

- ADR 결정 1~4를 참고한다.
- 2026-11-21 사용자 결정(PRD 해결된 질문 1): 공·방 핀은 고정이 있을 때 후보를 다른 계산 뒤에 미리 계산해 열기 전부터 끈다. 사용자 질문은 "옆에 '변동' 버튼은 언제 계산하는데? ... 고정할수 없다는걸 이미 아는거 아님?"이었다. 답은 다음과 같았다. '변동' 버튼 표시는 처음 SP 스윕이 정하지만, 변동 목록과 고정 후보(방어 계단, 고정이 있을 때 공격 상승 갈래)는 열 때 계산된다. 성격 충돌 판정에는 이 후보가 필요하다. 사용자는 "고정 있을 때 미리 계산 (Recommended)"을 골랐다.
- 같은 줄 순서(PRD R3)의 직접 입력 배지 위치는 "같은 포켓몬 안 점유율 있는 배지 뒤"다. 사용자 요청 문장("사용률 높은 포켓몬 순으로 왼쪽부터")이 배지 종류를 가리지 않아 질문으로 남기지 않는다.
- 기본 배지 세트(묶음별 가정)와 추가 배지 세트(1위 세트에서 S만 바꿈)는 `observedSpreadAssumption`(`src/meta/assumptions.ts:85-99`)이 대표 가정에서 성격·SP만 바꾸므로 도구·특성이 같다. 같은 (S SP, 부호)면 실수치가 같아, 흡수·고정 이어짐에서 값이 바뀌지 않는다.

## 테스트 계획

### 단위

- `src/cards/speedChart.test.ts`
  - 기준 이상 전부 / 기준 미만 1위 / 1위 동률 → 실수치 높은 쪽 / 거부 묶음 제외 (AC1·AC2)
  - 2위 기본 배지 실수치 = options 실수치, 구애스카프 없음 (AC3)
  - 조건 배지는 1위에만 (AC1)
  - 추가 배분 흡수·복귀 (AC7)
- `src/cards/speedLadder.test.ts`: 사용률 순위 순서, 같은 상대 점유율 → 직접 입력, preset 맨 뒤 (AC5)
- `src/cards/addition.test.ts`: 기준 이상 2위 묶음은 duplicate, 기준 미만은 ok (AC8)
- `src/cards/speedLock.test.ts`: 2위 기본 배지 고정 ok, 기준 상향 시 missing, 추가 기록 있으면 폴백으로 유지 (AC9)
- `src/cards/lockPin.test.ts`: 빈 결과 이유 우선순위(SP 부족 > 성격 충돌 > 일반), 계산 중이면 이유 없음 (AC10)
- `src/app/components/CutPin.test.tsx`: 바로 고정 핀의 `disabledReason` 렌더(aria-disabled·title·sr-only) 테스트를 새로 더한다. 열린 메뉴가 비활성으로 바뀔 때 닫힘·포커스·열림 상태 초기화는 e2e(AC11b)로 본다.
- `src/app/executor.test.ts`·`src/app/executor-lock.test.ts`(AC11c, 고정 입력은 executor-lock 쪽)
  - 고정이 있는 입력: 실행 작업 순서를 기록해, 4층(후보) 작업이 0·1·2·3층 작업보다 모두 뒤인지 확인한다. 4층이 남아 있어도 `complete`가 참인지 확인한다.
  - 4층 대상: `primary ∪ visible`의 카드 작업만 실행되고, 보이지 않는 묶음 카드의 후보 작업은 실행되지 않는다. `setVisibleCards`로 그 카드를 알리면 실행된다.
  - 미리 계산 중 `setDetailCards`·`setMenuCards`·기술 선택이 생기면 그 작업이 다음 단위로 앞선다.
  - 고정이 없는 입력: 실행된 작업 목록이 4층 도입 전과 같다(4층 작업 0개).
  - 세대가 바뀌면 4층이 새 세대 결과로 다시 쌓인다.
- `src/app/lockContext.test.ts`: 미리 계산이 끝난 결과로 조립한 핀이 열기 전 비활성 이유를 낸다(R6). 대상 카드의 후보가 계산 중이면 활성이다.

### e2e

- `e2e/speed-chart.spec.ts`
  - 포푸니크 다중 기본 배지, 툴바 "SP 배분" 100 → 1개, 5 → 복귀 (AC4)
  - 같은 줄 DOM 순서 (AC6)
  - 흡수·복귀 (AC7)
- `e2e/product-cut-lock.spec.ts`
  - 고정이 있을 때 방어 핀이 열기 전에 비활성(성격 충돌)이고, 해제하면 활성·메뉴 닫힘 (AC11)
  - 고정 직후 미리 계산 전에 연 방어 핀이 "계산 중" 뒤 닫히며 비활성, 포커스 유지, 해제 후 자동 재열림 없음 (AC11b). 미리 계산이 먼저 끝나 경합이 생기면 핀을 고정 직후 같은 틱에 연다. 그래도 흔들리면 그 카드가 미리 계산 대상이 아니도록(그룹에서 다른 묶음을 고른 직후) 상황을 만든다.
  - 스피드 도달 불가·SP 부족 핀 비활성 (AC12)
  - 바로 고정 회귀 (AC13)
- `e2e/product-perf.spec.ts:313-371`(스피드 시나리오: 첫 표시·완료·Long Task), "스피드 S 슬라이더 드래그 중 렌더 프레임 간격"(조건 필터 전부 켬, 드래그 중 rAF 간격 중앙값 ≤ 34ms·Long Task ≤ 100ms, 배지·핀·비활성 핀 수 기록): 예산 통과, 배지 수 로그 기록 (AC15)
- `e2e/product-perf.spec.ts`(AC15b)
  - 고정 없음: `:211-250`(공·방 반응성, 500ms/5초/100ms), `:379-415`(클릭 입력 지연 100ms), `:428-478`(프레임 간격 중앙값 34ms)을 상수 그대로 통과시킨다.
  - 고정 3개: `:585-660`(첫 결과 ≤ 무고정 × 3, Long Task 100ms, 변동 목록 확정 5초)을 그대로 통과시킨다.
  - 같은 시나리오에 미리 계산 완료(`COMPLETE_MEDIAN_LIMIT_MS` 5초)·구간 Long Task(`LONG_TASK_LIMIT_MS` 100ms)·프레임 간격 중앙값(`FRAME_INTERVAL_MEDIAN_LIMIT_MS` 34ms) 측정을 더하고, 작업 수와 함께 로그로 남긴다.

### 테스트 매핑(바뀌거나 지워질 기존 테스트, 구현 때 확정)

| 기존 테스트 | 바뀌는 이유 → 대체 요구 |
| --- | --- |
| `src/cards/speedChart.test.ts:62-100`(기본 배지 정확히 하나) | → R1 |
| `src/cards/speedChart.test.ts:233`, `:241`, `:351`, `:370`, `:536` | 기본 배지 수·onChart 기대 → R1·R4 (구현 때 개별 확인) |
| `src/cards/addition.test.ts:91-100`(관측 다른 묶음 ok) | → R5 (duplicate) |
| `src/cards/speedLadder.test.ts:111-129`(점유율 우선 순서) | → R3 |
| `e2e/speed-chart.spec.ts:344-368`(AC4 `toHaveLength(1)`) | → R1 (AC4) |
| `e2e/speed-chart.spec.ts:942`, `:1031` | 기본 배지 수 전제 → R1 (구현 때 개별 확인) |
| `e2e/add-pokemon.spec.ts:218-226`, `:344-349` | 스피드 2위 배분 추가 가능 전제 → R5 |
| `e2e/product-cut-lock.spec.ts:212-249`(AC4, 스피드 메뉴 한 줄 이유) | → R7 (AC12) |
| `src/cards/lockPin.test.ts`(빈 결과·emptyOver) | 이유 필드 추가 → R6 |
| `e2e/product-cut-lock.spec.ts:462`, `:544`, `:1181`(`cut-pin:not([aria-disabled])`로 카드 고름) | 비활성 핀이 늘면 고르는 대상이 바뀔 수 있다. 기대 카드를 확인한다 → R6 (AC14) |

`e2e/product-cut-lock.spec.ts:280-292`(AC11, 기존 비활성 핀 패턴)은 그대로 기준으로 쓴다.

## 빌드 중 개정

요구·결정을 바꾸지 않는 범위에서 구현하며 정한 것과, 기존 문서·테스트와 부딪쳐 가장 작은 충실한 쪽으로 정한 것을 남긴다(2026-11-21 구현).

1. **무고정 동일성 봉인(`INV-261120-no-lock-identity`)과 R1의 충돌.** R1은 고정이 없어도 스피드 차트 출력(기본 배지 수)을 의도적으로 바꾼다. 불변식은 봉인 fixture를 기능 작업으로 갱신하지 못하게 한다. fixture는 그대로 두고, `src/acceptance/no-lock-identity.test.ts`의 스피드 차트 지문만 `bundleShareMin: Infinity`(기준 100% 초과 → "1위 하나" 대체 규칙 = 이 단위 전 선정)로 만든다. 그 지문이 봉인값과 바이트 단위로 같아, 조건·추가 배지·세트·실수치·사다리가 이 단위로 바뀌지 않았음을 그대로 봉인한다. 기본 배지 선정 변화 자체는 `speedChart.test.ts`(AC1·AC2·R1)가 본다. 불변식 문구 개정(“R1 같은 의도된 무고정 변화는 봉인 입력을 바꿔 격리한다”)은 지식 정리 때 판단한다.
2. **미리 계산 기본 대상에 도구 변형 카드를 더함.** ADR 결정 3의 대상은 "먼저 계산할 카드(`primaryCardIds`) ∪ 화면이 알린 보이는 카드"다. 구현 때 확인해 보니(notes 화면 쪽 "두 정의가 같은지 단위 테스트로 확인") 방어 탭 화력 도구 변형(예: 생명의구슬 타부자고)은 따로 그룹이 되어 그 그룹의 기본 선택인데 `primaryCardIds`에 없다. 아직 연 적 없는 탭에서도 "기본으로 보이는 카드"를 덮으려고(R6 대상 첫째 항목의 뜻), 실행기 기본 대상을 `precomputeCardIds` = 먼저 계산할 카드 + 그 묶음의 도구 변형 카드로 둔다. 보이는 카드 알림은 그대로 더한다. `src/cards/precompute-targets.test.ts`가 "그룹 기본 선택 ⊆ 기본 대상"을 고정한다. 계산 순서·완료 정의는 바뀌지 않는다.
3. **미리 계산 층 슬롯은 전 단계.** notes는 `pre = [[t,3,4],[t,4,4]]`(4·5단계)였다. 대기열이 다른 단계 작업을 내면 남은 작업이 영원히 소비되지 않아 루프가 돌기만 하므로, 5단계 전부를 맨 뒤 슬롯으로 둔다. 실제로 나오는 작업은 4·5단계라 순서는 같다.
4. **공·방 탭 본문 문구 검사(`cut-lock-budget` R25)와 R6 이유 문구.** R6이 비활성 핀의 툴팁·읽기 설명에 "SP 부족(n)"을 요구해, 핀 안 sr-only 설명에 그 글자가 생긴다. R25 e2e(AC9·R25)는 카드 본문에서만 "SP 부족(" 등을 찾도록 핀(`.cut-pin-wrap`)을 빼고 검사한다.
5. **같은 줄 순서의 이름 비교 제거.** R3 정렬 키(사용률 순위 → 점유율 → 기본 먼저 → 추가 순 → id)에 이름이 없어 `compareInRow`의 이름 인자를 없앴다. 목록 밖 타겟의 추가 배지(출처 custom)는 지금처럼 프리셋 배지 앞·래더 배지 뒤다("목록 밖 타겟끼리 순서는 지금과 같다").
6. **'포켓몬 추가' 스피드 판정 입력.** `speedAdditionQuery`가 받은 `bundleShareMin`으로 입력 기준을 덮어 써서 표시 중 키를 만든다(화면 기준과 같은 값, R5).
7. **열린 메뉴가 비활성으로 바뀔 때의 알림 영역.** 핀마다 `role=status` 알림 영역을 메뉴가 열린 동안(그리고 닫히며 이유를 낸 뒤)만 둔다. 닫힌 핀 수백 개에 상시 알림 영역을 두지 않으려는 것이다(`data-testid="cut-pin-notice"`).
8. **미리 계산 끝 표식 detail에 작업 수.** `cards:precompute-done` detail은 `{ generation, tab, tasks }`다(성능 e2e의 작업 수 기록용).
9. **스피드 고정이 기본↔추가 배지로 이어질 때의 차트 표시.** 해석(`resolveSpeedLocks`)은 정확한 키가 없으면 출처만 다른(래더·추가) 같은 배분·조건 배지로 고정을 잇는데, 차트의 찬 핀(`lockedBy`)과 상세 갈래 줄의 자기 고정 판정은 정확한 키만 봐서, SP 배분 기준을 바꿔 기본↔추가가 바뀌면 고정이 이어진 배지가 빈 핀으로 보였다(누르면 해제 대신 교체). PRD 비기능 '계산 일관성'·ADR 결정 2를 화면까지 지키려고, 대상 배지 찾기를 `speedLockBadge` 하나로 모아 해석·차트 찬 핀·이동(reveal)·갈래 줄이 같은 규칙을 쓴다. 찬 핀은 비활성 판정을 받지 않는다(R6·R7 그대로).
10. **밀려난 뷰의 핀 비활성 판정.** 스피드 고정만 있으면 새 세대의 고정 해석이 공·방 탭 뷰보다 먼저 준비돼, 갱신 중(밀려난) 뷰의 이전 세대 후보를 새 내 세트·고정으로 판정할 수 있었다(R6 '지금 실행 세대의 후보로만'·깜빡임 금지 위반). ResultPanel이 뷰가 지금 세대인지(`ViewCurrentContext`)를 주고, `lockUi.pinDisabled(tab, pin, viewCurrent)`는 밀려난 뷰면 활성(계산 중과 같은 취급)으로 둔다.
11. **AC11b e2e의 핀 열기 시점.** 고정 뒤 새 세대 뷰에 그 카드가 나타나고 미리 계산이 끝나기까지 수백 ms뿐이라, 테스트 쪽 클릭이 이미 비활성이 된 핀을 누르거나 "계산 중" 메뉴가 폴링 전에 닫혀 거의 매번 실패했다(이 수정 전에도 실패 기록). 테스트 계획대로 "고정 직후" 열도록, 페이지 안 MutationObserver가 지금 세대 뷰에 활성 핀이 나타나는 즉시 열고 "계산 중" 표시를 기록해 확인한다. 제품 동작은 바뀌지 않는다.

## 테스트 매핑(구현 확정)

| 기존 테스트 | 바뀐 것 → 대체 요구 |
| --- | --- |
| `src/cards/speedChart.test.ts` "래더 상대마다 기본 배지가 정확히 하나…" | 기준 이상 전부(없으면 1위)·첫째가 1위 → R1 |
| `src/cards/speedChart.test.ts` "1위 점유율이 같으면…" | 둘 다 기준 이상이면 둘 다 기본, 동률 규칙은 기준 50%(대체)에서 확인 → R1 |
| `src/cards/speedChart.test.ts` 스카프·스카프 필터 끔·순풍·조건 배지는 1위에만 | 기본 배지 여럿 전제·추가 배분 값을 기준 미만 묶음으로 → R1·R2·R4 |
| `src/cards/speedChart.test.ts` 추가 배분(목록 묶음 점유율)·묶음 목록 onChart | 기준 이상 묶음은 기본 배지라 onChart, 추가 예시는 기준 미만 묶음 → R1·R4 |
| `src/cards/speedChart.test.ts` 래더 shownKeys·addedOnly | `base` → `bases`, 추가 예시 값 변경 → R1 |
| `src/cards/addition.test.ts` "범위 안 1위 값은 duplicate, 관측 다른 묶음은 ok" 외 3건 | 기준 이상 2위도 duplicate, 기준 미만만 ok → R5(AC8) |
| `src/cards/speedLadder.test.ts` "같은 줄 순서(R2)" | 사용률 순위 우선 → R3(AC5) |
| `src/acceptance/no-lock-identity.test.ts` | 스피드 지문 입력을 대체 규칙 기준으로 격리(fixture 불변) → R1, 빌드 중 개정 1 |
| `src/app/executor-lock.test.ts` 레인 최종 뷰·AC5 경로·setDetailCards 갈래 재스윕 | 비교 시점을 전체 완료 직후(미리 계산 전)로, 상세 작업이 미리 계산보다 앞섬 확인 → R6(AC11c) |
| `e2e/speed-chart.spec.ts` AC4(`toHaveLength(1)`) | 기준 이상 전부 → R1(AC4) |
| `e2e/add-pokemon.spec.ts` "중복 문구…" | shown 줄 = 기본 배지 수, 1위 값은 그중 하나 → R5 |
| `e2e/product-cut-lock.spec.ts` AC4(스피드 메뉴 한 줄 이유) | 누르기 전 비활성 → R7(AC12) |
| `e2e/product-cut-lock.spec.ts` "R2: 스피드 배지 앞 핀…" 뒷부분(도달 불가 이유 메뉴) | 비활성 핀 → R7 |
| `e2e/product-cut-lock.spec.ts` "AC9·R25" | 핀 안 이유 문구를 본문 검사에서 뺌 → R6, 빌드 중 개정 4 |
| `src/cards/lockPin.test.ts`(빈 결과·emptyOver) | 그대로 통과, 이유 필드 테스트 추가 → R6 |
| `e2e/product-cut-lock.spec.ts`의 `cut-pin:not([aria-disabled])` 카드 고름 | 바꾸지 않고 통과 → R6(AC14) |

새 테스트: `speedChart.test.ts`(AC1·AC2·계산 불가 묶음 제외·AC3·AC7), `speedLadder.test.ts`(AC5 두 건·실데이터 줄 순서), `addition.test.ts`(AC8), `speedLock.test.ts`(AC9 세 건: 기본↔추가 전환 뒤 차트 대상 배지·갈래 줄 자기 고정 포함, 빌드 중 개정 9), `lockPin.test.ts`(AC10 네 건), `lockContext.test.ts`(pinDisabled 여섯 건: 메모 = 비메모, 계산 중·대기·찬 핀·고정 불가 핀 활성, 밀려난 뷰 활성(빌드 중 개정 10), 무고정 건너뜀 = 판정), `executor-lock.test.ts`(AC11c 다섯 건), `precompute-targets.test.ts`(대상 ⊇ 기본 선택), `CutPin.test.tsx`(바로 고정 핀 disabledReason 세 건), `lockText.test.ts`(이유 문구 두 건), `AdjustPopover.test.tsx`(빈 메뉴 성격 충돌), e2e `speed-chart.spec.ts`(AC4 포푸니크·AC6·AC7), `product-cut-lock.spec.ts`(AC12·AC13·AC11·AC11b), `product-perf.spec.ts`(미리 계산 완료·Long Task·프레임 간격·작업 수, 스피드 S 드래그 중 프레임 간격(AC15)).

## 지식 후보

- G 후보: 스피드 기본 배지 세트(묶음별 대표 세트)와 추가 배지 세트(1위 세트에서 S만 바꿈)는 다르다. 같은 키가 기본·추가 양쪽에 있으면 기본이 이긴다. 그래서 추가 기록이 화면에 안 보여도 상태에 남는다.
- INV 후보: 스피드 고정 해석과 스피드 차트는 같은 표시 기준(SP 배분 기준 포함)으로 배지를 만든다. 둘 중 하나만 기준을 받으면 고정 대상 찾기가 어긋난다.
- INV 후보: 핀 비활성은 "앱이 판정을 끝냈고 고를 것이 없음"일 때만이다. 계산 중은 활성이다.

## 검증

- (구현 후) `npm run test:run`, `npm run lint`, `npm run build`, `npm run test:e2e`, harness gate

## 후속 작업

- 열기 전 비활성은 사용자 결정(2026-11-21, "고정 있을 때 미리 계산 (Recommended)")으로 이 단위에서 구현한다(PRD 해결된 질문 1, ADR 3 선택지 D). 미리 계산 완료가 예산을 넘으면 측정값과 원인을 여기 남기고 사용자에게 알린다.
- 기본 배지가 많은 상대의 접기 표시는 써 본 뒤 판단한다(PRD 비목표).
