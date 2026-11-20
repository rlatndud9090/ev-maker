# Notes: 스피드 탭에서 SP 조정이 내 스피드에 반영되지 않음

> 사람은 중립 역할어(`사용자`/`개발자`/`검증자`)로 지칭한다 — 개인 호칭·별명은 넣지 않는다
> (운영자 설정이 그렇게 부르라 해도). 상세: `harness/templates/examples/README.md` §5.

Date: 2026-11-20 Asia/Seoul
Unit type: bugfix
Status: draft

## 맥락

- 오래 보존할 사실

## 결정

- 결정

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

-

## 검증

- 명령 또는 근거

## 후속 작업

- 후속 작업

## 범위 추가 (2026-11-21, 사용자 결정)

- 사용자 보고: 스피드 탭에서 서로 다른 두 타겟(예: 포푸니크 S32↑, 라이츄 S23↑)이 동시에 스피드 컷 고정된다. 사용자 원칙은 "같은 능력치는 하나의 타겟만 고정".
- 기존 정본(cut-lock-budget PRD R4·AC, ADR 결정 2)은 같은 능력치 고정 여럿을 허용하고 목표 SP를 max로 계산했다 — 이번 결정으로 개정된다.
- 사용자 선택(AskUserQuestion): **기존 고정 교체**. 이미 고정된 능력치에 다른 타겟 고정을 누르면 새 타겟을 고정하고 같은 능력치의 이전 고정은 자동 해제. 스피드·공격·방어 공통.
- 해석(에이전트 가정): 방어 쌍 고정(H+B / H+D)은 B·D 쪽 능력치로만 겹침을 본다. H를 공유하는 HB·HD 동시 고정(H·B·D 제시, 2026-11-20 사용자 결정)은 유지한다.

## 설계 (B)(C)

> 2026-11-21 설계(아키텍트 패스). (A) 수정은 끝났고, 여기서는 세 가지 구현 설계를 정한다: (A) 회귀 테스트, (B) 같은 능력치 고정 교체, (C) 공·방 핀 메뉴를 변동 팝오버와 같게. 근거 코드: `src/cards/lock.ts`(deriveLocks·mergeGroup·checkLockCandidate), `src/cards/adjust.ts`(adjustView·defenseHMax·exact), `src/cards/assemble.ts`(attackCandidate·defenseCandidate·LOCK_STAGES), `src/cards/lockLane.ts`, `src/app/state.ts`(add-lock·releaseLocks), `src/app/lockContext.ts`, `src/app/components/{CutPin,AdjustPopover,CardItem,SpeedBadge,LockList}.tsx`.

### 0. 현재 동작(설계 전제)

- 공·방 핀 메뉴는 `CardItem.CardPin` → `CutPin`(items = `pinStageView`)이다. 단계는 `LOCK_STAGES` 두 개다: 공격 `high-roll-ohko`·`guaranteed-ohko`, 방어 `low-roll-ohko`(화면 "저난수1타")·`guaranteed-survive`. 항목 글자는 `candidateOptionsText`(쌍은 H 0부터 `minSumWithFloors` 점)이다. 고르면 `ui.addLock(lock)`를 한 번 부른다. 성격과 배분은 고르지 않는다.
- 고정 SP는 `deriveLocks`가 갈래마다 정한다. 단일 능력치는 갈래 선택지(상승/무보정)의 SP다. 쌍이 든 묶음은 `mergeGroup`이 H 0~32 중 합 최소(동률이면 H 큰 쪽)를 고른다. H 최대 배분은 변동 `defenseHMax`에만 있고 고정 쪽에는 없다. 그래서 핀은 늘 합 최소로 걸린다(사용자 관찰과 같다).
- 어느 성격으로 고정했는지는 고정이 아니라 기준 갈래가 정한다(`AppState.lockBase`, 고정 줄 ▲ = `set-lock-base`). 고정 하나는 무보정안과 상승안을 모두 갖는다(PRD R3).
- `add-lock`은 같은 (대상, 단계)만 막는다. 같은 능력치의 다른 대상은 둘 다 들어가고, `mergeGroup`이 능력치별 최대를 쓴다(PRD R4). 스크린샷의 S32↑·S23↑ 동시 고정이 이 경로다.
- `AdjustMenu`는 이미 `AdjustPopover.tsx`에서 export된 표시 컴포넌트다(`view`·`stage`·콜백만 받는다). 2단 상태·키보드·위치 잡기는 `AdjustPopover` 본문에 있다.

### 1. (A) 회귀 테스트

- **E2E**: `e2e/speed-chart.spec.ts`에 1건을 더한다. 기존 `dragSlider`·`spBox`·`band`·`myStat`을 재사용한다.
  1. `openSpeed(page)`. 슬라이더 `SP 스피드`의 현재 값 v0을 읽는다. v0과 다른 t1(v0이 12면 20, 아니면 12)로 `dragSlider`하고 반환값이 t1인지 확인한다.
  2. `band(page)`의 `data-speed`가 `myStat(page)`(스피드 실능치)와 같은지 확인한다(드래그 확정 직후 동기화).
  3. `spBox(page).fill(String(t2))`(t2 ≠ t1, 예: 5)로 확정한다(기존 145행과 같은 방식). `spBox` 값이 t2이고, `band`의 `data-speed`가 새 실능치와 같으며 t1 때 값과 다른지 `expect.poll`로 확인한다. 수정 전에는 여기서 실패한다(기준선이 t1에 멈춤).
  4. `+`/`−` 버튼을 한 번 눌러 같은 확인을 반복한다(두 번째 커밋 경로).
  - 실패 재현: `ProductApp.tsx`의 `useLayoutEffect` 3줄을 뺀 임시 사본에서 3단계가 실패해야 한다. 스크래치 스크립트는 `/Users/nhn/.claude-mine/jobs/6958e5cf/tmp`에 두고 dev 서버(5281)를 대상으로 돌린다. 저장소에는 두지 않는다.
- **단위 테스트**: 하지 않는다. 수정은 `Workspace`의 `useLayoutEffect`(초안이 바뀌면 `displaySp.set(null)`)인데, 저장소에 React DOM 테스트 도구(jsdom·testing-library)가 없다(`package.json` 확인). 도구를 들이는 것은 이 단위 범위 밖이다. `createDisplaySpStore`는 바뀌지 않았으므로 그 저장소 단위 테스트로는 회귀를 잡지 못한다.

### 2. (B) 같은 능력치는 고정 하나(교체)

**규칙(cards 순수 함수 한 곳)**: `src/cards/lock.ts`에 추가한다.

```ts
/** 새 고정(stats)과 H 밖 능력치가 겹치는 기존 고정. 새 고정을 걸면 이들은 해제된다(사용자 결정 2026-11-21) */
export function conflictingLocks(locks: readonly CutLock[], stats: readonly StatId[]): CutLock[]
```

- 겹침 = `l.stats`와 `stats`가 `hp` 밖 능력치를 하나라도 공유한다. 경우별 결과:
  - 스피드↔스피드(S), 공격 A↔A, 공격 C↔C: 교체.
  - 같은 대상의 다른 단계(확정1타 → 고난수1타): 같은 능력치라 교체(단계를 바꾸려면 다시 핀).
  - 방어 H+B ↔ 다른 대상 H+B: B가 겹쳐 교체.
  - 방어 H+B ↔ H+D: H만 공유해 공존(2026-11-20 H·B·D 결정 유지).
  - 공격 B(바디프레스) ↔ 방어 H+B: B가 겹쳐 교체(종류가 달라도, 4절 모호점 1).
- `checkLockCandidate`(스피드 핀 판정, 리듀서 밖 사전 판정)는 후보를 더하기 전에 `conflictingLocks`로 교체될 고정을 뺀다. 그래야 기존 S 고정 때문에 새 S 후보가 "SP 부족"으로 막히지 않는다.

**리듀서 `add-lock`(원자적, 액션 한 번)**: `src/app/state.ts`

```ts
| { type: 'add-lock'; lock: Omit<CutLock, 'seq'>; spTotal: number; base?: string; lockedSp?: LockedSp }
```

1. `validLock` 실패나 `spTotal` 형식 오류면 무시한다(기존).
2. `replaced = conflictingLocks(state.locks, lock.stats)`. `replaced`가 새 고정과 완전히 같은 하나(같은 대상·단계·배분)이고 `base`가 없거나 `state.lockBase`와 같으면 상태를 그대로 둔다. 기존 "같은 (대상, 단계) 무시"의 일반화다.
3. `remaining = state.locks − replaced`로 두고 `releaseLocks(state, remaining, action.lockedSp, lock.stats)`를 부른다. remove-lock과 같은 해제 경로다. `releaseLocks`에는 4번째 인자 `adding: readonly StatId[] = []`를 더해 `keep = lockedStatsOf(remaining) ∪ adding`으로 센다.
   - 다시 고정되는 능력치(S→S)는 풀지도 자르지도 않는다. 초안의 그 값은 첫 고정 직전 값(복원값)이라 그대로 지킨다.
   - 풀리는 능력치만 기존 R13 규칙(복원, 66을 넘으면 나중 고정의 능력치부터 자르기, `lockTrim`)을 탄다. 예: H+B를 바디프레스 B로 교체하면 H가 풀린다.
   - 성격 복원(`restoreNature`)은 최종 고정이 0개일 때만 한다. 교체 뒤에는 새 고정이 남으므로 하지 않는다(조건 `remaining.length === 0 && adding.length === 0`).
4. 새 고정 `{ seq: lockSeq, ..., allocation? }`을 `remaining` 뒤에 붙인다. 나머지 필드:
   - `lockSeq + 1`, `lockNature ?? natureOf(draft)`, `lockSpTotal ?? spTotal`.
   - `lockBase = action.base ?? state.lockBase`.
   - `lockTrim` = 잘린 것이 있으면 trims, 없으면 null.
   - `lockReveal`이 교체된 seq를 가리키면 null.
   - `generation + 1` 한 번, `lockFit = generation + 1`(R19 자동 조정 대기, 기존과 같다).
- `lockContext.addLock`은 `removeLock`처럼 지금 기준 갈래의 `lockedSp`를 함께 보낸다. 남은 고정 능력치를 기준 갈래 값으로 세어 자르기 위해서다.
- 지우지 않는 코드: R4의 "같은 단일 능력치 여럿 → 최대"는 리듀서로는 더 생기지 않는다. 그래도 `mergeGroup`의 `singleMax`·묶음 로직은 쌍+쌍(H 공유)과 쌍+단일(H 밖 겹침 없음)에 계속 쓰이므로 남긴다(최소 변경). `src/cards/lock.test.ts`의 "같은 단일 능력치 고정 여럿은 갈래 안에서 최대" 테스트도 파생 함수의 방어적 정의로 남긴다.

### 3. (C) 공·방 핀 메뉴 = 변동 메뉴(고정 가능 단계만)

#### 3.1 데이터 모델

- `CutLock`에 선택 필드 하나를 더한다.

```ts
/** 방어 쌍 배분. 없으면 합 최소. 'h-max' = 남은 예산·능력치당 최대 안에서 H 최대(그 H의 최소 B/D, 단계 정확) */
allocation?: 'h-max'
```

  - `validLock`: `allocation`은 `undefined`이거나, `kind === 'defense'`이면서 `'h-max'`일 때만 받는다. 리듀서가 복사한다. `lockTargetId`(대상 키)는 바꾸지 않는다.
- 성격 선택은 고정에 저장하지 않는다. 고정은 무보정안과 상승안을 계속 함께 갖고(PRD R3 데이터 모델 유지), 고른 성격은 기준 갈래(`lockBase`)로 반영한다. 고정 줄 ▲(`set-lock-base`)와 같은 상태라 나중에 ▲로 바꿀 수 있고, R10·R12가 그대로 성립한다. 기각: 고정에 `nature: 'neutral' | 'plus'`를 저장하는 안. 갈래 모델·▲ 선택·성격 충돌 판정을 모두 바꿔야 하고, R10과 이중 조작이 된다.
- `LockOptions` 쌍에 선택 필드 `next?: { neutral: Stairs | null; plus: Stairs | null }`를 더한다. 고정 단계 한 단계 위(순위+1)의 계단이다. H 최대 배분의 단계 정확 검사(그 H의 최소 B/D가 한 단계 위에 닿지 않음)에만 쓴다. 방어 고정 단계 중 위가 있는 것은 `low-roll-ohko`(순위 3, 위는 순위 4 `guaranteed-survive`)뿐이다. `guaranteed-survive`는 최상위라 `next`가 없다.

#### 3.2 파생(`deriveLocks`)이 H 최대를 따르는 방법

- `Need` 쌍에 `hMax: boolean`과 `next: Stairs | null`을 싣는다(`needOf(options, usePlus, lock)`).
- `branchesOf`에서 묶음을 둘로 나눈다.
  - ① H 최대 쌍이 없는 묶음: 지금 `mergeGroup` 그대로.
  - ② H 최대 쌍이 든 묶음: 쌍은 모두 H를 공유하므로 이런 묶음은 갈래당 많아야 하나다. ①의 합을 먼저 구한 뒤 `budget = spTotal − ①합`으로 `mergeGroupHMax`를 부른다.
- `mergeGroupHMax`:
  - H = 32(spMax)부터 hpFloor까지 내려가며 처음 성립하는 H를 고른다.
  - 성립 조건: 묶음의 모든 요구(쌍 계단·단일 최대)가 그 H에서 닿고 능력치당 32 이내다. 묶음 합 ≤ budget이다. H 최대 쌍마다 `next[H]`가 null이거나 그 쌍의 B/D 값보다 크다(단계 정확).
  - 성립하는 H가 없으면 합 최소(`mergeGroup`)로 떨어진다.
- `ignoreTotal`(SP 부족량을 재는 완화 모드)에서는 H 최대를 쓰지 않고 합 최소로 센다. 그래서 R7·R17의 "SP 부족(n)" 값과 고정 가능 여부는 배분과 무관하게 지금과 같다. H 최대는 다른 고정을 다 넣고 남은 예산 안에서 정해지므로, H 최대 고정이 뒤에 거는 고정을 SP 부족으로 막지 않는다.
- 쌍이 하나일 때 이 정의는 변동 `defenseHMax`와 같다(예산 = 66 − 다른 고정 합, 고정 밖 능력치는 예산을 막지 않고 R19가 줄인다).
- H를 공유하는 두 쌍(예: H+B는 H 최대, H+D는 합 최소): 묶음에 H 최대 쌍이 하나라도 있으면 H 최대로 고르고, 그 H에서 각 요구는 최소다. 먼저 고른 H 최대 의도를 뒤 고정이 조용히 깨지 않게 하려는 것이다(4절 모호점 6). 새로 거는 쪽(H 공유)의 핀 2단에는 H 최대 항목이 없다(2026-11-20 결정: H·B·D 제시 때 H 최대 없음).
- 레인(`lockLane.ts`):
  - `laneTasks(plan, lock, target)`의 `lock`을 `Pick<CutLock, 'stage' | 'allocation'>`로 넓힌다. 방어이고 `allocation === 'h-max'`이며 순위+1이 있으면, 같은 두 엄격 성격의 순위+1 계단 작업을 더한다.
  - `laneResolution`이 그 결과로 `next`를 채운다.
  - 합 최소 고정은 작업이 늘지 않는다. 성능 영향은 H 최대 저난수 고정에만 있다(성격 2 × 계단 1, 판정 약 66회).

#### 3.3 핀 메뉴 모델(새 순수 함수, 변동 모델과 같은 모양)

새 파일 `src/cards/lockPin.ts`:

```ts
export interface PinPick { lock: Omit<CutLock, 'seq'>; /** 고른 성격의 기준 갈래 id. 그대로 두어도 그 갈래가 기준이면 없음 */ base?: string }
export interface PinMenuView extends Pick<AdjustView, 'state' | 'natures' | 'results'> {
  /** [results index][natures index] 고를 수 있으면 그 고정. allocation은 고를 때 붙인다 */
  picks: readonly (readonly (PinPick | null)[])[]
  /** ready인데 결과가 하나도 없을 때, 막힌 이유 중 SP 부족 최소 초과량 */
  emptyOver?: number
}
export function pinMenuView(input: {
  game: Snapshot; mySet: PokemonSet /* 고정 전 초안 */; locks: readonly CutLock[]
  resolutions: ReadonlyMap<number, LockResolution>; lockBase: string | null
  side: 'attack' | 'defense'; stages: readonly LockStageCandidate[]; current?: RollTier
}): PinMenuView
```

- 표시 값은 변동 격자(`adjustView`)가 아니라, **그 선택을 실제로 걸었을 때의 파생**에서 읽는다. 그래야 메뉴에 보인 SP가 고정 뒤 내 포켓몬 고정 줄·고정 목록의 SP와 구조적으로 같다(사용자 요구의 핵심). 변동 격자를 그대로 쓰면 H 공유 쌍 합치기·교체·H 최대 정확 규칙에서 값이 어긋난다.
- 절차:
  1. 단계 후보 중 하나라도 `computing`이거나 화면 파생이 계산 중이면 `{ state: 'computing', natures: [], results: [], picks: [] }`를 낸다(1단 "계산 중…", 비활성 아님, 기존 R7과 같다).
  2. 후보마다 교체를 반영한다: `kept = locks − conflictingLocks(locks, cand.lock.stats)`, `pre = deriveLocks({ locks: kept, resolutions, baseChoice: lockBase })`. v = 상승 능력치(공격은 그 능력치, 방어는 B/D), `other` = 반대쪽 방어 능력치, `sideLocked = pre.lockedStats.includes(other)`, `hShared = pre.lockedStats.includes('hp')`.
  3. 성격 선택지는 변동 `lockedChoices`와 같은 순서·이름이다: 무보정 → v 상승 → (`sideLocked`면) 반대쪽 상승. 목표 갈래 id:
     - v 상승 → `plus:${v}`. 반대쪽 상승 → `plus:${other}`.
     - 무보정 → `pre.baseId`가 있고, `plus:${v}`가 아니고, (`sideLocked`이면서 `plus:${other}`)도 아니면 그 id. 아니면 `'out'`.
  4. 선택지 × 배분마다 파생을 한 번 더 돌린다. 배분은 합 최소, 그리고 `side === 'defense' && !hShared`일 때만 H 최대다. `post = deriveLocks({ locks: [...kept, { ...cand.lock, allocation, seq: max+1 }], resolutions + 후보 해석, baseChoice: 목표 id })`. H 최대 저난수 후보의 해석에는 `next` = 같은 카드 `guaranteed-survive` 후보의 계단을 붙인다.
     - 후보 상태가 `sp-short`면 `{ kind: 'off', reason: 'budget', over }`, `nature-conflict`면 `'no-branch'`, 그 밖의 비활성이면 `'unreachable'`.
     - 활성인데 목표 갈래가 `post.branches`에 없으면: 그 성격의 후보 선택지가 null이면 `'unreachable'`, 아니면 `'no-branch'`.
     - 성립하면 `stats`를 만든다. 후보 능력치(방어는 `hShared`면 B/D만, 아니면 H·B/D, 공격은 v)를 `branch.lockedSp` 값으로 넣고 `plus = (stat === 선택지 상승)`, `locked: false`로 둔다. 여기에 변동 `lockedStatsOf`와 같은 규칙의 고정 표기(`locked: true`)를 더한다: `sideLocked`나 `hShared`면 H와 반대쪽, 그 밖은 `pre` 기준 갈래와 값이 달라지는 고정 능력치. STAT_IDS 순으로 정렬한다. 비용 = 후보 능력치 SP 합.
     - H 최대는 활성·성립하고, 그 H가 합 최소의 H보다 클 때만 `hMax`로 붙인다(같으면 하나만, 변동과 같다).
  5. 단계 정확(변동 `exact`와 같은 뜻): 아래 단계(공격 고난수1타, 방어 저난수1타)의 선택지 j는, 위 단계(확정1타·확정견딤)의 같은 j가 ok이고 비용이 같거나 작으면 `'unreachable'`로 끈다(고르면 위 단계가 되는 선택지).
  6. 결과 목록: 그 탭 관점에서 좋은 단계부터 넣는다(공격 확정1타 → 고난수1타, 방어 확정견딤 → 저난수1타). ok 선택지가 하나라도 있는 단계만 넣는다(변동과 같은 생략 규칙). `lead` = 내 세트 성격의 상승 능력치 선택지(없으면 무보정)가 ok면 그것, 아니면 가장 싼 ok(동률이면 앞). `current` = 카드 현재 결과와 같으면 true.
  7. `picks[r][j]`: ok면 `{ lock: cand.lock, base }`. `base`는 목표 id가 `deriveLocks(post 고정, baseChoice: lockBase).baseId`(자동 규칙·현재 선택을 그대로 둔 결과)와 다를 때만 싣는다. 무보정이고 기준이 그대로인 경우 `lockBase`가 바뀌지 않으므로 기존 고정과 같은 상태가 된다(기존 E2E 기대 유지).
  8. 결과가 0개면 `emptyOver` = 끈 이유 중 `budget`의 최소 `over`(있을 때만).
- 비용: 메뉴가 열린 동안만 계산한다. 단계 2 × 선택지 ≤3 × 배분 ≤2 × 파생 2회 ≈ `deriveLocks` 24회이고, 각각 H 33칸 내외라 화면을 막지 않는다.
- 카드 현재 결과: `CardLockPin`에 `current?: RollTier`를 더한다. 값은 `assemble.ts`가 `adjustView`에 넘기는 `headlineLabel`과 같다.
- 단계 집합: 지금 핀과 같다. 공격 `guaranteed-ohko`·`high-roll-ohko`, 방어 `guaranteed-survive`(확정견딤)·`low-roll-ohko`(화면 "저난수1타"). `LOCK_STAGES`를 그대로 쓴다.

#### 3.4 화면: 같은 컴포넌트 공유(복사 금지)

- `AdjustMenu`(`AdjustPopover.tsx`)를 그대로 재사용한다. 바꿀 점:
  - `view` 타입을 `Pick<AdjustView, 'state' | 'natures' | 'results'>`로 좁힌다(`PinMenuView`가 맞는다).
  - `variant?: 'adjust' | 'pin'`(기본 adjust)를 더한다. 변동 ↔ 핀 차이:
    - 제목: `ADJUST_RESULTS_TITLE` ↔ `PIN_RESULTS_TITLE = '고정할 결과'`.
    - 1단 읽기 이름: `adjustResultsLabel` ↔ `pinResultsLabel = "컷 고정할 결과: {대상}"`.
    - 빈 목록: `ADJUST_EMPTY_TEXT` ↔ `PIN_EMPTY_TEXT = '고정할 수 있는 결과 없음'`(`emptyOver`가 있으면 ` · SP 부족(n)`을 붙인다).
    - 루트 `data-testid`: `adjust-menu` ↔ `cut-pin-menu`.
    - 루트 클래스에 `pin`을 더한다(CSS `.adjust-menu.pin { right: auto; left: 0 }`). 핀은 카드 왼쪽 끝에 있어 오른쪽으로 연다.
  - 항목 testid(`adjust-result`·`adjust-nature`·`adjust-hmax`·`adjust-back`)와 `data-label`·`data-nature`·`data-alloc`은 둘이 공유한다.
  - `AdjustOption` off에 선택 필드 `over?: number`(budget 전용)를 더한다. `adjustOffText`는 `over`가 있으면 `spShortText(over)`("SP 부족(n)"), 없으면 지금 글자다. 변동은 `over`를 싣지 않으므로 그대로다.
- 2단 상태·키보드·위치 잡기를 `AdjustPopover`에서 훅으로 뽑는다(새 파일 `src/app/components/useAdjustMenu.ts`).
  - 훅이 맡는 것:
    - 열림 상태와 고른 결과(라벨로 기억하고, 다시 계산된 목록에서 사라지면 1단), `stage` 계산.
    - 단계가 바뀔 때 포커스: 뒤로 왔으면 고른 결과, 아니면 첫 고를 수 있는 항목.
    - 매 렌더 위치 잡기: `anchor: 'end'`는 지금 계산 그대로, `'start'`는 `room = min(innerWidth − 16, 결과 칸 오른쪽) − 버튼 왼쪽`. 위·아래 뒤집기와 포커스 잃은 항목 복구도 함께.
    - 바깥 누름 닫기, `onMenuKey`(↑↓·Home/End·1단 →로 고르기·2단 ←로 뒤로·Esc로 닫고 버튼 포커스·Tab으로 닫기), `onBlur`, `close()`, `goBack()`, `chooseResult(i)`.
  - `AdjustPopover`에는 이 훅과 자기 몫만 남긴다: `onAdjustCard` 수요, 적용 뒤 `focusReturn`, 버튼이 사라질 때 탭 패널로 포커스. 동작이 바뀌지 않는 리팩터여야 하고, `e2e/product-adjust.spec.ts`가 수정 없이 통과해야 한다.
- `CutPin` 개편. 핀 버튼 자체(아이콘, 찬 핀 = 그 카드 고정 전부 해제, 비활성 사유, `aria-pressed`)는 그대로 둔다.
  - props를 둘로 가른다.
    - 스피드: `{ direct: true; items: () => readonly PinStageView[] }`. 지금 그대로이고, 걸 수 없을 때만 한 항목짜리 사유 메뉴를 연다.
    - 공·방: `{ menu: () => PinMenuView; onPick(view, result, option, allocation): void }`. `useAdjustMenu({ anchor: 'start' })`와 `<AdjustMenu variant="pin" … />`로 그린다.
  - 공·방 경로에서도 `aria-haspopup="menu"`·`aria-expanded`는 지금처럼 핀 버튼에 둔다. 메뉴가 열린 동안 `onOpenChange(true)` → `ui.onPinMenu(tab, cardId)`로 후보 계산을 요청한다(지금과 같다).
  - 고르면 `close()`(핀으로 포커스)한 뒤 `onPick`을 한 번 부른다.
- `CardItem.CardPin`: `items`/`pinStageView`/`LOCK_STAGES` 대신 `menu={() => ui.pinMenu(tab, card)}`, `onPick={ui.pinLock}`을 넘긴다.
- `lockContext`(`LockUi`)에 더할 것:
  - `pinMenu(tab, card): PinMenuView`. `pending`이면 computing이다. 아니면 `pinMenuView({ game, mySet: toPokemonSet(draft), locks, resolutions: 현재 스냅샷, lockBase: state.lockBase, side, stages: control.stages, current: pin.current })`. `LockUiDeps.state`에 `lockBase`를 더한다.
  - `pinLock(view, result, option, allocation)`. `picks[result][option]`이 있을 때만 `dispatch({ type: 'add-lock', lock: allocation === 'h-max' ? { ...pick.lock, allocation: 'h-max' } : pick.lock, spTotal, base: pick.base, lockedSp: 지금 기준 갈래 lockedSp })`를 **한 번** 보낸다. H 최대는 그 선택지에 `hMax`가 있을 때만 받는다.
  - `check`(스피드 핀)는 2절대로 교체될 고정을 뺀다(`checkLockCandidate` 안에서 처리).
- 고르는 순간의 일은 원자적이다. 교체 해제, 새 고정, 기준 갈래 선택, 자동 조정 대기 표지가 리듀서 한 번에 일어난다(세대 +1 한 번). 이어서 기존 `fit-locks`가 파생 뒤 한 번 고정 밖 능력치를 줄인다(R19, 변경 없음). 기각: `add-lock` 뒤에 `set-lock-base`를 따로 보내는 안. 세대가 두 번 오르고, 중간 상태에서 R19 자동 조정이 다른 갈래로 한 번 돈다.

#### 3.5 고정 목록·내 포켓몬 표시

- 내 포켓몬 고정 줄은 이미 기준 갈래 `lockedSp`를 보이므로, H 최대와 고른 성격이 그대로 반영된다(변경 없음).
- 고정 목록(`LockList`) 오른쪽 SP: 활성 고정은 `lockOptionText(resolution)`(쌍은 H 0 독립 최소 합 점) 대신 파생 갈래 값으로 낸다.
  - 새 함수 `lockChoiceText(derivation, lock)`: 그 고정 능력치의 갈래별 `lockedSp`를 상승 갈래 먼저, 같은 글자는 한 번만 보인다. 기존 `lockedStatText`와 같은 방식이고, 쌍은 "H32 B4+ / H32 B12" 꼴이다.
  - 비활성(문제) 고정은 지금처럼 `lockOptionText`를 쓴다.
  - 이로써 H 공유 합치기와 H 최대가 목록에도 맞게 보인다. 단일 능력치 고정은 값이 지금과 같다("S23+"를 기대하는 E2E 유지).
- H 최대 고정 항목에는 단계 배지 뒤에 작은 "H 최대" 표지를 단다(`ADJUST_ALLOCATION_TEXT['h-max']` 재사용). 읽기 설명에도 붙인다.

#### 3.6 키보드·접근성 동등성

- 공·방 핀:
  - Enter/Space로 열고, 첫 고를 수 있는 결과에 포커스한다.
  - ↑↓·Home/End로 이동, → 또는 Enter로 2단, ← 또는 "‹ 뒤로"로 1단(고른 결과에 포커스 복귀).
  - Esc는 닫고 핀으로 포커스, Tab과 바깥 누름은 닫기.
  - 비활성 선택지는 `aria-disabled`와 사유 글자를 단다. 1단 현재 결과에는 `aria-current`, 2단 메뉴 이름은 "성격 선택: 확정견딤 H 32 B 4"(기존 `adjustNaturesLabel`).
  - 320px에서 잘리지 않는다(`anchor: 'start'` 폭 제한).
- 스피드 배지 핀은 키보드 동작과 로빙 탭 인덱스까지 그대로다.

### 4. 모호점·기존 결정과의 충돌(가장 충실한 해석으로 정함)

1. **바디프레스(공격 B) ↔ 방어 H+B**: "같은 스탯은 하나의 타겟"을 능력치 기준으로 읽는다. 종류가 달라도 B가 겹치면 교체하고, H만 겹치면 교체하지 않는다(H+B·H+D 공존, 2026-11-20 결정).
2. **같은 대상, 다른 단계**: 지금은 공존할 수 있었지만 같은 능력치라 교체한다. 같은 대상·단계·배분을 다시 고정하면 무시한다.
3. **PRD R2 "단계마다 고정 불가 사유를 보인다" ↔ "변동이랑 완전히 똑같이"**: 사용자 발화를 따른다. 1단은 고를 수 있는 단계만 보인다(변동과 같은 생략). 사유는 2단 선택지(`SP 부족(n)`·`닿지 않음`·`고정과 겹침`)와 빈 목록 문구(`고정할 수 있는 결과 없음 · SP 부족(n)`)에만 남긴다. 컷 전체를 고정할 수 없는 경우(R1 제외·SP 무관 판정·어느 단계에도 닿지 않음)는 지금처럼 핀을 비활성으로 두고 사유를 툴팁으로 보인다.
4. **고정은 "이 단계 이상", 변동은 "정확히 그 결과"**: 핀 목록은 변동처럼 정확 규칙을 쓴다. 고르면 위 단계가 되는 선택지는 끄고, H 최대는 한 단계 위에 닿지 않는 가장 큰 H다. 고정 자체의 뜻(그 단계 이상 유지)은 바뀌지 않는다.
5. **성격 선택의 저장 위치**: 고정이 아니라 기준 갈래(`lockBase`)에 반영한다. 고정 줄 ▲로 나중에 바꿀 수 있고(R10), 그 갈래가 무효가 되면 자동 규칙으로 돌아간다(기존). 고정 목록은 두 선택지 값을 계속 보인다(R3 유지).
6. **H 최대 + H 공유 쌍**: H 최대로 건 쌍이 이미 있으면, 합친 묶음도 H 최대를 따른다(뒤 고정이 앞 선택을 조용히 깨지 않게). 새로 거는 H 공유 쌍의 2단에는 H 최대가 없다(2026-11-20 결정).
7. **H 최대 예산**: 다른 고정 합을 뺀 66 안에서 H를 최대로 잡는다. 고정 밖 능력치는 예산을 막지 않고 R19가 H→S 순으로 줄인다(변동 R22·R24와 같은 규칙). SP 부족 판정은 합 최소 기준이라, 배분 선택이 고정 가능 여부를 바꾸지 않는다.
8. **스피드 핀**: 단계·성격 선택 없이 바로 고정한다(사용자: 스피드 탭 핀은 그대로). (B) 교체만 적용된다.
9. **(A) 단위 테스트**: React DOM 테스트 도구가 없어 두지 않는다(1절).
10. **AC12 E2E 시나리오 충돌**: 지금 테스트는 방어 H+B 쌍 두 개(한카리아스 드래곤클로, 대도각참 엎드려베기, 둘 다 물리)를 거는데, (B)를 적용하면 두 번째가 첫 번째를 교체한다. AC12(H 공유)는 H+B + H+D(예: 메가플라엣테 매지컬샤인, 특수)로 다시 짠다. D까지 고정하면 하락 자리가 달라지므로, AC16 "하락 자리 없음" 확인은 별도 조합으로 떼어 구현 때 실데이터로 다시 찾는다.

### 5. 테스트

**바꿀 기존 테스트**

- `src/app/state-lock.test.ts`:
  - "같은 (대상, 단계)는 무시하고 단계가 다르면 받는다" → "같은 (대상, 단계, 배분)은 무시하고, 같은 능력치의 다른 단계·다른 대상은 교체한다(seq 새로, 고정 1개)".
  - "같은 능력치 고정이 남아 있으면 그 능력치는 풀리지 않는다"(스피드 고정 둘): 이제 리듀서로 만들 수 없는 상태다. H+B·H+D 두 쌍으로 바꿔 "H+B만 풀면 H는 고정 유지(복원·자르기 없음), B만 복원"으로 쓴다.
  - "형식이 틀리면 무시": `allocation` 오류(스피드·공격의 `'h-max'`, 모르는 값)와 방어 `'h-max'` 수용을 더한다.
- `src/app/components/lockText.test.ts`: `pinStageView`는 스피드용으로 남으므로 그대로 둔다. `adjustOffText`의 `over` 경우를 더한다.
- `e2e/helpers.ts`: `pinItem`·`lockRow`를 2단 흐름으로 바꾼다.
  - 핀 → `cut-pin-menu`에서 `adjust-result[data-label=<단계 id>]`를 고른다. 한글 단계 → id 매핑: 확정1타 `guaranteed-ohko`, 고난수1타 `high-roll-ohko`, 확정견딤 `guaranteed-survive`, 저난수1타 `low-roll-ohko`.
  - 이어서 `adjust-nature[data-nature=<기본 neutral>]` 또는 `adjust-hmax`를 고른다.
  - 인자 기본값은 `nature = 'neutral'`, `alloc = 'min-sum'`이다. 기존 고정과 같은 상태가 되는 선택이다.
- `e2e/product-cut-lock.spec.ts`:
  - R2 핀 메뉴 테스트 3건(453·515·533행, 단계 메뉴 항목·`cut-pin-item`·`.cut-pin-detail`을 가정)을 1단 결과·2단 성격 구조로 다시 쓴다.
  - AC12(681행)는 4절 10대로 바꾼다.
  - 스피드 핀을 쓰는 AC4(207행)는 교체를 반영해 기대값을 실데이터로 다시 확인한다. 예상: 짜랑고우거 +1 168은 기존 S 고정을 교체한 뒤에도 S32+ + A30 + C12 = 74 → "SP 부족(8)". 비비용 155는 교체 뒤에도 A20+·S20+ 상승이 겹쳐 "성격 충돌".
  - 고정 목록의 쌍 SP 글자를 읽는 단언이 있으면 3.5 변경으로 값이 바뀔 수 있다.

**새 단위 테스트**

- `src/cards/lock.test.ts`:
  - `conflictingLocks`: S↔S, A↔A, H+B↔H+B 교체, H+B↔H+D 공존, 공격 B↔H+B 교체.
  - `checkLockCandidate`가 교체될 고정을 빼고 판정한다.
  - H 최대 파생: 단일 쌍은 남은 예산 안 최대 H와 그 H의 최소 B. `next`로 단계 정확. 예산이 모자라면 합 최소. H 공유 두 쌍 중 하나가 H 최대면 최대 H. `ignoreTotal`의 SP 부족량은 합 최소 기준. 변동 `defenseHMax`와 같은 입력에서 같은 배분.
- `src/cards/lockLane.test.ts`: H 최대 저난수 고정만 순위+1 계단 작업을 더하고 `next`를 채운다. 합 최소 고정과 확정견딤 고정은 작업이 그대로다.
- 새 `src/cards/lockPin.test.ts`(`pinMenuView`):
  - 공격: 무보정/상승 두 선택지, 단계 순서, 정확 규칙(고난수 SP ≥ 확정 SP면 끔), 내 세트 상승을 따르는 lead.
  - 방어: H 최대 항목은 합 최소보다 H가 클 때만. 반대쪽 쌍 고정 중에는 3선택지, H·B·D와 고정 표지, H 최대 없음.
  - 목표 갈래(무보정 = 현재 기준 또는 out, 상승 = `plus:v`, 반대쪽 = `plus:other`), 자동 규칙과 같으면 `base` 생략.
  - 교체될 S 고정을 빼고 계산, 계산 중 상태.
  - 핵심 불변식: 표시 SP = 그 선택을 건 뒤 파생의 기준 갈래 `lockedSp`.
- `src/app/state-lock.test.ts` 신규:
  - 교체의 원자성: 세대 +1 한 번, `lockFit` 표지, `lockNature` 보존, 성격 복원 없음, 다시 고정되는 S의 초안 값 보존.
  - 바디프레스 B가 H+B를 교체하면 H 복원과 자르기 알림.
  - `base`가 `lockBase`를 바꾼다. 교체된 고정을 가리키던 이동 요청을 비운다. 같은 고정을 다시 요청하면 상태 그대로.

**새 E2E**(`e2e/product-cut-lock.spec.ts`)

- (B):
  - 스피드: 배지 X 고정 → 배지 Y 고정 → 목록에 Y 하나, X 핀 `aria-pressed=false`, 고정 S = Y의 SP.
  - 공격: 같은 능력치의 다른 카드를 고정하면 교체.
  - 방어: H+B 뒤 다른 H+B는 교체, H+D는 공존(목록 2개).
- (C):
  - 방어 카드 핀 → 1단 `adjust-result`(확정견딤·저난수1타 중 닿는 것) → 2단 D(또는 B) 상승 + `adjust-hmax`. 확인: 고정 줄 H·B/D 값 = 메뉴에 보인 H 최대 값, 고정 줄 ▲가 그 능력치에 눌림(기준 갈래 `plus:<v>`), 고정 목록에 "H 최대" 표지.
  - 공격 핀 2단 상승 → 고정 줄 SP = 메뉴 값, ▲ 눌림. 무보정 → 기준 갈래 그대로.
- 키보드: Enter로 핀 메뉴 열기, →로 2단, ←로 뒤로(고른 결과에 포커스), Esc로 핀 포커스. `@layout` 320px에서 핀 메뉴 1단·2단이 잘리지 않음(변동 테스트와 같은 확인).
- (A)는 1절의 `e2e/speed-chart.spec.ts` 1건.

### 6. 문서 개정(본문만, frontmatter 금지)

- `docs/raw/feature/cut-lock-budget/prd.md`
  - R2 끝에 덧붙임: "(빌드 중 개정 2026-11-21, 사용자 결정: '고정 버튼에서 뜨는 목록을 완전히 변동이랑 똑같이 맞춰도 될듯? UI도. 다만 고정핀은 확1 또는 고난수1타만 있는거뿐이지(방어탭은 반대고)') 공격·방어 핀 메뉴는 변동 팝오버(R22–R23)와 같은 2단 메뉴다. 1단은 고정 가능 단계(공격 확정1타·고난수1타, 방어 확정견딤·저난수1타) 중 고를 수 있는 것만 결과 배지와 SP로 보인다. 2단은 무보정/상승(방어 쌍 한쪽 고정 중에는 무보정/B 보정/D 보정)이고, 방어는 합 최소/H 최대도 고른다. 고른 성격은 기준 갈래(R10)로, 고른 배분은 고정에 반영한다. 그래서 고정 줄·고정 목록 SP가 메뉴 값과 같다. 고를 수 없는 선택지는 사유(SP 부족(n)·닿지 않음·고정과 겹침)를 보이고, 결과가 없으면 '고정할 수 있는 결과 없음'을 보인다. 스피드 배지 핀은 그대로 바로 고정한다."
  - R3 끝: "(빌드 중 개정 2026-11-21) 공격·방어 핀에서는 사용자가 성격 선택지를 고른다. 고정은 두 선택지를 계속 갖고, 고른 선택지는 기준 갈래로 정해진다. 방어 쌍 고정은 배분(합 최소 / H 최대)을 함께 저장한다. H 최대는 다른 고정을 뺀 예산과 능력치당 32 안에서 H를 가장 높이고, 그 H에서 고정 단계를 정확히 내는 최소 B/D다(PRD R23과 같은 뜻). 예산이 모자라면 합 최소로 둔다."
  - R4 끝: "(빌드 중 개정 2026-11-21, 사용자 결정: '같은 스탯은 하나의 타겟만 고정', 기존 고정 교체) H를 뺀 같은 능력치에는 고정이 하나다. 이미 고정된 능력치에 다른 고정(다른 대상·다른 단계 포함)을 걸면 새 고정이 들어가고, 그 능력치의 이전 고정은 해제 경로(R13)로 풀린다. 종류가 달라도 같다(공격 B 고정 ↔ 방어 H+B). H만 공유하는 방어 쌍(H+B·H+D)은 함께 걸린다. 위 '같은 단일 능력치 여럿 → 최대'는 더 이상 생기지 않는다. H를 공유하는 묶음에 H 최대 쌍이 있으면 합친 SP도 H 최대를 따른다."
  - R13 셋째 줄 끝: "(2026-11-21 개정으로 단일 능력치에서는 생기지 않고, H를 공유하는 방어 쌍에만 해당한다.)"
  - 수용 기준에 둘을 더한다.
    - AC17: "스피드 배지 두 개를 차례로 고정하면 목록에 나중 것 하나만 남는다. 같은 능력치 공격 컷과 H+B 방어 컷도 같다. H+B와 H+D는 함께 남는다(단위 + UI)."
    - AC18: "방어 카드 핀 2단에서 D 상승·H 최대를 고르면 내 포켓몬 H·D 고정 줄과 고정 목록 SP가 메뉴에 보인 값과 같고, D ▲가 눌린다. 공격 핀 상승도 같다. 핀 메뉴는 변동 팝오버와 같은 키보드 조작이고 320px에서 잘리지 않는다(단위 + UI)."
- `docs/raw/feature/cut-lock-budget/adr.md`: 새 "결정 20. 같은 능력치 고정 교체와 핀 메뉴의 변동 메뉴 통합(빌드 중 개정 2026-11-21, 사용자 결정)"을 둔다.
  - 담을 내용:
    - 교체 규칙(`conflictingLocks`, H 밖 겹침).
    - 원자적 `add-lock`: 교체 해제는 해제 경로를 재사용하고, 다시 고정되는 능력치는 복원·자르기에서 뺀다. `base`를 함께 보낸다.
    - 고정 `allocation`과 파생의 H 최대: 남은 예산, 단계 정확, 완화 모드는 합 최소, H 공유 묶음은 H 최대 우선.
    - 성격은 기준 갈래로 반영한다.
    - 핀 메뉴 = 그 선택을 건 뒤의 파생으로 만든 변동 모양 모델 + `AdjustMenu`·`useAdjustMenu` 공유.
  - 기각:
    - 성격을 고정에 저장(▲·갈래 이중 조작).
    - 변동 격자 값 재사용(합치기·교체·H 최대에서 메뉴 값과 실제 고정 값이 어긋남).
    - 메뉴 복사(키보드·위치 규칙이 두 벌로 갈라짐).
    - 겹치는 고정을 막기만 하기(사용자는 교체를 골랐다).
  - 결정 1·9·13·17·19 끝에 "(2026-11-21 개정: 결정 20)" 한 줄 포인터를 단다.
- `docs/raw/feature/cut-lock-budget/notes.md`: "## 결정"에 2026-11-21 사용자 결정 두 줄(교체, 핀 = 변동 메뉴)과 이 notes 링크를 더한다.
- `docs/raw/bugfix/speed-sp-not-reflected/bugfix.md` 본문:
  - **증상**: 스피드 탭에서 SP 스피드 슬라이더를 마우스로 끌어 새 값에 놓는다. 그 뒤 숫자 입력이나 −/+로 S SP를 다시 바꾸면, 내 포켓몬 패널 실능치는 바뀌지만 스피드 탭의 "내 스피드" 기준선(띠)과 배지의 추월·동속 상태는 드래그로 놓은 값에 멈춘다. 다시 드래그하거나 새로고침해야 풀린다. 놓은 값이 원래 값과 같으면 생기지 않는다.
  - **영향**: 스피드 탭을 쓰는 모든 사용자. 기준선, 배지 상태(선공/동속/후공), 스피드 고정 판단이 실제 내 세트와 다른 값으로 보인다. 공격·방어 탭은 실행기 사본만 쓰므로 영향이 없다.
  - **원인**: 드래그 중 표시 SP는 두 곳에 있다. 화면 저장소(`ProductApp`의 `displaySp`, 스피드 차트가 구독)와 실행기 사본이다. 값이 바뀐 커밋 뒤에는 실행기 새 세대 `setInput`만 자기 사본을 비웠고, 화면 저장소는 비우지 않았다(`MySetPanel` 주석은 둘 다 비워진다고 가정했다). 그래서 스피드 차트가 드래그 마지막 값을 계속 썼다. 값이 같으면 `MySetPanel`이 `onDisplaySp(null)`을 직접 불러 증상이 없었다.
  - **수정**: `src/app/ProductApp.tsx`의 `Workspace`에 `useLayoutEffect`를 더해, 초안이 바뀌면 칠하기 전에 `displaySp.set(null)`한다. 커밋보다 먼저 비우면 드래그 전 값으로 튀므로, 커밋 뒤·칠하기 전에 비운다. `MySetPanel` 주석을 실제 책임에 맞게 고쳤다.
  - **회귀 방지**: `e2e/speed-chart.spec.ts`에 1건("슬라이더를 마우스로 끌어 새 값에 놓은 뒤 숫자 입력·−/+로 바꾸면 기준선 data-speed가 따라간다"). 단위 테스트는 React DOM 테스트 도구가 없어 두지 않았다.
  - **범위 추가(2026-11-21, 사용자 결정)**: 같은 능력치 고정 교체(B)와 공·방 핀 메뉴의 변동 메뉴 통합(C)을 이 단위에서 함께 고친다. 설계는 `notes.md` "설계 (B)(C)"에 있다. 정본 개정은 cut-lock-budget PRD R2·R3·R4·R13·AC17·AC18과 ADR 결정 20이다.

### 7. 구현 순서(권장)

1. (B) `conflictingLocks` + `checkLockCandidate` + 리듀서 `add-lock`·`releaseLocks(adding)` + 단위 테스트.
2. (C-파생) `CutLock.allocation`·`LockOptions.next`·`deriveLocks` H 최대·레인 `next` + 단위 테스트.
3. (C-모델) `lockPin.ts` `pinMenuView` + `CardLockPin.current` + 단위 테스트.
4. (C-화면) `useAdjustMenu` 추출(변동 E2E가 그대로 통과하는지 확인) → `AdjustMenu` variant → `CutPin` 분기 → `lockContext.pinMenu`/`pinLock` → `LockList` 표시.
5. E2E 헬퍼·기존 테스트 수정, 새 E2E, (A) E2E.
6. 6절 문서 개정. 게이트: `npx tsc -b`, `npm run lint`, `npm run test:run`, 관련 E2E(`product-cut-lock`·`product-adjust`·`speed-chart`), 그다음 전체 E2E.

## 결정 기록: 같은 능력치 고정 교체·핀 메뉴 통합 (cut-lock-budget ADR 후속, 2026-11-21)

> cut-lock-budget ADR은 accepted라 본문을 고칠 수 없어(harness:check), 그 ADR의 결정 1·9·13·17·19를 개정하는 이 결정을 여기 기록한다.


- **교체 규칙**: 새 고정과 H 밖 능력치가 겹치는 기존 고정은 교체된다(`cards conflictingLocks`). 스피드↔스피드, 같은 A·C, H+B↔다른 H+B, 공격 B(바디프레스)↔방어 H+B는 교체, 같은 대상의 다른 단계도 교체, H만 공유하는 H+B·H+D는 공존한다. 사용자 결정: "같은 스탯은 하나의 타겟만 고정", 기존 고정 교체.
- **원자적 `add-lock`**: 교체 해제·새 고정·기준 갈래 선택(`base`)·자동 조정 대기(`lockFit`)가 리듀서 액션 한 번(세대 +1 한 번)에 일어난다. 해제는 remove-lock과 같은 `releaseLocks` 경로를 재사용하고, 새 고정이 다시 고정하는 능력치(`adding`)는 복원·자르기에서 뺀다. 성격 복원은 최종 고정이 0개일 때만 한다. 같은 (대상, 단계, 배분)을 같은 기준으로 다시 걸면 상태 그대로다. `checkLockCandidate`도 교체될 고정을 빼고 판정한다.
- **고정 `allocation`과 파생의 H 최대**: 방어 쌍 고정은 `allocation?: 'h-max'`를 저장한다. `deriveLocks`는 H 최대 쌍이 든 묶음을 다른 묶음 합을 뺀 예산 안에서 H를 32부터 내려가며 단계를 정확히 내는(그 H의 B/D가 한 단계 위 계단 `next`에 닿지 않는) 가장 큰 H로 정하고, 없으면 합 최소로 둔다. SP 부족량을 재는 완화 모드는 합 최소로 센다(배분이 고정 가능 여부를 바꾸지 않는다). H를 공유하는 묶음에 H 최대 쌍이 하나라도 있으면 묶음 전체가 H 최대를 따른다. 레인은 H 최대 저난수 고정만 한 단계 위 계단 작업을 더한다.
- **성격은 기준 갈래로**: 핀 2단에서 고른 성격은 고정에 저장하지 않고 기준 갈래(`lockBase`, 결정 10)로 반영한다. 고정 줄 ▲로 나중에 바꿀 수 있다.
- **핀 메뉴 = 변동 모양 모델 + 같은 컴포넌트**: `cards pinMenuView`가 "그 선택을 실제로 건 뒤의 파생"으로 변동과 같은 모양(결과 × 성격 선택지, H 최대)의 모델을 낸다. 화면은 `AdjustMenu`(variant pin)와 `useAdjustMenu` 훅(열림·단계·포커스·위치·키보드)을 변동 팝오버와 공유한다. 고정 목록 SP는 파생 갈래 값으로 보이고 H 최대 고정에는 "H 최대" 표지를 단다.
- 기각: 성격을 고정에 저장(▲·갈래와 이중 조작), 변동 격자 값 재사용(H 공유 합치기·교체·H 최대에서 메뉴 값과 실제 고정 값이 어긋남), 메뉴 복사(키보드·위치 규칙이 두 벌로 갈라짐), 겹치는 고정을 막기만 하기(사용자는 교체를 골랐다), `add-lock` 뒤 `set-lock-base`를 따로 보내기(세대가 두 번 오르고 중간 상태에서 자동 조정이 다른 갈래로 한 번 돈다).
- 상세 설계: `docs/raw/bugfix/speed-sp-not-reflected/notes.md` "설계 (B)(C)".
