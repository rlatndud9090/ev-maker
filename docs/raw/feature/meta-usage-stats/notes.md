# Notes: 메타 사용률·상대 SP 분포 데이터 수집

> 사람은 중립 역할어(`사용자`/`개발자`/`검증자`)로 지칭한다 — 개인 호칭·별명은 넣지 않는다
> (운영자 설정이 그렇게 부르라 해도). 상세: `harness/templates/examples/README.md` §5.

Date: 2026-11-06 Asia/Seoul
Unit type: feature
Status: draft

## 맥락

- 이 단위는 다음 단위 `feature/sp-sweep-table`(좌: 내 포켓몬 설정 / 우: 공격·방어·스피드 탭 + 메타 포켓몬 결과 카드 리스트, 사용률순 정렬·상위 N·선택 필터, 순풍·랭크업 옵션)의 데이터 공급원이다. 출력은 그 화면이 바로 쓸 수 있어야 한다.
- 선행 리서치 종합본: `research-2026-11-04.md`(세션 메모리, 원천 비교표). 아래는 2026-11-06 재실측분.

## 조사 결과: 통계 원천 실측 (2026-11-06, researcher)

### Smogon chaos JSON [확정]
- 위치: `https://www.smogon.com/stats/{YYYY-MM}/chaos/{format}-{cut}.json`. 최신 2026-10(2026-11-01 생성), `2026-11`은 404(12월 초 공개 추정).
- 2026-10 챔피언스 VGC 포맷: `gen9championsvgc2026regmc`(Bo1), `gen9championsvgc2026regmcbo3`(Bo3). 컷 0/1500/1630/1760. 2026-09엔 `regmb`·`regmbbo3`도 존재.
- 크기: Bo1-1760 15.0MB(gzip 5.4MB), Bo3-1760 5.1MB(gzip 1.8MB). moveset txt 45~145KB.
- 구조: `info`(metagame, cutoff, number of battles) + `data[종]`(Raw count, Abilities, Items, Spreads, Moves, Teammates, Checks and Counters, usage 등).
- Spreads 키는 SP 단위 `성격:H/A/B/C/D/S`(예 `Adamant:2/32/0/0/0/32`, `Brave:32/32/0/0/2/0`, `Quiet:32/0/2/32/0/0`). 변환 불필요.
- 컷 0 값은 정수 카운트, 1500+ 컷은 레이팅 가중 실수. `Raw count`는 컷 무관 비가중이라 비율 계산엔 가중값을 써야 한다.
- 메가 폼은 별도 종 키(`Charizard-Mega-Y`, `Garchomp-Mega-Z` 등). 메가스톤 지닌 개체를 메가 종으로 집계하는 것으로 추정.
- 종 수: Bo1-1760 277, Bo1-0 336, Bo3-1760 160.
- 1760 컷 Bo1 `Checks and Counters`가 빈 배열인 종이 있다(형식 비보장 예).

### 표본 크기 [확정 + 추정]
- `number of battles`는 컷 무관 월 전체: Bo1 1,649,648 / Bo3 262,609.
- 1760 컷 실효 표본(가중합/12 추정): Bo1 약 6,358 배틀, Bo3 약 6,593 배틀 — 비슷하다. 소수 고레이팅 유저에 강하게 가중된다(Sneasler Avg. weight 0.0059).
- Smogon 컷은 하드 필터가 아니라 "플레이어 레이팅이 컷을 넘을 확률"로 가중하는 방식이다(Antar1011/Smogon-Usage-Stats). 1760이 제공되는 최상위 컷이다.

### 스프레드 집중도 (Bo1-1760) [확정]
| 종 | 사용률 | 1위 spread(점유) | 누적 50%/80% 개수 |
|---|---|---|---|
| Sneasler | 49.9% | Adamant:2/32/0/0/0/32 (13.2%) | 5 / 18 |
| Kingambit | 42.3% | Brave:32/32/0/0/2/0 (26.6%) | 5 / 23 |
| Basculegion | 34.4% | Brave:2/32/32/0/0/0 (13.6%) | 5 / 27 |
| Charizard-Mega-Y | 32.4% | Quiet:32/0/2/32/0/0 (30.9%) | 5 / 47 |
| Rillaboom | 27.4% | Adamant:32/32/0/0/0/2 (4.9%) | 43 / 239 |
| Incineroar | 26.3% | (8.5%) | 36 / 194 |
- 분산형 종은 원본 키만으로 대표성이 약하다. 성격만 다르거나 자투리(≤2SP) 위치만 다른 근사 중복이 많다.

### 기타 [확정/불확실]
- CORS: smogon.com/stats 응답에 `Access-Control-*` 없음, OPTIONS 405 → 브라우저 런타임 fetch 불가, 빌드 시 수집 필요. [확정]
- 다음 레귤레이션: Showdown `config/formats.ts`(2026-11-04 커밋)에 M-D 없음, serebii M-D 404. 현재 시즌 M-8(11/5~12/2). [불확실: 미공지] 출처 https://victoryroad.pro/champions-regulations/ , https://game8.co/games/Pokemon-Champions/archives/599154
- 시즌과 Smogon 월은 정렬되지 않는다(시즌 M-8 = 11/5~12/2, Smogon은 달력 월).
- champs.pokedb.tokyo 약관(2026-06-11 개정) 제3조: 경합 서비스 관여자의 데이터 취득·대량 취득 목적 접근 금지, 제4조 데이터 정리물 권리 귀속 → 원천에서 배제. [확정] https://champs.pokedb.tokyo/terms
- Smogon stats 라이선스 공식 문구 없음. pkmn/smogon은 "aggregated stats public domain", @smogon/sets는 "stats source MIT"라 서술. 관례상 "Smogon University 제공 + 링크" 출처 표기. [불확실]

## 결정

- 2026-11-06 사용자 의견(prd-helper 인터뷰 1차):
  - 각 포켓몬의 사용률 통계 spread를 그대로 상대 가정으로 쓰는 것은 피하고 싶다. 사용자가 정한 "스프레드 사용 규칙"이 있고 따로 설명한다(대기).
  - 상위권 표본만 쓸 수 있는지 문의 → 1760 컷이 Smogon 최상위 컷(레이팅 가중)임을 안내.
  - 갱신 단위는 달력 월이 아니라 포켓몬 챔피언스 시즌 기간을 기준으로 하고 싶다.
- 2026-11-06 사용자 결정(prd-helper 인터뷰 2차, 1차를 대체):
  - 갱신 단위는 Smogon 기준 달력 월로 한다. 시즌(예: M-8 = 11/5~12/2)과 월이 어긋나는 것은 감수한다.
    레귤레이션이 월 중간에 바뀌면 원천이 레귤레이션별 포맷으로 나눠 제공하는 것을 그대로 따른다(2026-09에 regmb·regmc 공존 실측).
  - 래더 상위권(1760 컷) 통계를 뽑을 수 있으면 일단 통계만으로 상대 가정을 쓴다.
  - 1차의 "스프레드 사용 규칙"은 "포켓몬별로 타겟팅하고 싶은 특정 SP 배분을 커스텀으로 추가"하는 후속 확장으로 흡수한다.
    이 단위는 그 확장이 가능한 구조만 연다.
- 2026-11-06 에이전트 가정(사전 승인 때 사용자 확인 대상): 기본 매치 방식은 Bo3. 근거는 1760 컷 실효 표본이 Bo1과 비슷하고 대회 형식에 가깝다는 점. 단 Bo3-1760은 160종으로 Bo1(277종)보다 적다.
- 2026-11-06 PRD 리뷰(reviewer) 반영: BLOCKER 1(결정 기록), MAJOR 7(용어 "매치 방식", 전체 분포 기반 주변분포, 표본 지표, 메가 대표 세트, 결정론 의존 범위·수집 시점 정의, 수용 기준 보강, 목록 밖 포켓몬), MINOR 10 전부 반영.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

-

## 검증

- 명령 또는 근거

## 후속 작업

- 후속 작업
