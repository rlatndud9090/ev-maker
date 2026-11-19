---
title: "포켓몬 추가 UI/UX 개선"
date: "2026-11-18"
stage: approved
prd_status: approved
adr_status: accepted
---

# 작업 단계 원장: 포켓몬 추가 UI/UX 개선

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

- 2026-11-18 kickoff: raw 골격 생성
- 2026-11-18 prd-review: PRD를 review로 작성했다(사용자 인터뷰 3라운드, 코드 조사, 3렌즈 리뷰와 반박 검증 반영). ADR 필요로 판정해 $adr-helper로 넘긴다(결정 1 데이터 모델·판정 경계, 결정 2 패널 화면 배치).
- 2026-11-18 adr-review: ADR을 proposed로 작성했다. 결정 1은 파생 질의안(출처 판별자, 범위 밖 파생, 순수 판정 모듈)이고 결정 2는 패널 배치 대안 A(한 줄 스텝)로, 둘 다 사용자가 선택했다. PRD R7·열린 질문을 확정했고, 2렌즈 ADR 리뷰에서 반박 검증을 통과한 5건을 반영했다.
- 2026-11-18 pre-approved: 사용자 명시 사전 승인 (harness:approve)
- 2026-11-18 implementing: ADR 순서 S1~S6(판별자·추출·판정 모듈·범위 밖 노출·패널/진입점·e2e)을 구현했다. 자체 코드리뷰에서 확정 결함 4건을 수정했고 harness:gate를 통과했다(PRD·ADR 개정 없음).
- 2026-11-18 빌드 중 개정(사용자 확인): 화면을 확인한 사용자가 "가로가 너무 길고, 공간을 밀어내는 게 싫다"고 해서 바꿨다. '포켓몬 추가' 패널과 스피드 배지 상세를 앵커 팝오버로 띄운다(폭 약 360px, 좁은 화면은 하단 시트). PRD에 R11과 수용 기준을 추가했다. ADR 결정 2를 고치고 결정 3을 추가했으며, supersedes에 speed-tab-revamp 결정 1의 상세 형태 조항(부분 대체)을 적었다.
- 2026-11-19 빌드 중 개정(사용자 확인): 사용자가 "추가할 때 왜 성격 보정을 못 하냐"고 해서 공·방 추가 배분에도 핵심 능력치별 ▲▼ 성격 보정을 넣기로 했다(패널·카드 '직접 추가' 모두). PRD R3·R4·R6·비기능·수용 기준을 개정하고 ADR 결정 1·2·검증의 "공·방 무보정" 규칙을 바꿨다.
- 2026-11-19 approved: 사용자 명시 최종 승인 (harness:approve --final)
## 승인 이벤트

- APPROVAL prd 2026-11-19 make-pr :: 그래 확인했다. /make-pr 하고 곧바로 /lph:merge-and-clean 진행좀
- APPROVAL adr 2026-11-19 make-pr :: 그래 확인했다. /make-pr 하고 곧바로 /lph:merge-and-clean 진행좀

<!-- 이 블록은 `npm run harness:approve`만 기록한다. 사용자의 명시 승인 발화가
     verbatim으로 남는다. 두 종류: `PREAPPROVAL`(사전 승인 — 빌드 진입 게이트)과
     `APPROVAL`(최종 확정 — $make-pr, PR 직전). harness:check가 이 이벤트와 PRD/ADR
     status의 정합성을 교차검증한다. 손으로 위조하면 여러 아티팩트를 동시에 조작해야
     하며 감사에 드러난다. -->

- PREAPPROVAL prd 2026-11-18 harness:approve :: 사전 승인
- PREAPPROVAL adr 2026-11-18 harness:approve :: 사전 승인

## 지식 기록

- KNOWLEDGE 2026-11-19 invariants=INV-261119-added-only-opponent,INV-261119-addition-judge-same-seeds gotchas=G-261119-added-bundle-source-compare via=make-pr
