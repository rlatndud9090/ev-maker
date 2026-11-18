---
area: SP 구간 표
---

# 함정: SP 구간 표

### G-261117-power-item-engine-unsupported: 화력 도구 줄 근거 기술 후보에서 엔진 미지원 기술(집단구타 등)을 빼야 한다
> 발견: 2026-11-17 · 유형: 규칙불충분 · area: SP 구간 표 · 출처: docs/raw/feature/speed-tab-revamp/notes.md (빌드 중 개정 6차, 상위 N 100) · 코드: `src/cards/powerItems.ts:powerItemBoosts` · 봉인: `src/cards/powerItems.test.ts` (beatup 회귀)

**규칙:** 화력 도구가 대미지를 키우는지 판정할 때 `manifest.engineUnsupported.moves`(예: beatup 집단구타)에 든 기술은 근거 후보에서 뺀다. 엔진이 그 기술의 대미지를 계산하지 못하므로 "도구가 화력을 올린다"는 판정 근거가 될 수 없다.

**왜:** 상위 N 기본값을 30→100으로 넓히자 드래펄트의 집단구타가 방어 탭 생명의구슬 화력 도구 줄의 근거 기술로 잡혔다(상위 30에서는 드러나지 않음). 수용 테스트 AC35가 이를 잡아냈다.
