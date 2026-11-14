---
title: "공격·방어 탭 판정 행 기능 확장과 상세 화면 가시성 개편(상대 기술 표시·설정, 화력 도구 행)"
date: "2026-11-13"
stage: implementing
prd_status: pre-approved
adr_status: pre-accepted
---

# 작업 단계 원장: 공격·방어 탭 판정 행 기능 확장과 상세 화면 가시성 개편(상대 기술 표시·설정, 화력 도구 행)

이 파일은 이 작업 단위의 **단계 체크포인트**이자 **승인 증거**다. 새 세션이나
새 에이전트가 작업을 이어받을 때 **가장 먼저 이 파일을 읽어** 지금 어느 단계인지,
사전 승인(빌드 진입)·최종 확정(PR)을 이미 받았는지 판단한다. 채팅 히스토리가 아니라
이 원장이 단일 진실원이다.

규칙:

- **승인은 2단계다.** ① **사전 승인(pre-approval)** — 빌드(feature-develop) 진입 게이트로
  PRD를 `pre-approved`, ADR을 `pre-accepted`로 올린다(`## 승인 이벤트`에 `PREAPPROVAL`로 기록).
  ② **최종 확정(final approval)** — `$make-pr`에서 PR 직전에 PRD를 `approved`, ADR을 `accepted`로
  올린다(`APPROVAL`로 기록). 두 전환 모두 오직 `npm run harness:approve`(최종은 `--final`)로만 한다.
- `stage`와 `prd_status`/`adr_status`를 **손으로 승인 상태(pre-approved/approved/pre-accepted/
  accepted)로 바꾸지 않는다.** 각 상태는 대응하는 승인 이벤트가 기록되기 전에는 둘 수 없다
  (`harness:check`가 막는다): 사전 승인 이벤트 없이는 빌드에 못 들어가고, 최종 승인 이벤트 없이는
  PR을 만들 수 없다.
- **빌드 중 개정:** `pre-approved`인 동안 feature-develop 피드백으로 PRD/ADR을 고칠 수 있다.
  단 **사용자에게 개정 여부를 확인받은** 경우에만 고치고, 무엇을 왜 바꿨는지 `## 단계 로그`에 한
  줄 남긴다(상태는 `pre-approved`/`pre-accepted` 그대로). 최종 확정은 `$make-pr`에서 전체를 다시
  확인받아 이뤄진다.
- 단계가 바뀌면 `## 단계 로그`에 한 줄 append 하고 `stage`를 갱신한다.
- **`adr.md`는 `stage`가 `adr-draft` 이상으로 올라간 뒤에만 편집한다.** `$prd-helper`
  단계(`kickoff`/`prd-draft`/`prd-review`)에서는 `adr.md`를 스켈레톤 그대로 두고, ADR
  필요 여부·이유는 PRD `## ADR 필요 여부`에 남긴다(런타임 가드와 `harness:check`가 강제).
- 단계 순서: `kickoff` → `prd-draft` → `prd-review` → (ADR 필요 시 `adr-draft` →
  `adr-review`) → `pre-approved` → `implementing` → (`$make-pr`) `approved` → `integrated`.
  ADR이 불필요하면 ADR 단계를 건너뛰고 PRD 단독 **사전 승인**으로 `pre-approved`에 진입한다.
- 이 unit이 속한 **area(영역)**는 이 원장이 아니라 `prd.md`(feature)/`bugfix.md`(bugfix)
  frontmatter의 `area:`에 산다. wiki는 그 area의 `### 헤딩` 아래 시간순으로 이 unit을 잇고,
  `harness:check`가 선언한 area와 렌더된 헤딩의 일치를 강제한다.

## 단계 로그 (append-only)

- 2026-11-13 kickoff: raw 골격 생성
- 2026-11-13 prd-review: 1단계(판정 행 기술 선택) PRD 작성 — 사용자 결정 반영, 적대 리뷰(blocker 2·major 8) 반영. ADR 필요(행 모델·계산 범위·선택 상태·화면 배치)
- 2026-11-13 adr-review: ADR proposed 초안(결정 1~3 구조, 결정 4 화면 배치는 design-options.html 사용자 선택 대기). 서브에이전트 인증 오류로 오케스트레이터가 직접 작성
- 2026-11-13 pre-approved: 사용자 명시 사전 승인 (harness:approve)
- 2026-11-13 implementing: 1단계 구현·테스트 완료 — 단위 1006·기능 e2e 89·성능 e2e 5 통과, harness:gate ok. 미측정: 선택 반응 시간·깜박임/드래그 e2e·스크린샷(notes 검증). PRD "분류 기본 배분" 정의는 사용자 확인으로 고정 배분 우선 유지(PRD 본문 변경 없음), 구현을 PRD에 맞춤
- 2026-11-13 implementing: 사용자가 1단계 화면 확인 후 2단계(상세 가시성·화력 도구 행) 요구를 주기로 함 — 2단계 PRD 개정 대기
- 2026-11-13 implementing: 1단계 화면 피드백 반영(사용자 지시) — PRD R1·R3·AC1·AC4, ADR 결정 4 본문 개정: 기본·선공·분산·직접 표지 제거, 펼침 화살표를 기술 칩 테두리 안으로·크게(배분 배지 화살표도), 기술 배지 호버는 타입 색 기반. 고정 배분 우선 e2e 2건 갱신
- 2026-11-13 implementing: 화면 피드백 2 반영(사용자 지시) — 결과 목록 좌우 여백(스크롤바 폭), 줄 끝 펼침 화살표. 400px 기술 버튼 그리드 자리 결함 수정
- 2026-11-13 implementing: 1단계 개정(사용자 결정) — PRD R2(방어 후보 = 사용률 5%·나에게 1배 이상, 없으면 1위), R5(내 세트 SP·성격 외 변경 시 선택 해제), R8 신설(상대 기술 검색 추가, 메모리), AC25·26, ADR 결정 5. 새로고침 보존은 후속(명시적 세트 저장)
- 2026-11-13 implementing: 2단계 PRD 개정(사용자 요구) — R9 상세 정리(배분·기술 선택 제거, 랭크 배지·근거·접두·'다른 능력치에서'·빗금 제거), R10 방어 탭 내구 합계 띠(사용자 선택 대안 A), AC27~30, ADR 결정 6. 화력 도구 행은 요구 미정
- 2026-11-14 implementing: 2단계 개정(사용자 요구) — R11 내 포켓몬 교체 시 대표 세트 기본값·종별 수동 세트 기억(메모리)·아코디언 접기, 재계산 시 스크롤 유지, AC31·32
- 2026-11-14 implementing: 2단계 개정(사용자 결정) — 메가 폼 특성 고정 표시, R12 공격측 특성 날씨·필드(맞는 쪽 특성 제외), AC33, ADR 결정 7
- 2026-11-14 implementing: 2단계 개정(사용자 요구) — R12 필드 우선도 효과·방어 탭 스피드 비교 날씨, R13 바뀐 기술 타입 아이콘·색, AC34
- 2026-11-14 implementing: 2단계 개정(사용자 결정) — R14 방어 탭 상대 화력 도구 별도 줄(기본 줄 도구 없음, 점유율 ≥ 화력 도구 최소 5%), AC35, ADR 결정 8
- 2026-11-14 implementing: R14 리뷰 반영 — 기본·변형 줄 배분 선택 공유, 애크러뱃 보정 제외, 내던지기 후보 제외(PRD R14 문구 추가)
- 2026-11-14 implementing: 사용자 결정 — 화력 도구·반감열매 변형 줄의 배분 선택은 공유하지 않음(줄마다 따로), PRD R14·ADR 결정 8 문구 개정
- 2026-11-14 implementing: 사용자 결정 — 기술 선택 목록 항목 "변동" 배지(메뉴 열 때 우선 계산, 2026-11-13 결정 대체), 화력 도구 줄 점유율 표기 제거, AC36
- 2026-11-14 implementing: 사용자 결정 — R15 성묘 위력 항목 100·150·200(0기절 50 없음), 총대장은 후속, AC37
- 2026-11-14 implementing: 사용자 결정 — R4-1 기준 기술 = 판정 타입별 최고 채용률 기술 중 가장 센 것, R16 목록 정렬 = 기술 채용률 순(같은 기술 안 강한 순), AC38
- 2026-11-14 implementing: 사용자 결정 — R4-1 재개정: 방어 탭 기준 기술 = 선공기 제외 채용률 ≥ 20% 주력 기술 중 센 순 첫 변동 기술(모두 고정이면 최강), 타입별 대표 폐기, AC38 갱신
## 승인 이벤트

<!-- 이 블록은 `npm run harness:approve`만 기록한다. 사용자의 명시 승인 발화가
     verbatim으로 남는다. 두 종류: `PREAPPROVAL`(사전 승인 — 빌드 진입 게이트)과
     `APPROVAL`(최종 확정 — $make-pr, PR 직전). harness:check가 이 이벤트와 PRD/ADR
     status의 정합성을 교차검증한다. 손으로 위조하면 여러 아티팩트를 동시에 조작해야
     하며 감사에 드러난다. -->

- PREAPPROVAL prd 2026-11-13 harness:approve :: 사전 승인
- PREAPPROVAL adr 2026-11-13 harness:approve :: 사전 승인
