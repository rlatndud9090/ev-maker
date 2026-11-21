---
area: SP 구간 표
---

# 불변식: SP 구간 표

### INV-261113-attack-opp-no-item: 공격 탭 래더 상대 기본 카드는 가정 세트 도구를 지우고(메가스톤만 유지) 반감열매는 별도 열매 변형 카드로만 다룬다
> area: SP 구간 표 · 출처: docs/raw/feature/sp-sweep-table/adr.md#결정-1 · 코드: `src/cards/plan.ts:planTab`, `src/core/damage.ts:survivesFirstHitAtFullHp`, `src/cards/berries.ts:berryActivates` · 봉인: `src/cards/berries.test.ts` "공격 탭 상대 도구: 기본 카드는 도구 없음, 반감열매는 별도 변형 카드"

**위반 시:** 대표 도구가 기합의띠인 상대(예: 대쓰여너)는 코어 풀HP 견딤 판정 때문에 모든 배분이 확정견딤이 되어 카드가 변화 없음으로 사라지고, 반감열매가 기본 카드에 섞이면 열매 없는 판정이 사라진다.

### INV-261113-rank-active-means-only: 랭크 조건 수단은 스스로 자기에게 거는 능동 수단만 쓰고, 래더 상대 수단의 판정 기술은 동시채용 하한 또는 대표 세트 동시 포함으로 거른다
> area: SP 구간 표 · 출처: docs/raw/feature/sp-sweep-table/adr.md#결정-1 · 코드: `src/cards/rankMeans.ts:isActiveMeans`, `src/cards/rankMeans.ts:FIRST_TURN_ONLY_MOVES`, `src/cards/rank.ts:rankMoveAllowed`, `src/cards/rank.ts:coAdoptionFloor`, `src/cards/rank.ts:TAB_MEANS_OWNERS` · 봉인: `src/cards/rank.test.ts`

**위반 시:** 위협·막말내뱉기 같은 하락이나 오기·승기 반응이 랭크 행을 만들고, 함께 채용되지 않는 수단×기술 조합(하한 max(0,a+b−1) < rankShareMin)이나 랭크업 뒤 쓸 수 없는 첫 턴 전용 기술 행이 생겨 SP 배분 기준이 왜곡된다.

### INV-261113-engine-boost-not-means: 엔진이 공격 자체에 적용하는 자기 랭크업(메테오빔·일렉트로빔)은 랭크 수단에 넣지 않고 명시 제외 목록에 둔다
> area: SP 구간 표 · 출처: docs/raw/feature/sp-sweep-table/adr.md#결정-1, docs/raw/feature/sp-sweep-table/adr.md#결정-2 · 코드: `src/cards/rankMeans.ts:RANK_MEANS_EXCLUDED` · 봉인: `src/cards/rankMeans.test.ts` "확률 부가효과(문포스)·엔진 자체 상승(메테오빔)·순풍은 수단이 아니다"

**위반 시:** 엔진(@smogon/calc)이 이미 C+1을 반영한 공격에 수단 랭크가 한 번 더 들어가 C+2로 이중 적용되어 랭크 행 판정이 과대평가된다.

### INV-261115-attacker-field-only: 대미지 판정의 날씨·필드는 그 판정 공격측 해결 특성에서만 유도하고 맞는 쪽 특성은 보지 않는다
> area: SP 구간 표 · 출처: docs/raw/feature/damage-tabs-row-revamp/adr.md#결정-7 · 코드: `src/core/fieldAbilities.ts:withAttackerField`, `src/cards/plan.ts:damageConditions` · 봉인: `src/core/fieldAbilities.test.ts`, `src/cards/plan.test.ts` (어흥염 vs 메가리자몽Y 양방향)

**위반 시:** 맞는 쪽이 까는 날씨로 내 화력이 올라가 낙관 판정이 된다(내 어흥염 플레어드라이브가 상대 메가리자몽Y 가뭄의 쾌청으로 계산됨). 더블에서 실제 날씨는 정할 수 없으므로 공격측이 스스로 까는 날씨만 확실하다.

### INV-261117-relevant-item-only: 도구 표시는 그 판정 계산에 효과를 준 도구만 하고, 스피드 도구 효과 판정은 core 공식 함수로만 한다
> area: SP 구간 표 · 출처: docs/raw/feature/speed-tab-revamp/adr.md#결정-4, docs/raw/feature/speed-tab-revamp/adr.md#결정-5 · 코드: `src/core/speed.ts:speedItemApplies`, `src/core/speed.ts:SPEED_ITEM_MODIFIERS`, `src/cards/speedChart.ts`, `src/app/components/text.ts:cardItemOf`, `src/cards/iconTargets.ts` · 봉인: `src/cards/speedChart.test.ts` "기본 배지는 스카프 없는 가정 세트이고, 표시 도구(item)는 스피드 배수를 건 도구뿐이다", `src/ui/images.test.ts`(받기 목록 = 매니페스트 = 대상 집합), `e2e/speed-chart.spec.ts`

**위반 시:** 생명의구슬·메가스톤처럼 판정에 효과가 없는 도구가 아이콘으로 떠 사용자가 그 도구가 계산에 반영된 것으로 오해하고 공간만 차지한다(사용자 결정 2026-11-17). UI에 스피드 도구 목록을 따로 두면 core 공식(무딘손 무효 포함)과 표시가 어긋나고, 쓰이지 않는 아이콘 자산·고지가 번들에 남는다.

### INV-261117-speed-base-scarf-free: 스피드 차트 기본 배지는 늘 스카프 없는 세트이고 구애스카프는 기준 이상일 때 조건 배지로만 나온다
> area: SP 구간 표 · 출처: docs/raw/feature/speed-tab-revamp/adr.md#결정-3 · 코드: `src/cards/speedChart.ts:scarfFreeSet`, `src/cards/speedChart.ts:scarfConditionOf` · 봉인: `src/cards/speedChart.test.ts` "스카프: 대표 도구가 스카프여도 기본 배지는 스카프 없는 세트이고, 스카프 배지는 구애스카프 점유율로만 붙는다", `e2e/speed-chart.spec.ts` AC11(스카프 필터 off → 구애스카프 래더 배지 0)

**위반 시:** 대표 도구가 구애스카프인 상대(예: 한카리아스)의 기본 배지가 스카프 세트가 되어, 스카프 필터를 꺼도 스카프 속도가 차트에 남고 "기본 = 스카프 없음"이라는 사용자 기대(2026-11-17)와 어긋난다. 상위 단위의 "대표 도구가 스카프면 스카프 아닌 최다 도구 행" 규칙으로 되돌리지 않는다.

### INV-261117-speed-weather-opponent-only: 스피드 날씨·필드 배지는 상대 세트에만 날씨를 걸고 날씨 무효 판정은 내 특성으로만 한다
> area: SP 구간 표 · 출처: docs/raw/feature/speed-tab-revamp/adr.md#결정-2, docs/raw/feature/speed-tab-revamp/adr.md#결정-3 · 코드: `src/cards/speedChart.ts` (fieldConditions, fieldAllowed — 내 특성의 WEATHER_NEGATING_ABILITIES만 봄) · 봉인: `src/cards/speedChart.test.ts`(내 구름보기·에어록이면 날씨 배지 없음, 서핑테일은 남음), `src/core/speed.test.ts`(상대 단독 finalSpeed는 자기 특성만 본다)

**위반 시:** 날씨를 양쪽 공통 입력으로 넣으면 내 기준선까지 날씨가 걸리거나(내 쓱쓱이 비에서 ×2), 상대 세트의 날씨 무효 특성 처리와 섞여 "파트너가 날씨를 깐다고 가정한 상대 속도"라는 조건 배지 의미가 깨진다. 대미지 판정의 INV-261115-attacker-field-only와는 다른 축이다(스피드 날씨 배지는 가정 조건).

### INV-261119-added-only-opponent: 표시 범위 밖 '추가분만' 상대는 사용자 추가 배분만 내고 씨앗 중복 기준을 빈 집합에서 시작한다
> area: SP 구간 표 · 출처: docs/raw/feature/add-pokemon-ux/adr.md#결정-1 · 코드: `src/cards/plan.ts:opponentsOf`, `src/cards/plan.ts:userSeeds`, `src/cards/speedChart.ts:ladderSpeedOpponent`, `src/cards/range.ts` · 봉인: `src/cards/plan.test.ts` "1위·관측 묶음과 같은 SP를 넣어도 추가분만 상대에는 카드가 실제로 생긴다", `src/cards/speedChart.test.ts` "범위 밖 추가분만 상대: 1위 묶음과 같은 배분도 추가 배지가 되고, 추가 배분을 지우면 사라진다"

**위반 시:** 범위 밖 포켓몬에 1위 값을 넣으면 판정은 ok인데 씨앗 단계가 관측 키로 걸러 카드·배지가 생기지 않거나, 반대로 관측·기본·조건 줄이 새어 상위 N 밖 포켓몬이 통째로 나타난다.

### INV-261119-addition-judge-same-seeds: 배분 추가 판정은 화면 표시와 같은 씨앗 함수에서 낸 표시 키로만 한다
> area: SP 구간 표 · 출처: docs/raw/feature/add-pokemon-ux/adr.md#결정-1 · 코드: `src/cards/addition.ts`, `src/cards/plan.ts:opponentSeeds`, `src/cards/speedChart.ts:ladderSpeedOpponent` · 봉인: `src/cards/plan.test.ts` "범위 밖 추가분만 상대와 목록 밖 추가 배분도 cards 키 = planTab 기본 카드 키", `src/cards/addition.test.ts`

**위반 시:** 진입점(패널·배지 상세·카드 '직접 추가')이 자체 비교식을 쓰면 표시 규칙과 갈라져 "화면에 보이는데 추가됨" 또는 "안 보이는데 이미 존재합니다"가 생긴다.

### INV-261120-no-lock-identity: 고정이 없으면 카드 층 출력(옵션 없는 탭 뷰·스피드 차트·사다리·코어 스피드)은 변경 전과 바이트 단위로 같아야 하고, 봉인 fixture를 기능 작업으로 갱신하지 않는다
> area: SP 구간 표 · 출처: docs/raw/feature/cut-lock-budget/adr.md#결정-18, docs/raw/feature/cut-lock-budget/adr.md#결정-3 · 코드: `src/cards/batch.ts:buildTabView`, `src/cards/speedChart.ts:buildSpeedChart`, `src/cards/natures.ts:natureVariants`, `src/core/speed.ts` · 봉인: `src/acceptance/no-lock-identity.test.ts` "무고정 동일성 지문(변경 전 코드로 봉인, 기능 작업이 fixture를 갱신하면 안 된다)"

**위반 시:** 고정 필드·고정 중 예산·하락 경고·엄격 변형·합계 강등 같은 새 경로가 무고정 상태로 새어 들어와 고정을 한 번도 쓰지 않는 사용자의 판정이 조용히 바뀐다. 새 필드는 옵션(`options.adjust`·고정 입력·코어 맨 뒤 옵션 인자)이 있을 때만 붙인다. 화면에 더해지는 것은 첫 고정용 조작(핀·조정 버튼)뿐이다.

### INV-261120-lock-stages-two-per-side: 공격·방어 컷 고정 단계는 LOCK_STAGES의 두 단계(공격 고난수1타·확정1타, 방어 저난수1타·확정견딤)만 두고 현재 판정과 무관하게 메뉴에 내며, 스피드는 선공 하나로 바로 고정한다
> area: SP 구간 표 · 출처: docs/raw/feature/cut-lock-budget/adr.md#결정-6, docs/raw/feature/cut-lock-budget/adr.md#결정-17 · 코드: `src/cards/assemble.ts:LOCK_STAGES`, `src/cards/assemble.ts:lockControl` · 봉인: `src/cards/assemble-lock.test.ts` "AC11: …(현재 판정과 무관하게 두 단계)", "방어: 현재 판정이 고난수1타인 카드…도 두 단계 조작이고…"

**위반 시:** "현재 + 1 단계"처럼 현재 판정에 묶으면 가장 약한 판정 구간 카드에 고정 수단이 사라지고(빌드 중 개정의 원인), 단계를 늘리면 핀 메뉴 후보 해석 작업이 단계 수만큼 늘어난다. 방어 "고난수견딤"은 화면에서 "저난수1타"로 표기한다.

### INV-261120-lock-blocked-reason-split: 핀 고정 불가 사유는 "판정이 SP와 무관(fixed-value)"과 "어느 단계에도 닿지 않음(unreachable-stage)"을 구분하며, 모든 단계가 계산되고 SP 투자로 닿는 선택지가 하나도 없을 때만 막는다
> area: SP 구간 표 · 출처: docs/raw/feature/cut-lock-budget/adr.md#결정-6 · 코드: `src/cards/assemble.ts:lockBlockedReason`, `src/cards/types.ts:CardLockPin`, `src/app/components/lockText.ts` · 봉인: `src/cards/assemble-lock.test.ts` "낮은 단계가 SP 0에서 이미 충족되면 fixed-value…", "어느 단계에도 닿지 않으면 … unreachable-stage"

**위반 시:** 가장 낮은 단계가 SP 0에서 충족되는 카드(공격 탭도 방어 탭과 같이)를 "단계 미도달"로 안내하거나, 계산 중·일부 단계만 SP 0인 카드를 막아 고정할 수 있는 컷을 잃는다. 탭 사이 사유 문구가 어긋난다.

### INV-261120-lock-nature-minus-avoid: 고정 중 갈래·행·레인·조정 성격은 lockNature 한 규칙으로 정하고, 하락은 고정·보는·관여 능력치에 두지 않는다
> area: SP 구간 표 · 출처: docs/raw/feature/cut-lock-budget/adr.md#결정-4 · 코드: `src/cards/lockNature.ts:branchNature`, `src/cards/lockNature.ts:rowNature`, `src/cards/lockNature.ts:strictVariants`, `src/cards/lockNature.ts:laneNature` · 봉인: `src/cards/lockNature.test.ts` "속성: 결과 성격의 하락은 avoid·상승 밖이고…", "셸사이드암형(A·C·B·D 관여) + S 고정: 자리 없음 → 갈래 성격 그대로 + dropWarning"

**위반 시:** 한 호출처라도 갈래 성격을 그대로 쓰거나 기존 자동 하락 규칙을 쓰면 하락이 보는·관여 능력치에 떨어져 손으로 맞춘 세트와 다른 표가 나온다. 자리가 없는 행은 빼지 않고 갈래 성격 그대로 계산하고 하락 경고 표지를 단다.

### INV-261120-lock-overflow-trim-user-only: 합계 66 초과 자동 줄이기(고정 밖 능력치 H→A→B→C→D→S)는 사용자 조작(핀 고정·기준 갈래 변경·조정 적용) 직후 한 번만 하고, 재계산으로 생긴 초과는 경고 강등으로 둔다
> area: SP 구간 표 · 출처: docs/raw/feature/cut-lock-budget/adr.md#결정-3, docs/raw/feature/cut-lock-budget/adr.md#결정-19 · 코드: `src/app/state.ts:reducer` (fit-locks·apply-adjust 액션, lockFit 토큰) · 봉인: `src/app/state-lock.test.ts` "R19 고정 초과 자동 조정(fit-locks)", `src/app/state-adjust.test.ts` "조정·keep 능력치는 두고 나머지를 H→S 순서로 줄여…"

**위반 시:** 도구·특성 변경 같은 재계산마다 SP가 사용자 몰래 깎이거나, 반대로 사용자 조작 뒤 넘친 채로 남아 매번 손으로 줄여야 한다. 고정 능력치·조정·keep 능력치는 줄이지 않고, 기준 갈래가 없으면(null) 줄이지 않는다.

### INV-261120-adjust-exact-result: 조정 팝오버의 결과 목록·선택지는 그 결과를 "정확히" 내는 선택지만 쓰고, 고르면 더 좋은 결과로 건너뛰는 선택지는 unreachable로 비활성한다
> area: SP 구간 표 · 출처: docs/raw/feature/cut-lock-budget/adr.md#결정-19 · 코드: `src/cards/adjust.ts:adjustView`, `src/app/adjustAction.ts:adjustAction` · 봉인: `src/cards/adjust.test.ts` "상승 바닥(A0+)이 이미 더 좋은 결과면 낮은 결과에서 상승은 unreachable…", "비단조 칸에서도 각 결과의 SP는 그 결과 이상의 실제 최소이고, 더 좋은 결과와 같은 비용인 결과는 빠진다", `src/cards/adjust-acceptance.test.ts`

**위반 시:** "이 결과의 최소 SP로 맞춘다"는 조정의 뜻이 깨져, 낮은 결과를 골랐는데 다른(더 좋은) 결과가 적용되거나 같은 비용의 낮은 결과가 목록에 중복으로 남는다. 최소 SP는 새 판정 규칙 없이 기존 변형 스윕·쌍 계단 산출물로만 계산한다.

### INV-261121-speed-lock-badge-one-rule: 스피드 고정↔배지 연결은 speedLockBadge 하나로만 찾는다
> area: SP 구간 표 · 출처: docs/raw/feature/speed-bundles-pin-disable/adr.md#결정-2 · 코드: `src/cards/speedLock.ts:speedLockBadge`, `src/app/components/SpeedChart.tsx` · 봉인: `src/cards/speedLock.test.ts`

**위반 시:** SP 배분 기준을 바꿔 배지가 기본↔추가로 바뀌면, 해석은 이어지는데 차트 핀이 빈 핀으로 보여 누르면 고정 해제 대신 교체가 된다.
