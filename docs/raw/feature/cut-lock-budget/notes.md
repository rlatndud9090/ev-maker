# Notes: 컷 고정과 남은 SP 예산 기반 타 탭 재계산

> 사람은 중립 역할어(`사용자`/`개발자`/`검증자`)로 지칭한다 — 개인 호칭·별명은 넣지 않는다
> (운영자 설정이 그렇게 부르라 해도). 상세: `harness/templates/examples/README.md` §5.

Date: 2026-11-18 Asia/Seoul
Unit type: feature
Status: draft

## 맥락

- 출발: 2026-11-17 스피드 탭 개편 앱 확인 중 사용자 요구. 예: 메가라이츄Y가 "최속 120족 추월" 스피드 컷을 고정하고, 남은 SP(합계 66, 능력치당 32)로 방어 탭이 어디까지 버티는지 재계산한다.
- 현재 코드의 예산 개념: 각 탭은 한 능력치(방어는 H+B/D 쌍)만 0~32로 스윕하고 나머지는 내 세트 SP로 고정한다. 남은 예산 = 66 − 다른 능력치 SP(`core/set.ts remainingBudget`). 공격·방어 상세에는 n·예산 밖 빗금이 없고(판정 행 개편 AC29), 스피드 상세만 "예산 초과 · 남은 SP r"을 보인다. 예산 계산 자체(remainingBudget, over-budget 칸, need)는 코어·카드 층에 남아 있다(`cards/target.ts singleTarget·pairTarget`).
- AC1 고정 세트: 앱 기본 예시(`src/app/example.ts` EXAMPLE_DRAFT)는 한카리아스라, AC1은 "메가라이츄Y, 성격 무보정, SP 전부 0, 도구 없음"에서 출발하는 별도 고정 세트로 둔다.
- 목표 문구는 이미 성격 변형 두 개(무보정·상승)의 최소 SP를 낸다. 컷 고정의 두 선택지는 이 계산을 재사용할 수 있다.

## 결정

- 2026-11-18 prd-helper 인터뷰(사용자 선택):
  - 고정 단위 = 목표(컷). 조건이 바뀌면 필요한 SP를 다시 계산한다.
  - 고정할 때 성격을 고르지 않는다. 다른 탭이 무보정안·상승안 두 갈래를 모두 보인다. 사용자 발화: "스피드컷을 누구 추월로 고정한채로 방어탭을 보면, 뭐 S12+ 에 HB 얼마로 버티거나, S20에 HB+로 버틸수있다 대충 이런식으로."
  - 예산 초과: 초과 고정은 막고, 문구는 "예산" 대신 "SP 부족"을 쓴다.
  - 다중 고정 허용. 갈래는 "성격 상승이 어디로 갔는가"로 묶는다.
  - 고정한 능력치의 내 세트 SP 입력은 고정 표시로 대체한다.
  - 고정 대상: 스피드 추월, 공격 1타, 방어 버팀 세 가지 모두.
- 2026-11-18 adr-helper 설계 후 사용자 결정(PRD R9·R10·R13·R14, ADR 결정 10·15·16·17에 반영):
  - 기준 갈래: 자동("상승이 고정 밖" 갈래 우선, 없으면 남은 SP 최대). 갈래가 둘 이상일 때만 고정 목록 아래 "표 기준" 라디오로 바꿀 수 있다.
  - 예산 표시: 고정 중에는 갈래 줄에서만 "(다른 능력치에서 n 필요)"와 "SP 부족(m)"(m은 초과량, PRD R9)을 보이고, 칸 표에는 "고정 미달"만 더한다. 고정이 없으면 판정 행 개편 AC29 그대로(n·예산 밖 빗금 없음).
  - 고정 목록 이동 대상이 필터 밖이면 필터는 그대로 두고 안내만 보인다(스피드 탭의 꺼진 조건 칩만 자동으로 켬).
  - 해제 복원이 66을 넘으면 복원 능력치 SP를 잘라 패널에 알린다(여럿이면 나중에 만든 고정 능력치부터).
- 2026-11-18 디자인 비교(`design-options.html`): 대안 A(목표 곁 토글 + 패널 목록) 채택. 사용자 메모: "나도 이렇게 생각했는데, 고정 목록을 SP바보다 아래로 배치하자." → 고정 목록은 SP 블록 아래(ADR 결정 17).
- 2026-11-21 사용자 결정(PRD R2·R3·R4·R13·AC17·AC18, ADR 개정은 bugfix notes "결정 기록" 절, 설계: [bugfix speed-sp-not-reflected notes](../../bugfix/speed-sp-not-reflected/notes.md) "설계 (B)(C)"):
  - 같은 능력치는 고정 하나: "같은 스탯은 하나의 타겟만 고정". 이미 고정된 능력치에 다른 고정을 걸면 새 고정이 들어가고 이전 고정은 자동 해제(교체). H만 공유하는 방어 쌍(H+B·H+D)은 함께 남는다.
  - 공·방 핀 메뉴 = 변동 메뉴: "고정 버튼에서 뜨는 목록을 완전히 '변동'이랑 똑같이 맞춰도 될듯? UI도. 다만 고정핀은 확1 또는 고난수1타만 있는거뿐이지. (방어탭은 반대고)". 2단에서 고른 성격은 기준 갈래로, 배분(합 최소/H 최대)은 고정에 반영해 고정 SP가 메뉴 값과 같다.

## 리서치

- 2026-11-18 ADR 설계 워크플로 2라운드.
  - 1라운드: 경쟁 설계 3안(최소 변경안, 도메인 엔진 우선안, UX·성능 우선안)을 병렬로 만들고 판정자가 정확성·단순성·성능·UX로 채점했다. 우승은 UX·성능 우선안(초안 불변 오버레이 + 고정 레인 + 조립 단계 갈래 예산)이고, 도메인 엔진 우선안의 순수 모듈·스피드 대상 키·엄격 변형을 접붙였다.
  - 적대 리뷰: 오버레이 골격이 "계획 SP = 초안" 전제 때문에 BLOCKER 2건(합계 66 초과 시 탭 전체 세트 오류, 방어 단일 행의 짝 능력치 의존)과 MAJOR 11건을 받았다.
  - 2라운드: 골격을 "해석 후 계획"으로 바꾼 수정안을 만들고, 재검증에서 남은 MAJOR 10건(엄격 변형의 +S 소거, 행 하락 자리 없음, 성격 충돌, 복원 초과, AC2 단계 모순, 스피드 코어 강등 누락, 합계 초과 예산 뒤집힘, H 고정 비용, 레인 캐시 모순, 스피드 세대)을 코드로 재확인해 모두 반영했다. 결과는 ADR 결정 1~18이다.
  - 설계 레인이 사용자 결정으로 남긴 4건은 위 "결정"에 기록했다. 기준 갈래 기본값은 설계 권고(내 세트 상승 우선)와 다르게 "고정 밖" 우선으로 정해졌다.

## 구현 계획

> 2026-11-18 architect. 정본은 PRD(R1~R17, AC1~AC16)와 ADR(결정 1~18)이다. 이 절은 코드 지도·모듈 계약·파일 경계·레이어 순서·위험만 담는다. 결정 근거는 ADR을 본다.

### 코드 지도(현재)

- 상태: `src/app/state.ts`(리듀서, `bump`로 세대 +1, `draftCache` 종 되돌림, `speedChart` 상태는 세대를 올리지 않음).
- 입력: `src/app/input.ts toCardInput`(초안 → `CardInput.mySet` 그대로).
- 실행기: `src/app/executor.ts`(공격·방어만, `Unit = plan | task`, 층 0 수요·1 메뉴·2 먼저·3 나머지, `priority`, `setInput(input, generation)`).
- 계획: `src/cards/plan.ts planTab`(`validateSet(game, mySet)` 실패 → `my-set-error`), 공격 행 `dependsOn = myDependsOn(...)`(`attackCard`의 `row`), 방어 필터 `dependsOn = myDependsOn(..., ['hp', def])`(`defenseCard`의 `pair`), 행 성격 변형 `natures.ts natureVariants`.
- 행 작업: `src/cards/rowTask.ts`(probe·ends·sweep·variant·extreme·pair·fixed), 캐시 키 `src/cards/key.ts judgementKey`(성격 id 포함), 스케줄 `src/cards/schedule.ts cardPending`.
- 조립: `src/cards/assemble.ts`(`cellViews`의 `available = spTotal − (spSum − displaySp[stat])`, `targetOf` → `target.ts singleTarget·pairTarget(remaining)`), 합계 띠 `sumBand.ts`.
- 동기 기준 구현: `src/cards/batch.ts buildTabView`(테스트용, 실행기와 같은 단계 순서).
- 스피드: 코어 `src/core/speed.ts finalSpeed·minSpToOutspeed`(옵션 인자 없음, `remainingBudget`로 예산 판단), 앱 로직 `src/cards/speedLadder.ts speedBaseline·minSpToPass`, 배지 모델 `src/cards/speedChart.ts buildSpeedChart`(상위 N·선택 필터 적용), 화면 `SpeedTab.tsx → SpeedChart.tsx → SpeedBadgeDetail.tsx`(`speedText.ts minSpText`).
- 화면: `ProductApp.tsx Workspace`(리듀서·실행기·메타 로드), `MySetPanel.tsx`(SP 입력·성격 ▲▼·`limitOf`), `ResultPanel.tsx`(펼친 카드 `expanded`), `CardItem.tsx`, `RowDetail.tsx RowDetail·PairDetail`(목표 `TargetText`, AC29: n·빗금 없음).
- 합계 강등 기존 사례: `moveType.ts`·`plan.ts outspeedsAtMax`·`rowTask.ts IGNORE_TOTAL`·`key.ts`가 이미 `ignoreSpTotal`을 쓴다. 강등이 새로 필요한 곳: `plan.ts planTab validateSet`, `rankMeans.ts myMeansNotes`, `speedChart.ts resolve`, `speedLadder.ts checkedMySet·finalSpeed·minSpToOutspeed`, `rowTask.ts sweepDamage·judgeDamage` 호출(옵션 확인), `SpeedTab.tsx abilityOf`, `MySetPanel.tsx statsOf`.

### 모듈 계약(새 모듈과 바뀌는 인터페이스)

이름은 계약이다. 구현자가 바꿔야 하면 같은 레이어 소비자가 없을 때만 바꾸고 결과 보고에 적는다.

**`src/cards/lock.ts`(L1, 타입 + 순수 파생)**

- `LockKind = 'speed' | 'attack' | 'defense'`, `LockStage = 'guaranteed-ohko' | 'high-roll-ohko' | 'guaranteed-survive' | 'low-roll-ohko' | 'first'`(R1 다섯 단계, "이상" 의미).
- `LockTargetKey`(결정 5)
  - 공격·방어: `{ kind: 'attack' | 'defense'; source: 'ladder' | 'custom'; opponentId; category: Category | null; bundle: { ladder: string } | { preset: PresetIndex } | { added: string }; item: string | null; itemKey: string }`(`itemKey` = cards `itemKey(기술, 조건)`).
  - 스피드: `{ kind: 'speed'; origin: SpeedBadgeOrigin; opponentId; bundle: { sp: number; nature: NatureSign } | { preset: PresetIndex }; condition: string; filterKind: SpeedConditionKind | null }`(`condition` = speedChart 조건 키).
- `CutLock = { seq: number; kind: LockKind; target: LockTargetKey; stage: LockStage; stats: readonly StatId[] }`(공격·스피드 `[stat]`, 방어 `['hp', 'def' | 'spd']`).
- `Stairs = readonly (number | null)[]`(인덱스 = H SP 0~최대, 값 = 그 H에서 단계에 닿는 최소 B/D SP, null = 불가).
- `LockOptions = { shape: 'single'; stat; neutral: number | null; plus: number | null } | { shape: 'pair'; defense: 'def' | 'spd'; neutral: Stairs | null; plus: Stairs | null }`.
- `LockResolution = { kind: 'ok'; options: LockOptions } | { kind: 'set-error' } | { kind: 'missing' } | { kind: 'unreachable'; reason?: string }`.
- `LockStatus = { kind: 'active' } | { kind: 'set-error' } | { kind: 'missing' } | { kind: 'unreachable'; reason?: string } | { kind: 'nature-conflict' } | { kind: 'sp-short'; over: number }`(우선순위 결정 9).
- `BranchPlus = Exclude<StatId, 'hp'> | 'out'`. `Branch = { id: string /* 'out' | 'plus:<stat>' */; plus: BranchPlus; nature: string; lockedSp: Readonly<Partial<Record<StatId, number>>>; lockedSum: number; choice: ReadonlyMap<number, 'neutral' | 'plus'> }`.
- `LockDerivation = { locks: readonly CutLock[]; statuses: ReadonlyMap<number, LockStatus>; branches: readonly Branch[]; baseId: string | null; lockedStats: readonly StatId[]; overTotal: number }`(`overTotal` = 기준 갈래 계획 세트 합 − 66, 0 이상).
- `deriveLocks({ game, mySet, locks, resolutions, baseChoice }): LockDerivation` — 결정 9(갈래 존재, R4 합치기: 단일은 최대, 쌍이 든 묶음은 H 0~최대 계단 합 최소·동률 H 큰 쪽, 생성 순서로 상태 부여·복귀) + 결정 10(기준 갈래).
- `checkLockCandidate({ game, mySet, locks, resolutions, candidate: { lock: Omit<CutLock, 'seq'>; resolution: LockResolution } }): { kind: 'ok' } | { kind: 'sp-short'; over } | { kind: 'nature-conflict' } | { kind: 'unreachable' }` — 결정 13, `deriveLocks`와 같은 함수 경로.
- `branchBudget(derivation, branch, mySp, viewStats, spTotal): { remaining: number; othersSp: number }` — R6(보는 능력치가 고정이면 그 고정 SP를 되더함, 음수는 0). `budgetMark(needSum, remaining, othersSp): { kind: 'fits' } | { kind: 'need'; n } | { kind: 'short'; m }` — R9(m = n − othersSp).

**`src/cards/lockNature.ts`(L1, 결정 4)**

- `branchNature(game, current, plus: BranchPlus, avoid: readonly StatId[]): string | null` — null = 하락 자리 없음(하락 없는 무보정 성격은 검사 안 함).
- `rowNature(game, branchNatureId, plus, avoid): { nature: string; dropWarning: boolean }` — 행 관여 능력치를 더한 피할 집합으로 다시 정함, 자리 없으면 갈래 성격 그대로 + `dropWarning`.
- `strictVariants(game, rowNatureId, v, allowPlus): { stat: v; neutral: string; plus: string | null }` — 무보정은 v 보정만 제거, 상승은 갈래가 허용할 때만(폴백 없음).
- `laneNature(game, current, lockStat, relevant)` — 결정 7 레인 정규화(내 세트 성격 + 고정 능력치 + 행 관여 능력치만의 함수).

**`src/cards/types.ts` 추가(L2가 전부 선언, L3 조립이 채운다)**

- `CardInput.lock?: PlanLock`, `PlanLock = { mode: 'lane' } | { mode: 'main'; derivation: LockDerivation; base: Branch }`. 없으면 기존 경로 그대로(결정 18).
- `TabPlan.lock?: { derivation; base; overTotal }`. `RowSpec.lock?: { nature: string; dropWarning?: true; strict: { neutral: string; plus: string | null }; viewLocked: boolean }`.
- `RowTask` 추가: `{ kind: 'stairs'; filterId; nature: string; rank: number; hpMin: number }`, `{ kind: 'branch'; rowId; nature: string }`. 결과 `{ kind: 'stairs'; ...; stairs: Stairs | 'non-monotonic' }`, `{ kind: 'branch'; rowId; nature; cells }`. 캐시 키는 `key.ts`.
- 뷰: `CellView.belowLock?: true`(고정 미달). `RowView.lock?: RowLockView`, `CardView.pair.lock?: RowLockView`(방어는 쌍 단위).
- `RowLockView = { control?: { kind: 'lockable'; stage: LockStage; candidate: LockCandidate } | { kind: 'blocked'; reason: 'depends-other-stat' | 'fixed-value' } ; lockedBy?: readonly number[]; dropWarning?: true; branches?: readonly BranchLine[] }`.
- `LockCandidate = { kind: 'ready'; lock: Omit<CutLock, 'seq'>; resolution: LockResolution } | { kind: 'computing' }`.
- `BranchLine = { branchId; plus: BranchPlus; isBase: boolean; condition: readonly { stat: StatId; sp: number; plus: boolean }[]; status: 'ok' | 'no-drop-slot' | 'pending'; label?: string; neutral: BranchOption | null | 'omitted'; plus: BranchOption | null | 'omitted'; omittedPlusStat?: StatId }`, `BranchOption = { label: string; stats: readonly TargetStat[]; budget: { kind: 'fits' } | { kind: 'need'; n: number } | { kind: 'short'; m: number }; byLock?: true }`.

**`src/cards/stairs.ts`·`lockTarget.ts`·`lockLane.ts`(L2)**

- `stairsOf(judge, rank, hpMin, max): Stairs | 'non-monotonic'`, `minSumWithFloors(stairs, floors: { hp; defense }): { hp; defense } | null`(동률 H 큰 쪽). 한 단위 판정 ≤ 66회.
- `lockTargetKeyOf(tab, card: CardView | CardSpec, rowOrFilter, item)`, `findLockTarget(plan, lock): { rowId } | { filterId } | null`(배분 키 → 일치 선택지 → 방어 공격 능력치 사영 → 점유율, 실패 null = 대상 없음).
- `laneInput(input, lock): CardInput`(대상 상대 하나만 강제 계획, `lock: { mode: 'lane' }`), `laneTasks(plan, lock, target): RowTask[]`(공격 엄격 변형 2개, 방어 고정 단계 순위 계단 2개), `laneResolution(plan, lock, target, results): LockResolution`, `lockedInput(input, derivation): CardInput`(계획 세트 = 기준 갈래 SP·성격, `lock.mode = 'main'`).
- `batch.ts buildLockedTabView(input, tab, locks, speedResolutions, baseChoice, cache?)` — 레인 → 파생 → 계획을 동기로 끝까지(테스트·AC2 기준 구현).

**스피드(L2)**

- `core/speed.ts`: `finalSpeed(snapshot, set, conditions?, side?, options?: EvalOptions)`, `minSpToOutspeed(snapshot, set, target, conditions?, options?: EvalOptions)`. 옵션 없으면 바이트 동일.
- `speedLadder.ts`: `speedBaseline(game, mySet, myTailwind, options?)`, `minSpToPass(game, mySet, target, myTailwind, options?: { ignoreSpTotal?: boolean; natures?: { neutral: string; plus: string | null } })`.
- `speedChart.ts buildSpeedChart`에 `force?: { opponentId; source }`(필터 밖 대상 해석용) 선택 입력.
- `speedLock.ts`: `speedBadgeLockKey(badge)`, `speedLockCandidate(...)`, `resolveSpeedLocks({ game, view, mySet, locks, criteria, customTargets, added, myTailwind }): ReadonlyMap<number, LockResolution>`, `speedLockSignature(map): string`, `speedBranchLines(...)`: BranchLine[](R8 스피드 배지 갈래 줄, 결정 16 예산).

**앱(L2·L3)**

- `state.ts`: `AppState`에 `locks`, `lockSeq`, `lockBase: string | null`, `lockSpTotal: number | null`, `lockReveal: { seq: number; nonce: number } | null`, `lockTrim: readonly { stat; from; to }[] | null`. 액션 `add-lock { lock; spTotal }`, `remove-lock { seq }`, `set-lock-base { id }`, `reveal-lock { seq }`, `clear-reveal`, `dismiss-lock-trim`. `locks`·`lockBase`는 세대 입력.
- `executor.ts`: `setInput(input, generation, locks?: LockRun)`, `LockRun = { locks; speed: ReadonlyMap<number, LockResolution>; baseChoice: string | null }`. `ExecutorSnapshot.locks: { generation; derivation: LockDerivation } | null`. `setDetailCards(tab, cardIds)`(갈래 재스윕·계단 수요).
- `lockRuntime.ts`: `useLockRuntime(state, game, view)` → `{ lockRun; runGeneration }`, 순수 `nextRunGeneration(prev, reducerGeneration, signature)`.
- `lockContext.ts`: `LockUiContext`(파생, 계산 중 여부, 기준 갈래 계획 세트, 후보 판정, dispatch 래퍼, reveal, `onDetailCards`).
- `components/lockText.ts`: 모든 컷 고정 문구(“S12+ / S20 고정”, “S12+일 때:”, “(다른 능력치에서 n 필요)”, “SP 부족(m)”, “성격 충돌 · 상승이 필요한 고정이 겹침”, “도달 불가”, “대상 없음”, “고정 미달”, “하락 위치에 따라 달라질 수 있음”, “이 갈래는 하락 자리 없음”, “이 컷의 상대는 지금 표시 필터 밖입니다”, 복원 자르기 알림).

### 레이어 순서와 파일 경계

| 레이어 | 작업 | 파일(같은 레이어끼리 겹치지 않음) |
| --- | --- | --- |
| L1 | T1 고정 도메인 코어 | `cards/lock.ts`, `cards/lockNature.ts`, 각 테스트, `cards/index.ts` |
| L1 | T2 무고정 동일성 특성 테스트 | `acceptance/no-lock-identity.test.ts`, `acceptance/__fixtures__/no-lock-identity.json` |
| L2 | T3 계획·행 작업·계단·레인 | `cards/types.ts`, `plan.ts`, `rowTask.ts`, `key.ts`, `schedule.ts`, `natures.ts`, `rankMeans.ts`, `batch.ts`, 새 `stairs.ts`·`lockTarget.ts`·`lockLane.ts`, 테스트 |
| L2 | T4 스피드 코어·스피드 고정 | `core/speed.ts`, `cards/speedLadder.ts`, `cards/speedChart.ts`, 새 `cards/speedLock.ts`, 테스트 |
| L2 | T5 리듀서 | `app/state.ts`, 새 `app/state-lock.test.ts` |
| L3 | T6 조립·갈래 줄·AC2 | `cards/assemble.ts`, `target.ts`, `sumBand.ts`, 새 테스트(`assemble-lock.test.ts`, `lock-acceptance.test.ts`) |
| L3 | T7 실행기·앱 런타임·문구 | `app/executor.ts`, `app/input.ts`, 새 `app/lockRuntime.ts`·`app/lockContext.ts`·`app/components/lockText.ts`, 테스트, `cards/index.ts` |
| L4 | T8 패널·배선 | `ProductApp.tsx`, `MySetPanel.tsx`, 새 `LockList.tsx`·`lockPanel.css` |
| L4 | T9 세 탭 화면 | `RowDetail.tsx`, `CardItem.tsx`, `ResultPanel.tsx`, `SpeedTab.tsx`, `SpeedChart.tsx`, `SpeedBadgeDetail.tsx`, `speedText.ts`, 새 `lockRow.css`, `RowDetail.test.tsx` |
| L5 | T10 E2E·성능·기록 | 새 `e2e/product-cut-lock.spec.ts`, `e2e/product-perf.spec.ts`, `e2e/helpers.ts`, `src/app/perf.ts`, 이 notes의 검증·지식 후보 |

- 공유 파일 규칙: `src/index.css`는 이번 단위에서 고치지 않는다(UI 두 작업이 각자 새 css 파일을 컴포넌트에서 import). `cards/index.ts`는 L1(T1)·L3(T7)만 고친다. L2 모듈은 `cards` 안에서 상대 경로로 import하고, 앱용 export는 T7이 더한다. `cards/types.ts`는 L2(T3)가 모든 새 타입을 선언하고 L3에서는 T6만 고친다.
- 무고정 동일성(결정 18, AC13): T2가 변경 전 코드로 고정한 지문을 L2 이후 모든 작업이 매번 통과해야 한다. 각 작업은 자기 범위의 "옵션 없음 = 기존과 같음" 테스트도 함께 쓴다(T3 계획·행 작업, T4 스피드 코어, T5 "고정 추가 → 전부 해제" 초안 엄격 동일, T6 조립, T7 실행기 스냅샷 순서).

### 위험

- 강등 누락: 위 "합계 강등" 호출처 중 하나라도 빠지면 고정 중 일부 표시만 조용히 사라진다. T3·T4·T8·T9가 각자 목록을 확인하고, T10 E2E가 합계 78 세트로 세 탭을 연다.
- 세대 혼용: 실행 세대(`runGeneration`)와 리듀서 세대를 섞으면 결과 교체·재계산 표시가 틀린다. T8은 모든 세대 비교 지점(실행기 `setInput`, `ResultPanel generation`, `SpeedTab generation`, `reasons` 필터)에 실행 세대만 넘긴다.
- 레인 지연·중복 판정: 레인이 첫 결과를 막는다. 레인 작업 수를 실행기 테스트로 고정하고 성능 E2E에 레인 판정 수를 기록한다.
- H 고정 비용: 방어 탭 전 필터가 계단 모드가 된다. 계단은 필요한 순위만(기준 현재 칸, 한 단계 위, 같은 필터 고정 단계) 스케줄한다.
- 계단 비단조: `non-monotonic`이면 "계산 불가"(도달 불가 + 사유)로 둔다.
- 기준 갈래 "고정 밖" 우선의 캐시 미스: 겁쟁이 + S 고정 같은 경우 성격 id가 바뀌어 전 행이 다시 판정된다(ADR 결과 절). 성능 측정에서 이 경우를 따로 기록한다.
- 순환: 계획 성격이 레인 결과에 의존한다. 레인은 계획 성격을 쓰지 않는다(`laneNature`만).
- 복원 자르기: 리듀서가 게임을 모르므로 합계 상한은 첫 고정 때 받은 `lockSpTotal`로 쓴다.

### 리뷰 규칙 발췌(code-review-guideline 표면 인덱스 기준)

- §0 코어 렌즈: 동작이 바뀌면 문구·문서도 같은 diff에서. 같은 사실을 두 곳에서 계산하지 않는다. 설정↔해제(고정↔해제·복원), 캐시↔무효화를 한 단위로. 극단(합계 78, 필터 밖, 하락 자리 없음, 32 초과)에서 대조한다.
- §2 단일 출처: 갈래·예산·상태는 `deriveLocks` 하나에서만 나온다(R7 후보 판정도 같은 함수). 화면이 예산·n을 따로 계산하지 않는다. 판정 입력이 바뀐 뒤 파생값을 서명 재확인 없이 재사용하지 않는다(스피드 해석 서명, 결정 8). 고정 대상 키는 구조 키이고 문자열 라벨 합성이 아니다(JSON 배열 직렬화).
- §4 상태·오류 분류: 상태 우선순위(세트 오류 > 대상 없음 > 도달 불가 > 성격 충돌 > SP 부족)와 가드 실행 순서가 같아야 한다. "계산 중"은 비활성이 아니다(pending/실패/성공 구분). 레인 예외는 그 고정의 상태로 흡수하고 탭 전체를 멈추지 않는다.
- §6 비동기·스케줄링: 세대가 바뀌면 레인·메인 결과를 버린다. 이동 요청(reveal)은 일회성 표식이고 탭을 떠나면 버린다. 첫 화면 값을 effect에서 늦게 세팅해 깜박이지 않게 한다.
- §8 접근성: 고정·해제·"표 기준" 라디오·갈래 줄은 키보드로 조작되고, 갈래 라벨과 고정 상태(도달 불가·SP 부족·성격 충돌·대상 없음·고정 미달·하락 경고 표지)는 읽기 이름이 있다. 고정 조작을 비활성으로 바꿀 때 포커스가 body로 빠지지 않게 한다. 비활성 사유는 `aria-describedby`로 잇는다.
- 주석(comment-convention): 결정 ID·근거 서사·수치·이력은 코드 주석에 쓰지 않는다. 허용목록(외부 제약, 단위·경계, 순서 의존, 공개 API 계약, 테스트 봉인 1줄)만, 5줄 이하.

## 구현 계획 (조정 팝오버)

> 2026-11-19 architect. 정본은 PRD R20~R26(사용자 발화 포함)과 R1~R19, ADR 결정 19(화면 배치 = design-adjust.html 대안 A "2단 교체 팝오버")와 그 앞 결정이다. 이 절은 코드 지도·조정 선택지 계약·적용 계약·삭제/유지 목록·작업 분해만 담는다.

### 코드 지도(조정 팝오버 관련, 현재)

- 카드 줄: `src/app/components/CardItem.tsx`(줄 클릭 = 펼침 `onToggle`, 결과 칸 `VariableTag` = "변동 가능", 펼친 상세 = `DetailItem`·`RowDetail`·`PairDetail`·`CustomEditor`). 펼침 상태·상세 수요·이동(reveal) 펼침은 `ResultPanel.tsx`(`expanded`, `detailSig → onDetailCards`, `revealTarget`).
- 상세 화면: `RowDetail.tsx`(칸 띠·경계 범례·목표 문구·합계 띠·`LockMarks`·`LockBranchList`·`BelowLockKey`), 스타일 `lockRow.css`(갈래 줄·고정 미달·`.lock-outside`·스피드 배지 고정 표지)와 `src/index.css`의 상세 규칙. `LockBranchList`는 스피드 배지 상세(`SpeedBadgeDetail.tsx`)도 쓴다.
- 갈래 줄 산출: `cards/assemble.ts` `singleBranches`·`pairBranches`·`branchLine`·`noDropLine`·`lineHead`·`othersById`·`stageOf`, `RowLockView.branches`, `CellView.belowLock`(`cellViews` floor). 수요: `cards/schedule.ts cardLockDemand`(`rowDemand`·`filterDemand`) → `app/executor.ts lockDemandOf`.
- 갈래 재사용 부품(남김): `schedule.ts otherBranches`·`branchEquivalent`·`lockedHp`·`taskKey`·`rowJudgements`, `target.ts firstCellAt`·`cellLabel`, `stairs.ts minSumWithFloors`, `lock.ts Branch`·`branchBudget`.
- 후보 수요 경로(핀과 같음): `TabAssembler.candidates(results, cardIds)` → `executor.setDetailCards(tab, ids)` ← `ProductApp pushLockDemand({ detail, pin })` ← `lockContext onDetailCards·onPinMenu`.
- 상태: `app/state.ts`(`commit-sp`·`set-lock-base`·`fit-locks`, `lockTrim` 알림, `armFit`), 상한·초과 조정 `app/spLimit.ts fitUnlocked`, 성격 토글 `src/ui/natureToggle.ts togglePlus·choiceOf·natureIdFor`, 알림 표시 `MySetPanel.tsx lock-trim`(고정이 없어도 보인다).

### 조정 선택지 계약(도메인, `src/cards/adjust.ts` + `types.ts`)

카드 하나(보이는 배분·기술·조건·도구 변형)의 조정 모델을 조립 단계에서 만든다. 새 판정 규칙은 없고, 기존 행 작업 결과(성격 변형 스윕·갈래 재스윕·쌍 최소 조합·계단)만 읽는다.

**타입(`types.ts`)**

```ts
export interface AssembleOptions { lockControls?: boolean; adjust?: boolean } // adjust = CardView.adjust를 낸다(실행기만 켠다)
export interface CardView { /* … */ adjust?: AdjustView }                  // 변동 가능(variable) 카드만
export interface AdjustView {
  /** ready = 목록 확정, computing = 결과 대기(tasks), locked = 조정할 능력치가 모두 고정 */
  state: 'ready' | 'computing' | 'locked'
  tasks?: readonly RowTask[]
  /** 2단 성격 선택지(순서 고정): 무보정 → v 상승 → (방어 3방향) 반대쪽 상승 */
  natures: readonly AdjustNature[]
  /** 1단 결과 목록: 그 탭 관점 좋은 결과부터(공격 확정1타→확정견딤, 방어 확정견딤→확정1타). 예산 안에서 닿는 것만 */
  results: readonly AdjustResult[]
  /** 적용 때 줄이지 않는 능력치 = 조정 능력치 ∪ 판정이 의존하는 고정 밖 능력치(dependsOn) */
  keep: readonly StatId[]
  /** 무고정 적용의 성격 확인용: 그 판정에 관여하는 내 능력치(v 포함) */
  relevant: readonly StatId[]
}
export interface AdjustNature {
  id: 'neutral' | 'plus' | 'other-plus'
  /** 이 선택지의 상승 능력치(무보정 null) */
  plus: Exclude<StatId, 'hp'> | null
  /** 판정에 쓴 성격 id */
  nature: string
  /** 적용 뒤 기준 갈래 id(고정 없으면 null) */
  branchId: string | null
  /** 적용 뒤 활성 고정 능력치의 고정 SP(그 갈래 lockedSp, 고정 없으면 빈 객체) */
  lockedSp: Readonly<Partial<Record<StatId, number>>>
  /** 그 갈래가 파생에 없음(다른 고정에 무보정안 없음·하락 자리 없음·SP 합 66 초과). 모든 결과에서 꺼진다 */
  off?: 'no-branch'
}
export interface AdjustResult {
  label: RollTier
  /** 카드 현재 결과와 같음("현재" 표시) */
  current: boolean
  /** natures와 같은 순서·길이 */
  options: readonly AdjustOption[]
  /** 1단 SP 표기에 쓰는 선택지 index(목록 자격을 준 첫 ok 선택지) */
  lead: number
}
export type AdjustOption =
  | { kind: 'ok'; stats: readonly AdjustStat[] }
  | { kind: 'off'; reason: 'unreachable' | 'budget' | 'no-branch' }
/** 표기 순서 STAT_ORDER(H→A→B→C→D→S). locked = 고정 능력치(값은 그 갈래 고정 SP), plus = 그 선택지 상승 */
export interface AdjustStat { stat: StatId; sp: number; plus: boolean; locked: boolean }
```

**선택지 규칙(`adjustView`, 단일 출처)**

- 대상: 보이는 항목이 공격 스윕 행(v = 스윕 능력치)이거나 방어 극단 필터를 통과한 쌍(v = 필터 `stats[1]`, H 포함)이고 `card.variable`일 때만. 그 밖(변동 없음·고정 판정·계산 불가)은 `adjust` 없음 → 버튼 없음(R21).
- `locked`: 공격은 v가 활성 고정 능력치, 방어는 v가 활성 고정 능력치(그러면 H도 고정)일 때. 버튼은 보이되 비활성 + 사유(아래 "해석" 참조).
- 고정 없음(`plan.lock` 없음): 선택지 2개. 무보정 = `spec.natures.neutral`, 상승 = `spec.natures.plus`, `branchId: null`, `lockedSp: {}`. 조정 능력치: 공격 [v], 방어 [hp, v].
- 고정 계획(main, 파생 d·기준 b0): `other` = 방어의 반대쪽 B/D, `sideLocked` = 방어이고 `other`가 활성 고정(이때 H도 고정).
  - 무보정: 갈래 = (`sideLocked` 이고 `b0.plus === other`) ? `'out'` : b0. 변형 neutral.
  - v 상승: 갈래 `'out'`, 변형 plus. 기준이 상승안을 쓰는 고정(예: S16+)은 'out' 갈래에서 무보정안(S29)으로 바뀐다 = R23 자동 전환. 'out'이 파생에 없으면(그 고정에 무보정안 없음·66 초과) `off: 'no-branch'`.
  - (`sideLocked`만) 반대쪽 상승: 갈래 `plus:<other>`, 변형 neutral(v는 보정 없음).
  - 판정 성격: 갈래 = b0이면 `spec.lock.strict[변형]`, 아니면 `otherBranches(plan, d.branches, v, relevant, dependsOn)`의 그 갈래 `strict[변형]`(+`sp` 덮어쓰기). 목록에 없으면(하락 자리 없음) `off: 'no-branch'`. 성격이 null이면 그 선택지의 모든 결과가 `unreachable`.
  - 조정 능력치: 공격 [v], 방어(`sideLocked` 아님) [hp, v], 방어(`sideLocked`) [v](H = 그 갈래 `lockedSp.hp` 고정).
- 예산: `budget = spTotal − 갈래.lockedSum − Σ(dependsOn 중 고정 밖·조정 밖 능력치의 표시 SP)`, 고정 없으면 lockedSum = 0. 고정 밖 다른 능력치의 현재 SP는 예산을 막지 않는다(R22). 능력치당 상한 spMaxPerStat.
- 순위 r의 최소 SP(그 변형·갈래, r = `tierRank(side, label)`):
  - 공격: 칸 = 고정 없음·b0 → `rowJudgements().neutral/plus`; 다른 갈래 → `branchEquivalent`이고 `sp` 덮어쓰기가 없으면 b0 칸 재사용, 아니면 `{ kind: 'branch', rowId, nature, sp? }` 결과(없으면 대기). 최소 SP = `firstCellAt('attack', 칸, r)?.sp`, 비용 = 그 SP.
  - 방어(`sideLocked` 아님): 고정 없음·(b0이고 계단 모드 아님) → `{ kind: 'pair', filterId, nature: 변형 }` 결과의 `atLeast` 순위 r 점(H, B/D); 다른 갈래 → 재사용 조건(`pairBranches`와 같음) 아니면 `{ kind: 'stairs', filterId, nature, rank: r, hpMin: 0, sp? }` → `minSumWithFloors(stairs, { hp: 0, defense: 0 })`. 비용 = H + B/D. r = 0(확정1타)은 작업 없이 (0, 0).
  - 방어(`sideLocked`): `{ kind: 'stairs', filterId, nature, rank: r, hpMin: H0 = 그 갈래 lockedSp.hp, sp? }`의 `stairs[H0]`(null = 닿지 않음). 비용 = B/D. b0이면 기존 `baseStairsTasks` 키와 같아 캐시를 공유한다.
  - 결과 오류·비단조 계단은 그 칸 `unreachable`(탭을 멈추지 않는다).
- 칸 판정: 순위 r에서 선택지 o가 `ok` ⇔ 최소 SP가 있고 비용 ≤ budget(조정 능력치 각각 ≤ 상한). 최소 SP가 있으나 예산 밖이면 `budget`, 0~최대에서 없으면 `unreachable`, 갈래 없음이면 `no-branch`.
- 목록 자격: o가 r을 "정확히" 낸다 ⇔ ok이고, o의 r보다 좋은 ok 순위가 없거나 그중 가장 가까운 순위의 비용보다 r의 비용이 작다(건너뛰어지는 결과·같은 비용 낮은 결과는 빼서 그 결과의 최소 SP로 줄이는 뜻이 살게). 결과 r은 자격을 주는 선택지가 하나라도 있으면 목록에 든다. `lead` = 자격을 준 선택지 중 SP가 가장 적은 것(검증 패스 수정 2026-11-20). 2단은 모든 선택지를 보이되 그 결과를 정확히 내지 않는 선택지(더 좋은 결과로 건너뛰는 것 포함)는 `unreachable`로 비활성.
- `current` = 카드 대표 행 현재 칸 범주(`cellLabel(side, headline row current)`)와 같은 결과.
- 대기: 필요한 결과가 하나라도 없으면 `state: 'computing'`, `tasks` = 없는 작업(중복 제거, 결과 맵에 있는 것 제외). `results`·`natures`는 대기 중에도 비워 둔다.
- 수요: `TabAssembler.candidates(results, cardIds)`가 그 카드 `view.adjust.tasks`도 낸다(`branch` → stage4, `stairs`·`pair` → stage5). 팝오버를 연 카드만 `cardIds`에 든다(핀 메뉴와 같은 경로). `buildCard`는 `options.adjust`일 때만 `adjust`를 붙인다 → `buildTabView`(옵션 없음) 지문은 봉인 그대로(결정 18).

### 적용 계약(앱)

- 리듀서 액션(`state.ts`, 게임을 모른다):

```ts
| {
    type: 'apply-adjust'
    /** 조정 능력치의 새 SP(고정 능력치 키는 무시) */
    sp: Readonly<Partial<Record<StatId, number>>>
    /** 새 성격·자동 하락 표지(없으면 그대로) */
    nature?: Pick<SetDraft, 'nature' | 'natureMinusAuto'>
    /** 고정 중 고를 기준 갈래 id(없으면 그대로, 고정이 없으면 무시) */
    lockBase?: string
    /** 적용 뒤 기준 갈래의 활성 고정 능력치 SP(AdjustNature.lockedSp) */
    lockedSp: LockedSp
    /** 줄이지 않을 능력치(AdjustView.keep) */
    keep: readonly StatId[]
    rules: SpRules
  }
```

- 리듀서 동작: 조정 SP를 0~spMaxPerStat 정수로 초안에 쓰고(고정 능력치 키는 버림, 고정 능력치 초안 값 = 해제 복원값은 그대로), 성격·`lockBase`를 바꾸고, `fitUnlocked(sp, lockSpTotal ?? rules.spTotal, { ...lockedSp, 문제 고정 능력치는 초안 값, keep 능력치는 새 값 })`로 고정·조정 밖 능력치를 H→A→B→C→D→S 순서로 줄여 `lockTrim`에 남긴다(R24, R19와 같은 알림). 바뀐 게 없으면 상태 그대로, 있으면 세대 +1 한 번, `lockFit = null`(대기 중인 자동 조정을 지운다: 같은 규칙으로 이미 맞췄다). 다시 파생해 맞추는 2차 세대 루프를 만들지 않는다.
- 액션 생성(`src/app/adjustAction.ts`, 순수): `adjustAction({ game, draft, derivation, view, result, option }): AppAction | null`(`ok`가 아니면 null).
  - 성격: 무보정 = 초안 상승이 조정 성격 능력치(v, 3방향이면 v·other)면 상승 없음(`withChoice({ minusAuto: false })`과 같은 결과), 아니면 성격 생략. v 상승 = 초안 상승이 v가 아니면 `togglePlus(game, choice, v, moveIds)`(하락 자동 규칙), 맞으면 생략. 반대쪽 상승 = 성격 생략(기준 갈래로만 고른다).
  - 고정이 없을 때만 확인: 만든 성격과 `AdjustNature.nature`가 `view.relevant` 능력치에서 보정 부호가 다르면 `{ nature: AdjustNature.nature, natureMinusAuto: false }`로 대신한다(자동 하락이 판정 관여 능력치에 떨어져 고른 결과가 안 나오는 일을 막는다). 고정 중에는 계획이 `rowNature`로 하락을 관여 밖으로 옮기므로 상승만 맞으면 된다.
  - `lockBase` = `derivation`이 있고 `AdjustNature.branchId !== derivation.baseId`일 때만.
  - `sp` = 그 선택지 `stats` 중 `locked`가 아닌 것.
- 화면 문맥(`lockContext.ts`): `LockUi.applyAdjust(view, result, option)`(위 액션을 만들어 dispatch), `LockUi.onAdjustCard(tab, cardId | null)`(팝오버 열림 수요). `ProductApp pushLockDemand`의 `detail` 칸을 `adjust`로 바꿔 `pin`과 합쳐 `executor.setDetailCards`에 알린다.

### 화면 계약(대안 A, R20·R21·R23·R26)

- 카드 줄은 펼치지 않는다: `card-line` 클릭·`card-toggle`·`card-chev`·`card-detail` 제거. 이름 칸은 버튼이 아니다. `li`에 `data-move`(보이는 판정 행 기술 id)를 단다(E2E·이동이 카드 줄로 찾는다).
- 결과 칸의 `VariableTag` 자리에 `조정` 버튼(`data-testid="adjust-button"`, 읽기 이름 "조정: <상대 이름>", `aria-haspopup="menu"`, `aria-expanded`). `adjust.state === 'locked'`이면 `aria-disabled` + 사유(툴팁·`aria-describedby`). 배분 선택 목록 안의 작은 "변동 가능" 표지(`variable-mark`)와 기술 메뉴 변동 표시는 그대로.
- 팝오버(`AdjustPopover.tsx`, `adjust.css`, `cut-pin-menu` 모양 재사용): 1단 `role="menu"` "조정할 결과" 목록, 항목 = 결과 배지(`ko-badge` 톤 재사용) + lead SP("C28", "H20 B10", 상승은 "C20+") + "현재" 표지 + "›". 대기 중이면 비활성 "계산 중…" 항목 하나. 결과를 고르면 같은 자리가 2단으로 바뀐다: 머리줄 "‹ 뒤로" 버튼 + 고른 결과 배지 + lead SP, 제목 "성격 선택", 항목 = 선택지 이름(무보정 / "<능력치> 상승"·방어 3방향 "B 보정"/"D 보정") + 모든 `stats`(고정 능력치는 자물쇠 표지 + 청록 `--c-lock` 톤, 상승은 "+"). `off` 항목은 `aria-disabled` + 짧은 사유(`budget` "SP 부족", `unreachable` "닿지 않음", `no-branch` "고정과 겹침").
- 키보드(R26): 열면 첫 고를 수 있는 항목에 포커스, ↑↓·Home/End 이동, Enter·Space 선택, 2단에서 ← 또는 "‹ 뒤로" = 1단(고른 결과에 포커스), Esc = 닫고 조정 버튼으로 포커스, Tab = 닫기. 바깥 누름 = 닫기. 적용하면 닫고 같은 카드의 조정 버튼(없으면 탭 패널)에 포커스. 아래 공간이 모자라면 위로 연다(`CutPin`과 같은 규칙), 320px에서 `max-width: calc(100vw - 2rem)`로 잘리지 않는다. 열려 있는 동안 `onAdjustCard(tab, card.id)`, 닫히면 `null`.
- 상세에만 있던 안내를 카드 줄로(R20): 도구 변형("<도구> 지닌 경우")은 도구 아이콘 툴팁·읽기 이름, 하락 경고(`RowLockView.dropWarning`, "하락 위치에 따라 달라질 수 있음")는 결과 배지 툴팁·읽기 설명, 행 계산 불가 사유는 "계산 불가" 배지 툴팁·읽기 설명, 기술 참조 표기(`rowRefsNote`)는 기술 칸 툴팁. 성격 변형 확인 중 문구는 버린다(조정 버튼이 계산 중을 보인다).
- 이동(R14 reveal): 펼침 대신 대상 카드로 스크롤하고 그 카드 핀에 포커스(`revealTarget`·`lockedBy` 그대로).

### 지우는 것

- 화면: `RowDetail.tsx` 전체(`RowDetail`·`PairDetail`·`DetailItem`·`Band`·`TargetText`·`SumBand`·`TierChip`·`RowStatus`·`LockChip`·`LockMarks`·`BelowLockKey`)와 `RowDetail.test.tsx`. `CardItem`의 펼침(`expanded`·`onToggle`·`card-detail`·`card-chev`), `ResultPanel`의 `expanded` 상태·`detailSig` 효과·reveal 펼침. `index.css`의 상세 전용 규칙(`.card-detail`·`.detail-grid`·`.bundle-panel`·`.band`·`.rows`·합계 띠·`.card-chev`·`.card.open` 등 — 지우기 전에 다른 소비자를 grep), `lockRow.css`의 `.below-lock` 규칙.
- 문구(`lockText.ts`): `BELOW_LOCK_TEXT`, `BranchLine` 전용 분기(공용 `AnyLine`은 `SpeedBranchLine`만), 쓰이지 않게 되는 상수. 테스트도 함께.
- 도메인: `RowLockView.branches`, `BranchLine`·`BranchOption` 타입, `CellView.belowLock`, `assemble.ts`의 갈래 줄 산출(`singleBranches`·`pairBranches`·`branchLine`·`noDropLine`·`lineHead`·`othersById`·`stageOf`)과 `cellViews` floor, `schedule.ts cardLockDemand`·`rowDemand`·`filterDemand`, `executor.ts lockDemandOf`의 `cardLockDemand` 합치기, `index.ts` export. 관련 테스트(`assemble-lock.test.ts` 갈래 줄·고정 미달, `lock-acceptance.test.ts` 갈래 줄 기반 AC2, `schedule`·`executor-lock` 갈래 줄 수요).
- E2E: 갈래 줄(`lock-branch`)·고정 미달(`below-lock`)·칸 띠·목표 문구·합계 띠·상세 펼침을 전제로 한 단언. `openCard`·`openCards` 도우미.

### 남기는 것

- 컷 고정 핀(`CutPin`·`CardLockPin`·`LockControl`·후보 계산·`candidates` 수요), 고정 목록(`LockList`), 고정 SP 줄·성격 ▲ 기준 갈래(`MySetPanel`), 이동(reveal)·필터 밖 안내(`.lock-outside`, `lockRow.css` 유지 — 소비자 import로 옮긴다), 합계 초과 경고, 해제 복원·자동 조정(`fit-locks`).
- 파생·레인·계획: `deriveLocks`·`checkLockCandidate`·`branchBudget`·`budgetMark`(스피드 갈래 줄이 씀), `lockNature`, `stairs`, `lockLane`, `lockTarget`, `otherBranches`·`branchEquivalent`·`lockedHp`·`baseStairsTasks`, `RowLockView.control·lockedBy·dropWarning`, 행 작업 `branch`·`stairs`·`pair`.
- 스피드 탭 전부(R20 "스피드 탭 차트는 그대로"): 배지 상세의 갈래 줄(`speedBranchLines`·`SpeedBranchLine`·`LockBranchList` → 새 파일 `LockBranchList.tsx`로 옮겨 `lockRow.css`를 import), "(다른 능력치에서 n 필요)"·"SP 부족(m)" 문구(`budgetText`).
- 기존 조립 산출물(`RowView.target`·`cells`·`boundaries`·`CardView.pair.band`): 대표 행·정렬·골든·무고정 봉인이 쓰고, 쌍 결과는 무고정 방어 조정이 읽는다. 화면 소비자가 없어진 목표·합계 띠 산출의 정리는 봉인 재생성이 필요해 후속으로 둔다.

### 빌드 해석(사용자 확인 대상, 구현은 아래대로)

- 조정할 능력치가 모두 고정이면(공격 v 고정, 방어 그 쪽 B/D 고정) 버튼은 보이되 비활성 + "고정된 능력치라 조정할 수 없음". R21은 "변동 없음 카드만 버튼 없음"이라 숨기지 않는다.
- 사용자 지정 상대 카드의 프리셋 편집(`CustomEditor`)은 상세에만 있었다. 기능을 잃지 않게 사용자 지정 카드에만 카드 줄 "프리셋 편집" 토글(`aria-expanded`)을 두고, 펼침 영역에는 `CustomEditor`만 둔다(판정 상세는 없다).
- 스피드 배지 상세의 갈래 줄·n 문구는 R20("스피드 탭 그대로")에 따라 남긴다. R25의 갈래 줄 제거는 공격·방어 상세 범위로 읽었다.
- 판정이 의존하는 고정 밖 능력치(dependsOn)는 예산에서 빼고 적용 때 줄이지 않는다(줄이면 고른 결과가 안 나온다). 보통 비어 있어 R22와 같다.
- 다른 고정의 SP가 자동 전환으로 바뀌면 2단 항목에 그 고정 능력치 값도 자물쇠 표지로 보인다(예: "C20+ · S29"). 방어 3방향은 R23대로 H·B·D를 늘 보인다.
- PRD AC1 둘째 줄(방어 탭 갈래 두 줄)·AC2·AC9 뒷부분·AC15·AC16 셋째 줄은 R25로 화면 근거가 사라졌다. E2E는 그 단언을 지우고 R20~R26 단언으로 바꾼다(PRD·ADR 문구 정리는 문서 담당 몫).

### 작업 분해(레이어 · 파일 경계)

| 레이어 | 작업 | 파일 |
| --- | --- | --- |
| L1 | A1 조정 도메인(추가만) | `cards/adjust.ts`(새)·`adjust.test.ts`(새)·`adjust-acceptance.test.ts`(새), `cards/types.ts`, `cards/assemble.ts`, `cards/index.ts`, `app/executor.ts`, `app/executor-lock.test.ts` |
| L1 | A2 적용 리듀서 | `app/state.ts`, `app/state-adjust.test.ts`(새) |
| L2 | A3 화면(팝오버·상세 제거) | `CardItem.tsx`, `AdjustPopover.tsx`(새)·`AdjustPopover.test.tsx`(새), `adjust.css`(새), `ResultPanel.tsx`, `RowDetail.tsx`·`RowDetail.test.tsx`(삭제), `LockBranchList.tsx`(새), `SpeedBadgeDetail.tsx`, `lockRow.css`, `src/index.css`, `lockText.ts`·`lockText.test.ts`, `e2e/helpers.ts` |
| L2 | A4 앱 배선·갈래 줄 도메인 삭제 | `app/adjustAction.ts`(새)·`adjustAction.test.ts`(새), `app/lockContext.ts`, `app/ProductApp.tsx`, `cards/assemble.ts`, `cards/types.ts`, `cards/schedule.ts`, `cards/index.ts`, `app/executor.ts`, `cards/assemble-lock.test.ts`, `cards/lock-acceptance.test.ts`, `cards/schedule.test.ts`, `app/executor-lock.test.ts` |
| L3 | A5 E2E(무고정·일반) | `e2e/product-adjust.spec.ts`(새), `e2e/product.spec.ts`, `product-layout`·`product-berry`·`product-myset`·`offline`·`smoke`·`product-rank`·`product-movetype`·`product-power-item`·`product-move-variable`·`product-toolbar`·`product-images`·`speed-chart`·`speed-chart-a11y` spec |
| L3 | A6 E2E(컷 고정·성능) | `e2e/product-cut-lock.spec.ts`, `e2e/product-perf.spec.ts`, `src/app/perf.ts` |

- 같은 레이어 동시 편집 중에는 상대 작업 소유 파일의 일시적 타입 오류가 날 수 있다(L2의 `BranchLine` 삭제 ↔ `RowDetail.tsx` 삭제). 각 작업은 자기 파일의 vitest로 확인하고, 레이어 끝에서 `npx tsc -b`·`npm run lint`·`npm run test:run`이 모두 통과해야 한다.
- 무고정 동일성 봉인(`acceptance/no-lock-identity.test.ts`)은 어느 작업도 다시 만들지 않는다. 깨지면 결함이다.

### 위험

- 비용 단조 가정: 공격 칸·쌍 최소 합은 순위가 오를수록 비용이 줄지 않는다고 보고 "정확히 내는 결과"를 고른다. 비단조 칸이 나오면 결과가 빠질 뿐 틀린 SP를 내지는 않게(각 칸의 최소 SP는 그 순위 "이상"의 실제 최소) 단위 테스트로 고정한다.
- 갈래 전환 적용 뒤 파생이 다시 돌면 고정 SP가 바뀔 수 있다(레인 성격은 내 성격 하락만 다를 때 같다). 적용 리듀서는 고른 갈래의 고정 SP로 한 번만 맞추고, 이후 재계산 초과는 기존처럼 경고만 한다(R19와 같은 경계).
- 팝오버를 연 동안 세대가 바뀌면 같은 카드 id의 새 `adjust`로 다시 그린다. 2단에서 고른 결과가 목록에서 사라지면 1단으로 돌아간다.
- E2E 대량 수정: 상세 단언을 지울 때 같은 요구(판정·정렬·필터)를 카드 줄 단언으로 옮길 수 있으면 옮기고, 화면에서 사라진 정보만 지운다.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

- G 후보(행 성격 정규화 누락): 고정 중 행마다 하락을 다시 정하지 않고 갈래 성격을 그대로 쓰면 하락이 보는·관여 능력치에 떨어져 손 세트와 다른 표가 나온다. 계획·행·레인·스피드 최소 SP·패널이 모두 `lockNature` 한 규칙을 써야 한다.
- G 후보(합계 강등 누락): 고정 중 합계 66 초과는 정상 상태다. `ignoreSpTotal`을 빠뜨린 호출처(계획 검증·랭크 수단·스피드 코어·패널 실능치) 하나가 그 표시만 조용히 지운다. E2E "합계 78" 시나리오로 세 탭을 연다.
- G 후보(실행/리듀서 세대 혼용): 세대 비교 지점(실행기 `setInput`, `ResultPanel`·`SpeedTab` generation, 사유 필터)에 리듀서 세대를 넘기면 스피드 해석만 바뀐 실행에서 결과 교체를 오판한다. 실행 세대(`runGeneration`)만 쓴다.
- G 후보(후보 계산 작업 미소비): 고정 후보가 `{ kind: 'computing', tasks }`를 내도 그 작업을 수요로 스케줄하는 곳이 없으면 조작이 영원히 "계산 중"이다(방어 쌍 후보, 기준 갈래가 v 상승을 막는 공격 후보). 후보 작업은 상세 수요에 합쳐야 한다.
- G 후보(고정 조작 노출 조건): 실행기 조립기에 `lockControls`를 넘기지 않으면 고정이 하나도 없을 때 공격·방어 탭에 "컷 고정" 조작이 없어, 첫 고정은 스피드 탭에서만 걸 수 있다.
- G 후보(제품 화면의 메가 전환): 제품 화면은 메가를 종 이름(예: "메가한카리아스")으로 고르므로 종 id가 바뀌어 `switch-species`가 고정을 지운다. 리듀서의 `from === to` + `mega` 경로는 제품 화면에서 닿지 않는다.
- G 후보(E2E 로케이터): 고정 목록 머리에 계산 중 표지("계산 중…")가 붙어 목록 영역 이름이 바뀐다. 영역을 정확한 이름 "컷 고정"으로 찾으면 계산 중에 목록이 없는 것처럼 보인다(`e2e/helpers.ts lockList`는 정규식).

## 검증

2026-11-18 최종(검증 결함 수정 뒤, 오케스트레이터 재실행). 4173 포트를 다른 작업 트리의 미리보기 서버가 쓰고 있어 E2E는 포트만 4183으로 바꾼 임시 설정 사본으로 돌렸다(내용 동일, 실행 뒤 지움).

- `npx tsc -b` 통과, `npm run lint` 통과, `npm run test:run` 82 파일 1465 통과.
- E2E 전체(desktop + mobile-320 @layout) 153건 중 152 통과·1 실패 → 실패 1건은 기존 `e2e/product.spec.ts` "펼친 상세" 테스트의 "상세에 버튼 0개" 가정이 R2(고정이 없어도 판정 행 상세에 컷 고정 토글)와 충돌한 것. 기대값을 "컷 고정 토글 외 버튼 0개"로 고친 뒤 재실행 통과.
- 단위 테스트 기본 타임아웃을 30초로 올렸다(`vite.config.ts`). 실데이터 전체 스윕 테스트가 병렬 CPU 경합에서 5초를 넘는다(단독 약 2초).
- 성능(`e2e/product-perf.spec.ts` "컷 고정 3개", chromium 156.0.8078.4, 미리보기 빌드, 무고정/고정 각 5회 교대). 고정 3개 = 스피드(나인테일 152, 상위 N 밖) + 공격(한카리아스 드래곤클로) + H 포함 방어 쌍(한카리아스 드래곤클로).
  - 공격 탭 첫 결과: 무고정 중앙값 18ms, 고정 34ms, 배수 1.89.
  - 방어 탭: 무고정 13ms, 고정 8ms, 배수 0.62.
  - 스피드 탭: 무고정 7ms, 고정 6ms, 배수 0.92.
  - 계산 구간 Long Task 최대: 무고정 0ms / 고정 0ms(기준 100ms). 기준 갈래 전환 첫 결과 33ms, 완료 896ms.
  - 고정 레인(캐시 없음): 공격 작업 2개·판정 66회·3ms, 방어 쌍(H 포함) 작업 2개·계단 H 칸 66개·3ms.
- AC2 수동 대조 1건(메가라이츄Y, 메가눈여아 S32 상승 189 고정 → S23+만): 갈래 줄 "S23+일 때: 고난수1타 최소 H2 B24"가 손 세트(S23·명랑·나머지 0) 방어 탭 같은 카드의 무보정 선택지 H2 B24와 같다.
- AC1 두 줄 확인은 준속 120족(포푸니크 S32 무보정 172, "S8+ / S23 고정")으로 했다. 최속 120족(189)은 무보정 S32로 닿지 않아 갈래가 하나다.
- 구현 중 검증 패스(ADR 정합·코드리뷰 렌즈)가 찾은 BLOCKER 9건을 모두 실패 테스트 우선으로 고쳤다: 고정 0개일 때 컷 고정 조작 없음, 방어 쌍·공격 후보 "계산 중" 고착, 메가 전환 시 고정 삭제, 성능 spec H 시나리오 누락, 이동 재요청 무시, 고정 배지 상세의 "예산 초과" 문구, 부분 해제 복원 계산, SP 상한(limitOf). 추가로 H 고정 시 쌍 작업이 스케줄되지 않던 결함을 E2E로 찾아 고쳤다.

### 핀 개정 후 재검증(2026-11-19)

- 하네스 게이트 통과(artifact·lint·build·`test:run` 83 파일 1471 통과).
- E2E 전체 160건 중 159 통과·1 실패 → 실패는 `speed-chart-a11y.spec.ts` "알림 영역"의 시각 비교(알림 기록이 pointerup보다 0.1ms 앞섬). `performance.now()` 100µs 거칠게 맞춤·지터로 같은 순간의 두 기록이 뒤집히는 것이라 기능 결함이 아니다(핀 개정 전에도 한 번 같은 실패). 허용치 1ms를 두고 그 spec을 4회 반복해 24건 모두 통과.
- 성능(고정 3개: 스피드·공격·H 포함 방어 쌍): 공격 1.82배, 방어 0.53배, 스피드 0.90배(기준 3배), Long Task 0ms.
- 후속(이번 범위 밖): 고정 직후 재계산 약 0.7초 동안 방어 카드가 목록에서 잠깐 빠졌다 돌아온다. 400px에서 메가한카리아스 카드 1장의 이름 줄이 높아진다.

### 조정 팝오버(2026-11-20)

R20–R26(결정 19, 대안 A 2단 교체 팝오버) 구현 뒤 최종 게이트. E2E는 이전과 같이 포트만 4183으로 바꾼 임시 설정 사본(`reuseExistingServer: true`)으로 돌리고 실행 뒤 지웠다.

- `npx tsc -b` 통과, `npm run lint` 통과, `npm run test:run` 87 파일 1514 통과.
- E2E 전체(desktop 171 + mobile-320 @layout 4) 175건 모두 첫 실행에 통과(20.5분, 재시도 없음). 이번에 더한 `e2e/product-adjust.spec.ts` 10건(R21–R24·R26, 320px 팝오버 1단·2단 잘림·가로 스크롤 포함)과 `e2e/product-cut-lock.spec.ts`의 R22–R24 고정 중 조정·자동 전환 4건이 들어 있다. 아코디언 상세를 지운 것에 맞춰 `e2e/product.spec.ts`의 "펼친 상세" 테스트들은 "카드는 펼치지 않는다(R20, 이름 칸에 `aria-expanded` 없음)" 테스트로 바뀌었다.
- 성능(`e2e/product-perf.spec.ts` "컷 고정 3개", chromium 156.0.8078.4, 미리보기 빌드, 무고정/고정 각 5회 교대, 기준 3배·Long Task 100ms):
  - 공격 탭 첫 결과: 무고정 19ms, 고정 48ms, 배수 2.58(이전 1.82–1.89보다 커졌다. 기준 안이지만 여유가 줄었다).
  - 방어 탭: 무고정 14ms, 고정 4ms, 배수 0.32.
  - 스피드 탭: 무고정 7ms, 고정 6ms, 배수 0.84.
  - 계산 구간 Long Task 최대: 무고정 0ms / 고정 0ms. 기준 갈래 전환 첫 결과 33ms, 완료 841ms.
  - 조정 팝오버 처음 열기(고정 3개): 공격 탭 pelipper 17ms, 방어 탭 floettemega 11ms, Long Task 0ms.
  - 고정 레인(캐시 없음): 공격 작업 2개·판정 66회·3ms, 방어 쌍(H 포함) 작업 2개·계단 H 칸 66개·3ms.
- 미검증: 실제 터치 기기의 팝오버 조작(320px은 데스크톱 Chrome 뷰포트 에뮬레이션), 화면 읽기 프로그램 실기 낭독(aria 속성만 E2E로 확인).

### 빌드 중 ADR 해석 차이(구현 보고)

- 결정 12 "쌍 대신 계단만": 목표·갈래 줄은 계단으로 내지만, 합계 띠 표시를 위해 계단 모드에서도 쌍 작업을 함께 돌린다.
- 무고정 동일성(결정 18): 카드 층 지문(`buildTabView` 옵션 없음)은 변경 전 봉인과 같다. 실행기 뷰는 R1·R2 때문에 고정이 없어도 컷 고정 조작(`lock.control`)을 싣고, 화면에는 판정 행 상세의 컷 고정 토글이 새로 보인다.

## 후속 작업

- 여러 컷 동시 만족 배분의 자동 탐색(기능 3과 연결).
- 고정의 새로고침 후 보존·세트 저장과 연계.
