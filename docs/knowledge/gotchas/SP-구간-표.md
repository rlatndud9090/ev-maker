---
area: SP 구간 표
---

# 함정: SP 구간 표

### G-261117-power-item-engine-unsupported: 화력 도구 줄 근거 기술 후보에서 엔진 미지원 기술(집단구타 등)을 빼야 한다
> 발견: 2026-11-17 · 유형: 규칙불충분 · area: SP 구간 표 · 출처: docs/raw/feature/speed-tab-revamp/notes.md (빌드 중 개정 6차, 상위 N 100) · 코드: `src/cards/powerItems.ts:powerItemBoosts` · 봉인: `src/cards/powerItems.test.ts` (beatup 회귀)

**규칙:** 화력 도구가 대미지를 키우는지 판정할 때 `manifest.engineUnsupported.moves`(예: beatup 집단구타)에 든 기술은 근거 후보에서 뺀다. 엔진이 그 기술의 대미지를 계산하지 못하므로 "도구가 화력을 올린다"는 판정 근거가 될 수 없다.

**왜:** 상위 N 기본값을 30→100으로 넓히자 드래펄트의 집단구타가 방어 탭 생명의구슬 화력 도구 줄의 근거 기술로 잡혔다(상위 30에서는 드러나지 않음). 수용 테스트 AC35가 이를 잡아냈다.

### G-261119-added-bundle-source-compare: 추가 배분의 상대 id는 출처(ladder/custom)와 함께 비교한다
> 발견: 2026-11-19 · 유형: 규칙부재 · area: SP 구간 표 · 출처: docs/raw/feature/add-pokemon-ux/adr.md#결정-1 · 코드: `src/cards/ids.ts`, `src/app/state.ts`, `src/cards/plan.ts:userSeeds`, `src/cards/groups.ts`

**규칙:** 추가 배분·스피드 추가 배분·고정 항목을 비교하거나 거를 때는 상대 id만 보지 말고 출처(`source`: ladder/custom)를 함께 본다. 추가·삭제·고정 해제·연쇄 삭제가 모두 같은 키를 써야 한다.

**왜:** 메타 월·매치 방식을 바꾸면 목록 밖 rosterId가 메타 항목 id와 같아질 수 있다. 출처를 빼고 비교하면 목록 밖 추가 배분이 조용히 메타 래더 배분으로 바뀌고 범위 밖 노출까지 일으킨다(ADR 설계 비교에서 발견).
