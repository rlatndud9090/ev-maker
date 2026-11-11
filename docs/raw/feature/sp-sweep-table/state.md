---
title: "SP 구간 판정 표 화면(메타 카드 리스트)"
date: "2026-11-07"
stage: implementing
prd_status: pre-approved
adr_status: pre-accepted
---

# 작업 단계 원장: SP 구간 판정 표 화면(메타 카드 리스트)

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

- 2026-11-07 kickoff: raw 골격 생성
- 2026-11-08 prd-draft→prd-review: 사용자 인터뷰 2회(카드 내용·배분 묶음·변화 없음 제외·통계 기반 랭크·순풍 토글) 반영 PRD 초안, ADR 필요(디자인 결정 레인 포함) 판정
- 2026-11-08 prd-review: 리뷰 BLOCKER 3(사용자 결정 4건 추가 인터뷰)·MAJOR 6·MINOR 7, 재검증 2렌즈(BLOCKER 1·MAJOR 8·MINOR 9) 반영
- 2026-11-08 prd-review→adr-draft: adr-helper 진입(결정 1 화면 배치는 디자인 결정 레인, 2~4는 architect)
- 2026-11-08 adr-draft→adr-review: 결정 2~4(architect, 실측), 결정 1 = 사용자 3단계 선택(전체 layout A 좌 사이드바 / 설정 C SP 슬라이더 / 상대 목록 D 변형 압축 목록+아래 아코디언 상세), PRD 정합 개정
- 2026-11-09 pre-approved: 사용자 명시 사전 승인 (harness:approve)
- 2026-11-09 pre-approved→implementing: feature-develop 진입(초기 실행, role 체인 + Workflow)
- 2026-11-09 implementing: 빌드 중 PRD/ADR 개정 11건(S 관여 축소·목록 밖 추가 패널+기술 필수·셸암즈 안내·슬라이더 클램프·superseded 표시 등) — 사용자 개별 확인
- 2026-11-09 implementing: 1차 구현·자체 리뷰 반영 후 개정 2건 — 내 목숨걸기는 공격 탭 계산 불가 안내(코어 계약 유지), ADR 반응성 측정 주체 문구(e2e 페이지 계측) 유지 — 사용자 확인
- 2026-11-10 implementing: 사용자 피드백 — PokeQuiz 팔레트 기반 테마 토큰(라이트/다크) 정비, 상대 목록을 뷰포트 높이 자체 스크롤 박스로(ADR 결정 1 배치 서술 개정) — 사용자 요청
- 2026-11-10 implementing: 사용자 피드백 — 라이선스·출처를 목록 박스 밖 페이지 푸터로(뷰포트에 맞춘 작업 영역 아래, 경계선 구분), ADR 결정 1 배치 서술 개정 — 사용자 요청
- 2026-11-10 implementing: 사용자 피드백 — 종 라벨 숨김, 메가 체크박스 제거(메가 폼 이름 검색으로 선택·도구 메가스톤 자동 고정·잠금), 도구 수동 후보에서 메가스톤 제외(PRD 설정 영역·ADR 결정 1 서술 개정) — 사용자 요청
- 2026-11-10 implementing: 사용자 피드백 — 성격 콤보박스 제거, 능력치 줄 +/− 토글(각각 한 줄만, − 미지정 시 자동 지정)(PRD 설정 영역·ADR 결정 1 서술 개정) — 사용자 요청
- 2026-11-10 implementing: 사용자 피드백 — 변화 없음 화면 표시 제거(모델은 유지), 물리/특수 라벨 제거, 카드 줄에 1타 확률 결과 배지(공격: 확정1타/고난수1타/중저난수1타/확정견딤, 방어: 확정1타/중고난수1타/저난수1타/확정견딤, 코어 koLabel)(PRD·ADR 개정) — 사용자 요청
- 2026-11-10 implementing: 사용자 피드백 — 기술 입력을 '기술' 라벨 하나 아래 1열로, 칸마다 타입 아이콘(partywhale MIT, 라이선스 생성물 갱신)·타입색 배경(ADR 결정 1·4 서술 개정) — 사용자 요청
- 2026-11-10 implementing: 사용자 피드백 — 간단행 대표 행이 랭크·스카프 행이면 근거 태그(상대 칼춤 A+2 등) 표시
- 2026-11-10 implementing: 사용자 피드백 — 간단행 재구성: 순위·사용률·보존·판정 기호 제거, 배분+비중 단일 라벨, [아이콘][랭크][기술명] 라벨, 경계 문구를 '한 단계 위 목표: 최소 … 필요'로(방어 탭은 H·B 최소 합 조합, 동률 H 우선, pair 작업 추가), 스피드 탭 선공/동속/후공 배지(PRD·ADR 개정) — 사용자 요청
- 2026-11-10 implementing: 사용자 피드백 — 간단행 순서를 포켓몬→SP 배분→기술→결과 배지(맨 오른쪽)로(ADR 결정 1 서술) — 사용자 요청
- 2026-11-10 implementing: 사용자 피드백 — 제품 화면 최대 폭 76rem 가운데 정렬(넓은 모니터 양옆 여백, ADR 결정 1 서술) — 사용자 요청
- 2026-11-11 implementing: 사용자 피드백 — 간단행 결과 배지 오른쪽 끝 정렬 철회, 표처럼 열 정렬(포켓몬|배분|기술|목표|결과|외 k행, 좁은 화면 3줄)(ADR 결정 1 서술) — 사용자 요청
- 2026-11-11 implementing: 사용자 피드백 — 간단행 목표 문구 제거(상세에만), 배지 중간 구간을 "난수1타: xx.x%"로, 툴바에 고난수(공격)·저난수(방어) 기준 n/16 입력(1~15, 기본 14/16·2/16, 앱 기본값으로 전달·코어 기본 유지), 캐시 키에 해당 측 기준 포함(PRD·ADR 개정, 실데이터 기대값 재계산) — 사용자 요청
- 2026-11-11 implementing: 사용자 피드백 — 판정 5단계 통일(확정1타/고난수/중난수/저난수/확정견딤, 고난수 기준 n/16 하나·저난수 대칭 (16−n)/16, n≤8 겹침 시 고난수 우선), 노출 조건·방어 극단 필터·스피드에 성격 {무보정, 상승} 포함, 상세 최소치 무보정/상승 2종, 배지 단계명+확률(PRD·ADR 개정, 코어 3단계 경로는 개발 화면용 유지) — 사용자 요청
- 2026-11-11 implementing: 사용자 피드백 — 카드·조건마다 가장 센 기술 하나만 계산·표시(내 기술 4개/상대 후보를 물리·특수 분류를 가로질러 비교, 현재 세트 기준 1타 확률→최대 대미지→슬롯/사용률 순), 선공기는 예외로 유지, 공격·방어 탭 적용(probe 단계 추가, PRD·ADR 개정) — 사용자 요청
## 승인 이벤트

<!-- 이 블록은 `npm run harness:approve`만 기록한다. 사용자의 명시 승인 발화가
     verbatim으로 남는다. 두 종류: `PREAPPROVAL`(사전 승인 — 빌드 진입 게이트)과
     `APPROVAL`(최종 확정 — $make-pr, PR 직전). harness:check가 이 이벤트와 PRD/ADR
     status의 정합성을 교차검증한다. 손으로 위조하면 여러 아티팩트를 동시에 조작해야
     하며 감사에 드러난다. -->

- PREAPPROVAL prd 2026-11-09 harness:approve :: 사전 승인
- PREAPPROVAL adr 2026-11-09 harness:approve :: 사전 승인
