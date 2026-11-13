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
