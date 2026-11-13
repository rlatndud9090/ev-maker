---
kind: wiki-index
summary: 이 프로젝트의 방향성과 raw work unit 네비게이션 인덱스. 상세는 링크된 raw 문서에 있다.
authoring_rules: 위키 구조·영역(area)/섹션(section) 작성 규칙은 하네스 플러그인의 harness/protocols/wiki-ingest.md 참고.
---

# 프로젝트 Wiki — 방향성 & 네비게이션

## 큰 방향성

- **무엇**: 포켓몬 챔피언스(더블·VGC 우선) 파티의 SP(Stat Points) 투자 조정 도우미 웹앱
- **누구를 위해**: 1차는 개인용(대회 지향 플레이어), 이후 공개 배포 가능한 구조
- **핵심 경험 / 목표**:
  1. 포켓몬 하나의 결정력/내구/스피드 SP 조정별 1타 판정(확정·고난수 1타로 처리 / 저난수 이하로 버팀)·추월 대상(스카프·순풍·스피드 특성 포함) 표
  2. 입력 SP의 유의미 구간 하이라이트("딱 이 값부터 X")
  3. 대회 파티 6마리 입력 → 메타 상위 파티 조합과의 매치업을 유의미하게 바꾸는 SP 세팅 추천(AI). 개별 포켓몬 단위 최적화가 아니라 매치업 반전 기준
- **어떻게**: 1·2는 결정론적 엔진(@smogon/calc gen 0 + 게임 데이터 + 메타 통계)만으로, 3은 같은 엔진 위에 사용률 가중 매치업 분석을 얹고 LLM은 입력 정규화·탐색 우선순위·설명만 맡는다(수치는 엔진만 생성).
- **배포·AI 비용**: 공개 저장소·정적 배포. AI 기능은 운영자 서버 백엔드 대신 사용자가 각자 AI 키를 연결하는 방식(BYOK)을 우선 검토한다(실현 가능성은 기능 3 단위에서 조사).
- **데이터 방침**: 오픈 팀시트에 SP가 없으므로 상대 SP는 통계 분포(Smogon 등)로 가정하고, 참가자들이 트위터·블로그에 올린 SP 공개 정보와 구축 기사의 SP 의도(왜 이 값인지)를 별도로 수집·축적해 3번 추천의 근거로 쓴다.
- **지식 경계**: raw PRD/ADR/notes가 진실 원천이고, 이 index는 navigation만 맡는다.

## Raw Units (영역별 계보)

### 계산 엔진

- `2026-11-04` **챔피언스 계산 코어(SP 어댑터·스피드 엔진)와 게임 데이터·한국어 매핑** — [PRD](../raw/feature/champions-calc-data-core/prd.md) · [ADR](../raw/feature/champions-calc-data-core/adr.md) · [Notes](../raw/feature/champions-calc-data-core/notes.md) _(현재)_

### 게임 데이터

- `2026-11-04` **챔피언스 계산 코어(SP 어댑터·스피드 엔진)와 게임 데이터·한국어 매핑** — [PRD](../raw/feature/champions-calc-data-core/prd.md) · [ADR](../raw/feature/champions-calc-data-core/adr.md) · [Notes](../raw/feature/champions-calc-data-core/notes.md) _(현재)_

### 메타 통계

- `2026-11-06` **메타 사용률·상대 SP 분포 데이터 수집** — [PRD](../raw/feature/meta-usage-stats/prd.md) · [ADR](../raw/feature/meta-usage-stats/adr.md) · [Notes](../raw/feature/meta-usage-stats/notes.md) _(현재)_

### SP 구간 표

- `2026-11-07` **SP 구간 판정 표 화면(메타 카드 리스트)** — [PRD](../raw/feature/sp-sweep-table/prd.md) · [ADR](../raw/feature/sp-sweep-table/adr.md) · [Notes](../raw/feature/sp-sweep-table/notes.md)
- `2026-11-13` **공격·방어 탭 판정 행 기능 확장과 상세 화면 가시성 개편(상대 기술 표시·설정, 화력 도구 행)** — [PRD](../raw/feature/damage-tabs-row-revamp/prd.md) · [ADR](../raw/feature/damage-tabs-row-revamp/adr.md) · [Notes](../raw/feature/damage-tabs-row-revamp/notes.md)
