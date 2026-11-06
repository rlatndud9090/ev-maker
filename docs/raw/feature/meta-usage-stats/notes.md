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

## ADR 근거 실측 (2026-11-06)

ADR 결정 1·4·5의 근거다. 실측자는 architect 에이전트다.

### 방법

- 입력: researcher가 받아 둔 2026-10 chaos 원본 `gen9championsvgc2026regmc-1760.json`(Bo1)과
  `gen9championsvgc2026regmcbo3-1760.json`(Bo3)이다. 저장소 밖 작업 디렉터리에 있고 커밋하지 않는다.
  - sha256(압축 해제 본문): Bo1 `6c693b54…08a5d`, Bo3 `8a8b678d…e8392c`
- 게임 데이터 연결 대상: 커밋된 `src/data/regulations/m-c/data.json`(종 351, 도구 166, 메가 82).
- 실측 스크립트(Node, 읽기 전용)는 원천 디렉터리 밖에 두고 경로를 인자로 넘겼다. 원천 디렉터리 안에서는 아무것도 실행하지 않았다.
- 크기는 결정 5의 후보 구조(종별 사용률·표본 지표, 특성 전체, 도구 0.1%↑, 기술 0.5%↑, 보존 spread, 성격·H~S
  주변분포, 동료 상위 10, 점유율 소수 넷째 자리 반올림)를 키 정렬 JSON으로 직렬화해 쟀다. 대표 세트와 메타데이터는
  넣지 않았으므로 실제 생성물은 수 KB~수십 KB 더 크다.
- 원천 응답 헤더(`curl -I`, Bo3-1760): `last-modified: Sun, 01 Nov 2026 13:27:17 GMT`, 약한 ETag, content-length 없음.
  전송은 압축되므로 해시는 압축 해제 본문 기준이어야 한다.

### 원천 구조·정합 [확정]

- `info`: `metagame`(Bo1 `gen9championsvgc2026regmc`, Bo3 `…regmcbo3`), `cutoff` 1760, `cutoff deviation` 0,
  `number of battles`(Bo1 1,649,648 / Bo3 262,609).
- 종 필드: `Raw count`, `Viability Ceiling`, `Abilities`, `Items`, `Spreads`, `Moves`, `Tera Types`, `Happiness`,
  `Teammates`, `Checks and Counters`, `usage`.
- 종마다 Σ`Abilities` = Σ`Items` = Σ`Spreads`(상대 오차 1e-6 이내 불일치 0건), Σ`Moves` = 4 × Σ`Abilities`. 즉 세
  분포의 합이 그 종의 가중 출현 수다.
- `usage`는 가중 출현 수에 비례하지 않는다(가중 출현 수 ÷ usage = Bo1 11,954~16,029). 사용률은 원천 `usage`를 그대로 쓴다.
- 특수 키: 도구 `nothing`(도구 없음, Bo1 가중 0.039%), 기술 `""`(빈 칸).
- 도구·기술·특성 키는 이미 Showdown id(소문자 영숫자)다. 종·동료 키는 표시 이름(`Charizard-Mega-Y`)이다.
- `Checks and Counters`: Bo1-1760 상위 5종 모두 0개, Bo3-1760은 15~26개.
- 원천 moveset txt의 `Avg. weight`(Sneasler 0.005899)는 Σ`Abilities` ÷ `Raw count`(0.005854)와 다르다. 표본 지표는 txt가 아니라 chaos 필드로 정의한다.

### 사용률 최소값 후보별 종 수

| 최소값 | 0(전체) | 0.1% | 0.25% | 0.5% | 1% | 2% | 3% |
|---|---|---|---|---|---|---|---|
| Bo1 | 277 | 151 | 107 | 79 | 60 | 50 | 46 |
| Bo3 | 160 | 96 | 78 | 68 | 56 | 43 | 41 |

- 1% 경계 근처(Bo1): Dragapult 1.16, Corviknight 1.03, Lucario-Mega-Z 1.03, Maushold(파밀리쥐) 0.98, Talonflame(파이어로) 0.94 …
- 채택안(0.5%, 80%×30) 대비 50%×10·50%×30은 Bo1 149KB·128KB, Bo3 95KB·90KB 작다(들여쓰기 JSON).
- 같은 사용률 동률이 실제로 있다. Bo1에서 Staraptor/Drampa(0.21687%), Salazzle/Glalie-Mega, Pinsir-Mega/Quaquaval이고,
  Bo3에서 Chesnaught/Skeledirge, Klefki/Scizor다.

### spread 보존 규칙 후보별 크기 (최소값 0.5%)

표기는 "보존 spread 수 / 목표 도달 종 수 / 최대 개수에서 멈춘 종 수 / 누적 점유율 최소·평균 / 크기(KB, 압축 JSON · 들여쓰기 2칸 JSON)"다.

| 목표 × 최대 | Bo1 (79종) | Bo3 (68종) |
|---|---|---|
| 50% × 10 | 361 / 65 / 14 / 0.26·0.55 / 208·430 | 255 / 61 / 7 / 0.36·0.58 / 141·295 |
| 50% × 30 | 495 / 75 / 4 / 0.44·0.57 / 212·451 | 288 / 68 / 0 / 0.50·0.58 / 142·300 |
| 70% × 20 | 820 / 57 / 22 / 0.37·0.69 / 222·501 | 542 / 59 / 9 / 0.50·0.72 / 150·339 |
| 70% × 30 | 985 / 65 / 14 / 0.44·0.71 / 227·526 | 617 / 63 / 5 / 0.59·0.73 / 152·351 |
| 80% × 10 | 631 / 32 / 47 / 0.26·0.68 / 216·472 | 488 / 36 / 32 / 0.36·0.74 / 148·331 |
| 80% × 20 | 1034 / 45 / 34 / 0.37·0.74 / 229·534 | 730 / 52 / 16 / 0.50·0.79 / 155·368 |
| 80% × 30 | 1327 / 54 / 25 / 0.44·0.77 / 238·579 | 870 / 55 / 13 / 0.59·0.80 / 160·390 |

- 80% × 30에서 누적 점유율이 가장 낮은 종(Bo1)은 Rillaboom(고릴타) 43.9%, Incineroar(어흥염) 47.2%다.
- 최소값을 바꾸면(80% × 30, 들여쓰기 JSON): Bo1은 2% 398KB, 1% 462KB, 0.25% 756KB, 0.1% 1,019KB(1MB 초과), 전체 1,586KB다.
  Bo3는 0.25% 423KB, 0.1% 494KB, 전체 685KB다.
- 크기는 종 수와 도구·기술 꼬리가 좌우한다. spread 규칙의 영향은 작다(Bo1 0.5%에서 50%×10 → 80%×30이 +149KB).
  - 도구·기술 꼬리를 자르지 않으면 Bo1 0.5% 80%×30이 713KB(압축 320KB)가 된다.
  - 도구 0.1%·기술 0.5%로 자르면 579KB, 도구 0.5%·기술 1%면 568KB다.

### 표본 지표 [확정]

- 종별 가중 출현 수 = Σ`Abilities`(= Σ`Items` = Σ`Spreads`). 종별 비가중 출현 수 = `Raw count`.
- 스냅샷 가중 배틀 수 추정 = Σ(종별 가중 출현 수) ÷ 12(배틀당 2팀 × 6마리). Bo1 6,357.6, Bo3 6,592.7이다.
  원천 `number of battles`(컷 무관 월 전체 비가중)도 함께 둔다.
- 상위 5마리(Bo1, 가중 / 비가중):
  - Sneasler 6,309.7 / 1,077,841
  - Kingambit 5,293.7 / 625,098
  - Basculegion 4,311.8 / 431,738
  - Charizard-Mega-Y 4,069.8 / 464,830
  - Rillaboom 3,502.5 / 1,173,979
- 상위 5마리(Bo3): Sneasler 6,111.0 / 205,184, Rillaboom 5,079.1 / 237,825, Incineroar 4,745.8 / 223,847,
  Kingambit 4,149.1 / 148,590, Basculegion 2,965.6 / 96,626.

### PRD 수용 기준 값 대조 (Bo1)

- 사용률 원값: Sneasler 0.499469, Kingambit 0.422495, Basculegion 0.3443419, Charizard-Mega-Y 0.3234853, Rillaboom 0.2739846.
  소수 첫째 자리 % 반올림은 49.9 / 42.2 / 34.4 / 32.3 / 27.4다. PRD 수용 기준의 42.3·32.4와 다르다(PRD 수정 필요).
- Sneasler 1위 spread `Adamant:2/32/0/0/0/32`는 13.15%(→13.2)다. 전체 기준 주변분포는 S=32가 46.65%, 고집(Adamant)이 54.44%다.
  최다 도구는 White Herb 33.43%, 최다 동료는 Kingambit 59.81%(동료 가중값 ÷ 종 가중 출현 수)다. moveset txt와 일치한다.

### 이름 연결·규칙 위반 [확정]

- 종 키를 Showdown id로 정규화하면(소문자 영숫자만 남김) Bo1 277종, Bo3 160종 모두 M-C 스냅샷 종에 연결된다(미연결 0).
  도구·특성·기술도 특수 키(`nothing`, `""`)를 빼면 미연결이 0이다.
- 메가 키는 Bo1 81개, Bo3 54개다. 모두 정규화 id가 스냅샷의 메가 폼 종이다(`isMega`, `baseSpecies`, `requiredItem`).
  - 예: `Charizard-Mega-Y`는 charizardmegay → 원종 charizard + charizarditey.
  - 예: `Garchomp-Mega-Z`는 garchompmegaz → garchomp + garchompitez.
  - 냐오닉스는 `Meowstic-M-Mega`(meowsticmmega → meowstic)와 `Meowstic-F-Mega`(meowsticfmega → meowsticf)다. 같은 메가스톤
    meowsticite를 공유하므로 스톤만으로는 원종을 정할 수 없고, 폼 종의 `baseSpecies`가 필요하다.
- 메가 항목의 최다 도구는 81/81(Bo3 54/54)이 해당 메가스톤이고 점유율은 100%다.
- **메가 항목의 `Abilities`는 메가 폼의 특성이다.** 예를 들어 Charizard-Mega-Y는 drought, Garchomp-Mega-Z는 levitate다.
  - 메가 항목의 특성은 모두 메가 폼 특성 목록 안에 있다.
  - 원종 특성 목록 안에 드는 경우는 원종과 메가가 특성을 공유하는 경우뿐이다(Dragonite multiscale, Tyranitar sandstream 등 Bo1 81개 중 18개).
  - 따라서 PRD의 "최다 특성이 기본 폼에서 쓸 수 없으면 리포트"를 그대로 적용하면 대부분의 메가가 경고에 걸린다(PRD 수정 필요, ADR 결정 3·4).
- 규칙 위반 실측:
  - 자기 폼 특성 목록 밖 특성: Bo1 3건(Toxtricity minus 6.0%, Meowstic competitive 3.1%, Squawkabilly sheerforce 1.9%),
    Bo3 2건이다. 원천이 폼을 합쳐 집계한 것으로 보인다.
  - learnset 밖 기술: Bo1 3건(가중 0.0001%), Bo3 1건이다.
  - SP 범위·합계 위반 spread와 미지 성격: 0건이다.
  - 로스터 밖 종: 0건이다.
  - 위반 처리 경로는 실데이터에서도 실제로 쓰인다.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

-

## 검증

- 명령 또는 근거

## 후속 작업

- 후속 작업
