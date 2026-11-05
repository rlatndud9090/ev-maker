---
title: "챔피언스 계산 코어(SP 어댑터·스피드 엔진)와 게임 데이터·한국어 매핑"
date: "2026-11-04"
stage: approved
prd_status: approved
adr_status: accepted
---

# 작업 단계 원장: 챔피언스 계산 코어(SP 어댑터·스피드 엔진)와 게임 데이터·한국어 매핑

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

- 2026-11-04 kickoff: raw 골격 생성
- 2026-11-04 prd-review: PRD 초안 작성 후 3개 관점 리뷰 2라운드를 돌려 적대 검증을 통과한 지적 42건을 반영하고 review로 올림. ADR 필요로 판정
- 2026-11-04 prd-review: 사용자 피드백 반영(트릭룸 배제, 판정을 1타 여부로 축소, 공격·방어 관점 1타 확률 구간 도입). 상태는 review 유지
- 2026-11-04 adr-draft: adr-helper 진입, ADR 작성 시작
- 2026-11-04 adr-review: ADR 결정 7개 초안 작성. 3개 관점 리뷰를 돌려 검증을 통과한 지적 26건과 추가 실측(엔진 깨진 기술 11개)을 반영했다. 그에 맞춰 PRD F6·데이터 정합 요구와 수용 기준을 수치 주입 기준으로 고쳤다(PRD는 review 유지)
- 2026-11-04 adr-review: ADR 리뷰 2라운드에서 검증을 통과한 지적 19건을 반영했다(주입 범위, 메가 특성, 엔진 미지원 범위, 스냅샷 동결·원천 시각, 결과 형태 등). PRD의 "생성 시점"은 "원천 기준 시각"으로 맞췄다
- 2026-11-04 pre-approved: 사용자 명시 사전 승인 (harness:approve)
- 2026-11-04 implementing: feature-develop 진입. 스캐폴드·계약을 깔고 구현 워크플로(데이터‖독립 기준값 → 코어 → UI‖수용 기준 → 적대 검증·수정)를 돌렸다
- 2026-11-05 implementing: 사용자 확인("전부 개정")을 받아 빌드 중 개정
  - PRD: 깨진 기술 11개 수용 기준을 "스냅샷에 있으면"으로 고치고 합성 스냅샷으로 검증한다(현 원천에서 사용 불가). 비율 표시를 소수 첫째 자리 내림으로 정했다
  - ADR 결정 2·4: 위력 0 공격기 엔진 실행 판정, 엔진 미지원 기술의 계산 시점 거부, 스피드 의존 기술 대조·거부, 옹골참·기합의띠·탈 처리, 추가 스피드 보정과 미지원 보정 거부를 추가했다
- 2026-11-05 approved: 사용자 명시 최종 승인 (harness:approve --final)
## 승인 이벤트

- APPROVAL prd 2026-11-05 make-pr :: 진행 + 공개 저장소
- APPROVAL adr 2026-11-05 make-pr :: 진행 + 공개 저장소

<!-- 이 블록은 `npm run harness:approve`만 기록한다. 사용자의 명시 승인 발화가
     verbatim으로 남는다. 두 종류: `PREAPPROVAL`(사전 승인 — 빌드 진입 게이트)과
     `APPROVAL`(최종 확정 — $make-pr, PR 직전). harness:check가 이 이벤트와 PRD/ADR
     status의 정합성을 교차검증한다. 손으로 위조하면 여러 아티팩트를 동시에 조작해야
     하며 감사에 드러난다. -->

- PREAPPROVAL prd 2026-11-04 harness:approve :: 사전 승인
- PREAPPROVAL adr 2026-11-04 harness:approve :: 사전 승인

## 지식 기록

- KNOWLEDGE 2026-11-05 invariants=INV-261105-engine-inject-snapshot,INV-261105-ohko-own-distribution,INV-261105-app-speed-no-engine,INV-261105-legal-rule-forme-name,INV-261105-snapshot-deterministic,INV-261105-mega-ko-nospace gotchas=none via=make-pr
