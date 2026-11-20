---
title: "컷 고정과 남은 SP 예산 기반 타 탭 재계산"
date: "2026-11-18"
stage: approved
prd_status: approved
adr_status: accepted
---

# 작업 단계 원장: 컷 고정과 남은 SP 예산 기반 타 탭 재계산

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
- 2026-11-18 prd-review: 인터뷰 결정 반영해 PRD를 review로 작성, ADR 필요로 판정
- 2026-11-18 adr-draft: adr-helper 진입
- 2026-11-18 adr-review: 2라운드 설계 워크플로 결과로 ADR 결정 1~18 proposed 작성, 디자인 비교 대안 A 확정(고정 목록은 SP 블록 아래), PRD 동기화
- 2026-11-18 pre-approved: 사용자 명시 사전 승인 (harness:approve)
- 2026-11-18 implementing: feature-develop 진입(계층별 구현 워크플로)
- 2026-11-18 implementing: 빌드 중 ADR 개정(사용자 확인) — 결정 12 계단 모드에서도 합계 띠용 쌍 작업 실행, 결정 18 동일성은 판정·목표 기준이고 고정 0개여도 컷 고정 토글 표시. 구현·검증·ingest·gate 통과
- 2026-11-18 implementing: 빌드 중 PRD/ADR 개정(사용자 확인) — 고정 조작을 카드 줄·배지의 포켓몬 이미지 앞 핀으로 이동, 빈 핀은 단계 선택 메뉴, 찬 핀은 해제, 상세 버튼 제거(PRD R2, ADR 결정 17). 개발 서버 탭 제목에 브랜치 작업 라벨(vite.config.ts)
- 2026-11-19 implementing: 빌드 중 PRD/ADR 개정(사용자 확인) — "표 기준" 라디오·성격 안내 문구 제거, 고정 능력치 SP 줄은 슬라이더 유지+조작 잠금+색 구분, 그 줄 ▲로 기준 갈래 선택·▼ 비활성(PRD R10·R12), 고정 목록 항목 표시 정리(PRD R14, ADR 결정 17)
- 2026-11-19 implementing: 빌드 중 PRD/ADR 개정(사용자 요청) — SP 숫자 입력·−/+도 32/66 상한(PRD R18), 핀 고정·기준 갈래 변경으로 초과 시 고정 밖 능력치를 H→S 순서로 줄여 66에 맞춤(PRD R19, ADR 결정 3). ADR 결정 15(고정 중 성격 수정 허용·첫 고정 직전 성격 보관) 개정은 사용자 확인 대기
- 2026-11-19 implementing: ADR 결정 15 개정 사용자 확인("개정 반영하고 링크 내놔 테스트하게") 반영. R18·R19 구현·검증 완료(test:run 1490 통과)
- 2026-11-19 implementing: 사용자 지적 수정 — 공격 탭도 방어 탭처럼 모든 단계가 SP 0에서 충족되거나 닿지 않으면(판정이 SP와 무관) 핀을 "SP와 무관한 판정이라 고정 불가"로 막는다(탭 간 일관성, PRD R1 범위 안)
- 2026-11-19 implementing: 빌드 중 PRD/ADR 대규모 개정(사용자 요청, 이번 단위에 합치기로 선택) — 아코디언 상세 제거, "조정" 버튼 → 결과 목록 → 성격 선택 2단 팝오버로 배분 변경(PRD R20~R26, ADR 결정 19). 디자인 비교 시안 확인 후 구현
- 2026-11-20 implementing: 조정 팝오버(대안 A) 구현·검증 완료 — harness gate 통과(test:run 1518), E2E 전체 179 통과, 성능 공격 1.24배·방어 0.33배·스피드 0.88배(기준 3배)
- 2026-11-20 implementing: 빌드 중 PRD 개정(사용자 결정) — 버튼 이름 "조정"→"변동"+아래 꺾쇠, 낮은 결과 유지, 버튼 제거는 변동 없음 카드만(R21)
- 2026-11-20 implementing: 빌드 중 PRD 개정(사용자 결정) — 변동 목록 1단 SP는 내 세트 성격 기준(상승 찍은 능력치면 보정, 아니면 무보정, 보정으로만 닿으면 보정)(R22)
- 2026-11-20 implementing: 사용자 결정 — 변동 목록의 "현재" 글자 배지 제거(왼쪽 보라 강조·aria-current만 유지, "현재"라는 말이 최소 SP로 내리는 동작과 안 맞음)
- 2026-11-20 implementing: 빌드 중 PRD 개정(사용자 요청·결정) — 방어 2단에 성격별 "합 최소"/"H 최대" 두 배분(R23), H·B·D 제시 상황(반대쪽 쌍 고정)에는 H 최대 없음. test:run 1528 통과, 변동·컷 고정 E2E 46 통과
- 2026-11-20 implementing: 사용자 결정 — 방어 1단 대표 SP를 H 최대 배분으로(없으면 합 최소). 변동·컷 고정 E2E 46 통과
- 2026-11-20 approved: 사용자 명시 최종 승인 (harness:approve --final)
## 승인 이벤트

- APPROVAL prd 2026-11-20 make-pr :: 일단 너는 /make-pr 하고, 바로 /lph:merge-and-clean 까지 하자.
- APPROVAL adr 2026-11-20 make-pr :: 일단 너는 /make-pr 하고, 바로 /lph:merge-and-clean 까지 하자.

<!-- 이 블록은 `npm run harness:approve`만 기록한다. 사용자의 명시 승인 발화가
     verbatim으로 남는다. 두 종류: `PREAPPROVAL`(사전 승인 — 빌드 진입 게이트)과
     `APPROVAL`(최종 확정 — $make-pr, PR 직전). harness:check가 이 이벤트와 PRD/ADR
     status의 정합성을 교차검증한다. 손으로 위조하면 여러 아티팩트를 동시에 조작해야
     하며 감사에 드러난다. -->

- PREAPPROVAL prd 2026-11-18 harness:approve :: 사전 승인
- PREAPPROVAL adr 2026-11-18 harness:approve :: 사전 승인

## 지식 기록

- KNOWLEDGE 2026-11-20 invariants=INV-261120-no-lock-identity,INV-261120-lock-stages-two-per-side,INV-261120-lock-blocked-reason-split,INV-261120-lock-nature-minus-avoid,INV-261120-lock-overflow-trim-user-only,INV-261120-adjust-exact-result gotchas=none via=make-pr
