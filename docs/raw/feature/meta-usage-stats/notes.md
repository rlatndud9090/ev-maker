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
| Kingambit | 42.2% | Brave:32/32/0/0/2/0 (26.6%) | 5 / 23 |
| Basculegion | 34.4% | Brave:2/32/32/0/0/0 (13.6%) | 5 / 27 |
| Charizard-Mega-Y | 32.3% | Quiet:32/0/2/32/0/0 (30.9%) | 5 / 47 |
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
- 2026-11-06 사용자 결정(사전 승인 직후 보정, 위 Bo3 가정을 대체):
  - 기본 매치 방식은 Bo1.
  - 사용률 0.5% 미만(목록 밖) 포켓몬은 통계 반영도 기본값도 없이 사용자 커스텀 세팅으로만 다룬다. 사용자가 그 포켓몬을
    타겟으로 정하면 기본 세팅으로 해당 능력치 SP 32 / SP 32 + 성격 보정 / 무투자 정도를 넣어 줘도 된다(다음 단위 화면).
  - 메가 대표 세트의 원종 특성 가정은 감수한다(메가진화 전 특성을 타겟하는 경우는 드물다).
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
  소수 첫째 자리 % 반올림은 49.9 / 42.2 / 34.4 / 32.3 / 27.4다. 조사 1차 표의 42.3·32.4는 반올림 오차였고, 이 값이 기준이다(PRD 반영함).
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
  - 따라서 PRD의 "최다 특성이 기본 폼에서 쓸 수 없으면 리포트"를 그대로 적용하면 대부분의 메가가 경고에 걸린다(PRD 반영함, ADR 결정 3·4).
- 규칙 위반 실측:
  - 자기 폼 특성 목록 밖 특성: Bo1 3건(Toxtricity minus 6.0%, Meowstic competitive 3.1%, Squawkabilly sheerforce 1.9%),
    Bo3 2건이다. 원천이 폼을 합쳐 집계한 것으로 보인다.
  - learnset 밖 기술: Bo1 3건(가중 0.0001%), Bo3 1건이다.
  - SP 범위·합계 위반 spread와 미지 성격: 0건이다.
  - 로스터 밖 종: 0건이다.
  - 위반 처리 경로는 실데이터에서도 실제로 쓰인다.

## 구현 계획 (feature-develop Phase 1, 2026-11-06)

작성: architect 에이전트. 진실원은 PRD(pre-approved)·ADR(pre-accepted, 결정 1~5)이고, 이 절은 그 결정을
파일·인터페이스·테스트·태스크로 옮긴 것이다. 결정을 바꾸지 않는다.

### 0. 설계 전 확인한 사실

- **Node CLI는 계산 코어를 그대로 import하지 못한다.** `src/core/*.ts`는 확장자 없는 상대 import(`./types`)를 쓴다.
  Node 22.18 타입 제거는 확장자 해석을 하지 않는다. `module.registerHooks`의 resolve 훅으로 `.ts` 확장자를
  붙이면 `src/core/set.ts`의 `validateSet`이 Node에서 동작한다(`charizard + charizarditey + mega` →
  `charizardmegay`/`drought`로 실측). `set.ts` 의존 그래프(types·errors·stats·schema)에는 JSON import와
  `@smogon/calc`가 없다. 그래서 메타 생성 명령은 진입점에서 훅을 등록한 뒤 파이프라인을 동적 import한다.
  Vitest는 Vite 해석기를 쓰므로 훅이 필요 없다.
- PokeAPI 캐시(`.cache/pokeapi/<커밋>/`)는 이 워크트리에 있다. 기존 `pipeline.test.ts`는 캐시가 없으면
  네트워크를 쓴다. 메타 테스트는 `buildAll`을 부르지 않는다.
- 원천 종 하나의 크기는 대부분 `Spreads`와 `Teammates`가 차지한다(Bo1 포푸니크 248KB 중 Spreads 234KB,
  Teammates 11KB). `Spreads`를 자르면 결정 1의 분포 합 검증과 주변분포 값이 깨진다. 그래서 상위 종을 그대로
  담는 동결 픽스처는 작게 만들 수 없다(3절).
- 사용률 0.5% 기준에서 Bo1 리자몽(0.036%)은 목록 밖이다. PRD 수용 기준의 "메가리자몽Y와 리자몽은 별도
  항목" 예시는 실제 스냅샷에서 "메가리자몽Y = 항목, 리자몽 = 래더 가정 없음"으로 나타난다. 그래서 별도 항목은
  두 가지로 검증한다. 실제 스냅샷에서는 한카리아스(26.1%)·메가한카리아스(5.87%)·메가한카리아스Z(8.49%)가
  셋 다 목록 안이므로 이 셋을 쓴다. 리자몽 쌍은 최소값을 낮춘 픽스처에서 검증한다.
- 실측(Bo1 2026-10)에서 확인한 값은 다음과 같다.
  - 대도각참 최다 기술 4개: kowtowcleave·suckerpunch·ironhead·lowkick. 대표 세트에 기습이 들어가므로
    "대도각참 기습 → 포푸니크" 계산 기준을 쓸 수 있다.
  - 사용률 최소값 바로 아래(0.4867%)는 rotomwash다. 로스터에 있고, 특성은 levitate, hydropump를 배운다.
  - absol은 로스터에 있지만 원천에 없다.
  - 0.5% 이상 종 중 최다 특성이 엔진 미지원(battlebond)인 종은 없다.

### 1. 파일 경계

| 파일 | 상태 | 책임 | 계층 |
| --- | --- | --- | --- |
| `src/data/meta-schema.ts` | 신규 | 메타 스냅샷·인덱스 타입, `META_SCHEMA_VERSION`, 매치 방식·특수 키 상수. 런타임 import 없음(`import type`만) | 데이터 계약 |
| `src/data/meta-guard.ts` | 신규 | 선택 규칙 해석, 스키마·식별 정합 검사, 파일 이름 규칙, 게임 데이터 해시 분류(순수 함수) | 데이터 접근 |
| `src/data/meta-loader.ts` | 신규 | 인덱스 정적 import, 스냅샷 파일별 지연 로드·캐시(브라우저) | 데이터 접근 |
| `src/data/meta/index.json` | 신규(생성물) | 메타 인덱스. T1이 빈 상태로 만들고, 이후에는 생성 명령만 다시 쓴다 | 데이터 |
| `src/data/meta/m-c/2026-10-bo1.json`, `2026-10-bo3.json` | 신규(생성물) | 실제 원천으로 만든 메타 스냅샷 | 데이터 |
| `src/data/testing.ts` | 수정 | 테스트 전용 동기 메타 로더 추가 | 테스트 지원 |
| `src/meta/types.ts`, `src/meta/assumptions.ts`, `src/meta/index.ts` | 신규 | 가정 계약, 메타 뷰(순위·이름 조인·대표 가정·조회·오버레이 병합·세트 검증) | 애플리케이션 로직 |
| `scripts/data/meta.config.json` | 신규 | 메타 설정: 기본값, URL 형식, 레귤레이션 대응, 받은 원천 기록 | 생성 설정 |
| `scripts/data/build-meta.mjs` | 신규 | 생성 명령 CLI. 훅 등록 후 파이프라인 동적 import | 생성기 |
| `scripts/data/lib/ts-hooks.mjs` | 신규 | Node resolve 훅(`.ts` 파일 안의 확장자 없는 상대 import → `.ts`) | 생성기 |
| `scripts/data/lib/meta-source.mjs` | 신규 | 설정 검증, 기록 모드(받기·해시·공개 시각), 캐시 읽기·해시 대조, 원천 형식 검증 | 생성기 |
| `scripts/data/lib/meta-build.mjs` | 신규 | 정규화·조인·위반 판정·분포·주변분포·표본 지표·대표 세트·리포트 객체 | 생성기 |
| `scripts/data/lib/meta-pipeline.mjs` (+ `.d.mts`) | 신규 | 조립: 보존·강제·스키마 검사, 크기 검사, 인덱스 재생성, 출력 일괄 쓰기 | 생성기 |
| `scripts/data/make-meta-fixture.mjs` | 신규 | 동결 픽스처 생성 스크립트(원천 경로를 인자로 받음, 재현 가능) | 테스트 지원 |
| `src/data/__fixtures__/meta/gen9championsvgc2026regmc-1760.2026-10.partial.json` | 신규 | 2026-10 Bo1 원천 일부 동결(3절) | 테스트 입력 |
| `data/reports/meta/m-c/2026-10-bo1/report.{json,md}`, `…-bo3/…` | 신규(생성물) | 연결·위반·메가 점검·보존 통계·크기 | 리포트 |
| `scripts/data/lib/licenses.mjs` | 수정 | 메타 인덱스를 받아 Smogon 항목·고지 절 생성 | 생성기 |
| `scripts/data/lib/pipeline.mjs`, `pipeline.d.mts` | 수정 | 입력 루트의 메타 인덱스를 읽어 `buildLicenses`에 넘김, `buildLicenses` 타입 노출 | 생성기 |
| `src/data/licenses.json`, `THIRD_PARTY_NOTICES.md` | 재생성 | `npm run gen:snapshot`으로만 갱신 | 생성물 |
| `src/dev/perf.ts`, `e2e/perf.spec.ts` | 수정 | 메타 로드 측정 훅·e2e | 측정 |
| `package.json` | 수정 | `gen:meta` 스크립트 | 설정 |
| `README.md` | 수정 | 메타 생성 절차·캐시·최신 월 재생성 규칙 | 문서 |
| 테스트: `src/data/meta-loader.test.ts`, `src/meta/assumptions.test.ts`, `src/data/meta-pipeline.test.ts`, `src/data/licenses.test.ts`, `src/data/meta-snapshot.test.ts` | 신규 | 4절 매핑 | 테스트 |
| `src/data/snapshot.test.ts` | 수정 | 라이선스 검사에서 출처 표기 전용 항목(Smogon) 분리 | 테스트 |

경계 원칙은 다음과 같다.

- 데이터 계약(`meta-schema.ts`)은 생성기와 앱이 함께 import한다. 생성기는 `.ts` 파일을 확장자 포함 경로로 import한다(기존 `schema.ts`와 같은 방식).
- 애플리케이션 로직(`src/meta/`)은 로드된 `MetaSnapshot`과 `Snapshot`을 명시 인자로 받는 동기 순수 함수다. 코어와 같은 방식이고, IO는 `src/data/*-loader.ts`만 한다.
- UI는 이 단위에 없다. 확인 수단은 테스트·리포트와 `src/dev/perf.ts`(측정 훅)다.
- 픽스처는 `src/data/meta/` 밖에 둔다. 로더의 `import.meta.glob('./meta/*/*.json')`이 픽스처를 집지 않게 하기 위해서다.

### 2. 인터페이스 계약

#### 2.1 메타 설정 `scripts/data/meta.config.json`

```jsonc
{
  "cutoff": 1760,
  "urlTemplate": "https://www.smogon.com/stats/{month}/chaos/{format}-{cutoff}.json",
  "params": { "minUsage": 0.005, "spreadTarget": 0.8, "spreadMax": 30, "itemMin": 0.001, "moveMin": 0.005, "teammatesTop": 10 },
  "regulations": { "m-c": { "bo1": "gen9championsvgc2026regmc", "bo3": "gen9championsvgc2026regmcbo3" } },
  "sources": [
    { "regulation": "m-c", "month": "2026-10", "match": "bo1", "format": "gen9championsvgc2026regmc",
      "cutoff": 1760, "url": "https://www.smogon.com/stats/2026-10/chaos/gen9championsvgc2026regmc-1760.json",
      "sha256": "<64 hex, 압축 해제 본문>", "publishedAt": "2026-11-01T13:27:17Z" }
  ]
}
```

- **검증(allowlist):**
  - 레귤레이션 id는 `sources.config.json`에 있어야 하고 `^[a-z0-9-]+$` 형식이다.
  - 매치 방식은 `bo1`·`bo3`, 월은 `^\d{4}-(0[1-9]|1[0-2])$`이다.
  - 포맷 이름은 `^[a-z0-9]+$`이고 레귤레이션 사이에 중복되지 않는다.
  - 기록은 (레귤레이션, 월, 매치 방식)마다 하나다. 기록의 `format`은 대응 설정과 같고, `url`은 템플릿으로 만든 값과 정확히 같으며, `cutoff`는 1760이다.
  - `sha256`은 64자 hex, `publishedAt`은 `isIsoInstant` 형식이다.
  - `params`는 0 < minUsage < 1, 0 < spreadTarget ≤ 1, spreadMax는 양의 정수, itemMin·moveMin은 0 이상 1 미만, teammatesTop은 양의 정수다.
- 기록의 `sources` 배열은 (레귤레이션, 월, 매치 방식) 순으로 정렬해 `stableStringify`로 쓴다.

#### 2.2 메타 스냅샷 스키마 `src/data/meta-schema.ts` (개요)

```ts
export const META_SCHEMA_VERSION = 1
export type MatchType = 'bo1' | 'bo3'
export const MATCH_TYPES: readonly MatchType[] = ['bo1', 'bo3']
export const NO_ITEM = 'nothing'            // 도구 분포의 "도구 없음" 키(게임 데이터 도구 아님)
export type Shares = Record<string, number> // id → 점유율(0~1, 소수 넷째 자리 반올림)

export interface MetaParams { minUsage: number; spreadTarget: number; spreadMax: number; itemMin: number; moveMin: number; teammatesTop: number }

export interface MetaManifest {
  schemaVersion: number
  regulation: string          // 게임 데이터 레귤레이션 id
  month: string               // YYYY-MM
  match: MatchType
  source: { format: string; cutoff: number; url: string; sha256: string; publishedAt: string; battles: number /* info["number of battles"] */ }
  params: MetaParams
  gameData: { regulation: string; schemaVersion: number; sha256: string /* data.json 바이트 */ }
  sample: { weightedBattles: number /* 원천 전체 종 Σ가중 출현 수 ÷ 12, 소수 첫째 자리 */ }
}

export interface DistributionShares {
  shares: Shares       // 컷(itemMin·moveMin)을 넘긴 값, 위반 제외 후
  keptShare: number    // shares 합(기술은 최대 4)
  excludedShare: number // 위반으로 뺀 몫
}

export interface MetaEntry {
  id: string                          // 로스터 종·폼 id(메가는 메가 폼 id)
  rank: number                        // 1부터, 사용률 내림차순·동률은 id 순
  usage: number                       // 원천 usage 그대로(반올림하지 않음)
  sample: { weighted: number /* Σ특성, 소수 둘째 자리 */; raw: number /* Raw count */ }
  mega?: { base: string; stone: string }
  abilities: Shares                    // 위반 제외 후 전부. 메가 항목은 메가 폼 특성 기준
  items: DistributionShares
  moves: DistributionShares            // 빈 칸("") 제외
  spreads: { kept: Array<[key: string, share: number]>; keptShare: number; excludedShare: number }
  //  key 형식 "성격id:H/A/B/C/D/S"(예 "adamant:2/32/0/0/0/32"), kept는 점유율 내림차순·동률은 key 순
  natures: Shares                      // 위반 제외 후 전체 spread 기준 주변분포
  spMarginal: Record<StatId, Shares>   // 키 "0"~"32"
  teammates: Shares                    // 위반 제외 후 비율 상위 teammatesTop
  representative: { set: PokemonSet; basis: 'modal-combination'; abilityBasis?: 'source-top' | 'base-first-slot' }
}

export interface MetaSnapshot { manifest: MetaManifest; entries: MetaEntry[] /* rank 순 */ }

export interface MetaIndexItem { match: MatchType; month: string; file: string /* "m-c/2026-10-bo1.json" */; format: string; url: string; publishedAt: string }
export interface MetaIndex { schemaVersion: number; regulations: Record<string, MetaIndexItem[]> /* 각 배열은 (month, match) 순 */ }
```

- spread는 객체 배열이 아니라 `[key, share]` 튜플로 담는다. 들여쓰기 직렬화에서 줄 수가 크기를 좌우하고, ADR 크기 실측(Bo1 579KB)은 이보다 큰 8-튜플 형식으로 쟀다. 그래서 이 형식이면 실측치 이하로 나온다.
- 한국어 이름은 넣지 않는다(결정 3).
- 반올림은 `Math.round(x * 1e4) / 1e4` 하나로 한다. 누적 점유율 판정(80%)은 반올림 전 값으로 한다.

#### 2.3 데이터 접근층 공개 API

`src/data/meta-guard.ts`(순수, 브라우저·테스트 공용):

```ts
export class MetaLoadError extends Error {}
export interface MetaRequest { regulation?: string; match?: MatchType; month?: string }
export interface MetaSelection { regulation: string; match: MatchType; month: string; item: MetaIndexItem }
export function metaFileName(month: string, match: MatchType): string            // "2026-10-bo1.json"
export function listMetaSnapshots(index: MetaIndex, regulation: string): MetaIndexItem[]
export function resolveMetaSelection(index: MetaIndex, gameIndex: RegulationIndex, req?: MetaRequest): MetaSelection
export function assertMetaIndex(index: MetaIndex): void
export function assertMetaSnapshot(sel: Pick<MetaSelection, 'regulation' | 'match' | 'month'>, meta: MetaSnapshot): void
export function classifyGameDataRefs(
  refs: Array<{ regulation: string; match: MatchType; month: string; gameDataSha256: string }>,
  current: Record<string, { sha256: string; frozen: boolean }>,
): { mismatchLatest: typeof refs; staleArchived: typeof refs }
```

- **`resolveMetaSelection` 규칙:**
  - 레귤레이션을 생략하면 `gameIndex.default`를 쓴다. 게임 데이터 인덱스에 없는 레귤레이션이면 거부한다(`resolveRegulationId`와 같은 allowlist).
  - 매치 방식·월을 둘 다 생략하면 Bo1의 가장 최근 월을 고르고, Bo1이 없으면 Bo3의 가장 최근 월을 고른다.
  - 매치 방식만 주면 그 매치 방식의 가장 최근 월이다.
  - 월만 주면 그 월의 Bo1, 없으면 Bo3다.
  - 둘 다 주면 정확히 그 조합이다.
  - 맞는 스냅샷이 없으면 `MetaLoadError`를 던진다. 메시지에 사용 가능한 (매치 방식, 월) 목록을 넣는다.
  - 문자열이 아닌 값이나 형식 밖 값도 거부한다.
- **`assertMetaSnapshot`:** `schemaVersion`이 현재 버전과 다르면 명확한 오류로 거부한다. 레귤레이션·월·매치 방식이 선택과 다를 때도 거부한다.
- **`classifyGameDataRefs`:** 동결되지 않은 레귤레이션에서 매치 방식별 가장 최근 월의 해시가 다르면 `mismatchLatest`(테스트 실패 대상)다. 그 밖에 해시가 다른 스냅샷은 `staleArchived`(보고만)다.

`src/data/meta-loader.ts`(브라우저):

```ts
export { MetaLoadError } from './meta-guard'
export type MetaImporters = Record<string, () => Promise<MetaSnapshot>>  // 키 "./meta/<reg>/<file>"
export function createMetaLoader(index: MetaIndex, gameIndex: RegulationIndex, importers: MetaImporters): {
  index(): MetaIndex
  select(req?: MetaRequest): MetaSelection
  load(req?: MetaRequest): Promise<MetaSnapshot>   // 파일 키별 Promise 캐시, 실패하면 캐시에서 지움
}
export function loadMetaIndex(): Promise<MetaIndex>
export function loadMetaSnapshot(req?: MetaRequest): Promise<MetaSnapshot>
// 기본 인스턴스: indexJson(정적 import) + import.meta.glob<MetaSnapshot>('./meta/*/*.json', { import: 'default' })
```

`src/data/testing.ts`에는 `loadMetaIndexSync()`와 `loadMetaSnapshotSync(req?: MetaRequest): MetaSnapshot`을 더한다. 둘 다 같은 guard를 쓴다.

#### 2.4 가정 계약·메타 뷰 `src/meta/`

```ts
// types.ts
export type AssumptionSourceKind = 'ladder' | 'custom' | 'sns' | 'article'
export interface LadderSource { kind: 'ladder'; origin: 'smogon-chaos'; format: string; match: MatchType; month: string; cutoff: number; url: string }
export interface ExternalSource { kind: 'custom' | 'sns' | 'article'; link?: string; author?: string; date?: string; memo?: string }
export type AssumptionBasis = 'modal-combination' | 'observed-spread' | 'as-published'
export interface Assumption {
  target: string                // 로스터 종·폼 id(메가는 메가 폼 id)
  set: PokemonSet               // 계산 코어 세트 계약 그대로(메가 = 원종 + 스톤 + mega: true)
  source: LadderSource | ExternalSource
  basis: AssumptionBasis        // ladder는 modal-combination·observed-spread, 그 밖은 as-published
  intent?: string
  share?: number                // ladder만: 쓴 spread의 점유율
  abilityBasis?: 'source-top' | 'base-first-slot'
}
export interface AssumptionOverlay { regulation: string; assumptions: Assumption[] }
export type ResolvedAssumption =
  | { usable: true; assumption: Assumption; resolved: ResolvedSet }
  | { usable: false; assumption: Assumption; error: CoreError | CoreInputError }
export interface DisplayName { id: string; ko: string; en: string; missing: boolean }  // missing이면 ko·en = 원문 id
export type OpponentLookup =
  | { status: 'ladder'; entry: MetaEntry; assumptions: ResolvedAssumption[] }  // 래더 대표 가정 먼저, 그다음 오버레이
  | { status: 'no-ladder'; assumptions: ResolvedAssumption[] }                // 오버레이 가정만(없으면 빈 배열)

// assumptions.ts
export function createMetaView(meta: MetaSnapshot, game: Snapshot): MetaView      // 레귤레이션이 다르면 거부
export interface MetaView {
  readonly meta: MetaSnapshot; readonly game: Snapshot
  readonly ranking: readonly MetaEntry[]
  entry(id: string): MetaEntry | undefined
  name(kind: 'species' | 'items' | 'abilities' | 'moves' | 'natures', id: string): DisplayName  // NO_ITEM은 "도구 없음"
}
export function ladderSource(meta: MetaSnapshot): LadderSource
export function representativeAssumption(view: MetaView, entryId: string): Assumption
export function observedSpreadAssumption(view: MetaView, entryId: string, spreadIndex: number): Assumption
export function resolveAssumption(game: Snapshot, a: Assumption): ResolvedAssumption  // validateSet, CoreError·CoreInputError만 잡음
export function setDisplayNames(view: MetaView, r: ResolvedAssumption): { species: DisplayName; item?: DisplayName; ability: DisplayName; nature: DisplayName; moves: DisplayName[] }
  // species는 해석된 계산 종(메가 폼)의 이름
export function topAssumptions(view: MetaView, n?: number /* 30 */): Array<{ entry: MetaEntry; result: ResolvedAssumption; names?: ReturnType<typeof setDisplayNames> }>
export function validateOverlay(game: Snapshot, overlay: AssumptionOverlay): void
  // 레귤레이션 일치, kind ≠ 'ladder', target이 로스터 id, set.regulation 일치. 위반하면 throw
export function lookupOpponent(view: MetaView, rosterId: string, overlay?: AssumptionOverlay): OpponentLookup
  // 로스터에 없는 id는 throw. 메타 항목이 없으면 no-ladder
export { mergeOverlay }  // (ladder: ResolvedAssumption[], overlay, target) → 같은 target의 오버레이 가정을 뒤에 붙임
```

- **측정 범위(결정 5)와 1:1 대응:** `JSON.parse(text)` → `assertMetaSnapshot` → `createMetaView` → `topAssumptions(view, 30)`. `topAssumptions`가 순위 해석, 대표 가정 구성, 한국어 이름 조인, 코어 세트 검증을 모두 한다.
- **해시가 다른 스냅샷의 런타임 처리:** 런타임은 해시를 비교하지 않고 항상 같은 경로로 처리한다.
  - 이름이 없으면 `missing: true`로 원문 id를 표시한다.
  - 세트 검증에 실패하면 `usable: false`로 둔다.
  - 해시가 같은 스냅샷에서는 생성 단계 검증 덕분에 이 경로가 실제로 실패하지 않는다.

#### 2.5 생성 명령

```
npm run gen:meta -- --regulation <id> --month <YYYY-MM> [--match bo1|bo3] [--record] [--force] [--out-root <dir>] [--cache-dir <dir>]
```

- **`--record`(기록 모드):** 대응 설정의 매치 방식마다(또는 `--match`만) URL을 받는다.
  - 응답이 200이 아니거나 `Last-Modified`가 없으면 실패한다.
  - 본문 바이트(fetch가 압축을 푼 본문)의 sha256과 `Last-Modified` → ISO 8601(`YYYY-MM-DDTHH:MM:SSZ`)을 `meta.config.json` 기록에 쓰고, 본문은 캐시에 저장한다. 생성은 하지 않는다.
  - 기록이 이미 있는데 해시나 공개 시각이 다르면 `--force` 없이는 실패한다.
- **기본(생성 모드):**
  - 기록이 없으면 "해시 미기록: --record 먼저"로 실패한다.
  - 캐시 `<cacheDir>/smogon/<month>/chaos/<format>-1760.json`이 있으면 그것을 쓰고, 없으면 받아서 저장한다. 어느 쪽이든 기록 해시와 대조한다.
  - 형식 검증 → 변환 → 대표 세트 검증 → 크기 검사(1,000,000바이트 초과면 실패) 순으로 진행한다. 그다음 인덱스를 다시 만들고 리포트를 쓴다.
  - 생성물을 하나라도 만들었으면 `출처 고지 갱신 필요: npm run gen:snapshot 실행`을 출력한다.
- **`--force`:** 이미 있는 (레귤레이션, 월, 매치 방식) 파일을 다시 만든다. 기록을 다시 쓸 때도 쓴다.
- **보존:** 파일이 이미 있으면 건너뛴다(로그만 남기고 리포트도 그대로 둔다).
- **스키마 검사:** 생성이 끝난 뒤 디스크에 남은 메타 파일 중 다른 스키마 버전이 있으면 그 목록과 "--force로 해당 월을 다시 만든다"를 출력하고 실패한다. 이때 아무 파일도 쓰지 않는다(출력을 모았다가 마지막에 한 번에 쓴다).
- **인덱스 재생성:** `<outRoot>/src/data/meta/*/` 아래 파일 전체를 읽어 만든다. 파일 이름이 `^\d{4}-\d{2}-bo[13]\.json$`이 아니면 실패한다(allowlist). 인덱스 항목의 url·publishedAt·format은 설정이 아니라 각 파일의 매니페스트에서 가져온다.
- **입출력 루트:** 게임 데이터(`data.json` 바이트 해시, 매니페스트)와 `sources.config.json`은 입력 루트(`root`)에서 읽는다. 메타 파일·리포트·인덱스는 `outRoot`에 쓴다. 고지 파일(`licenses.json`·`THIRD_PARTY_NOTICES.md`)은 쓰지 않는다.
- **이름 존재 판정:** 미연결과 로스터 밖을 구분하는 데 같은 레귤레이션 모드의 `createPkmnSource(reg.mode)`(`@pkmn` devDependency, 네트워크 없음)를 쓴다. 판정 규칙은 다음과 같다.
  - 원천 dex에 없는 이름이면 "미연결"이다.
  - 원천 dex에는 있고 스냅샷에 없는 종·도구면 "로스터 밖 종"·"사용 불가 도구"다.
  - 특성·기술은 판정 순서가 다르다. 특성은 "그 폼의 특성 목록 밖", 기술은 "원종 learnset 밖"을 먼저 판정한다.
- 파이프라인 함수 계약(`meta-pipeline.d.mts`):

```ts
export interface MetaBuildOptions {
  regulation: string; month: string; match?: MatchType[]; record?: boolean; force?: boolean
  root?: string; outRoot?: string; cacheDir?: string
  config?: unknown; configPath?: string           // 기록 모드가 쓸 경로(기본 <root>/scripts/data/meta.config.json)
  fetch?: (url: string) => Promise<Response>       // 테스트 주입. 기본 globalThis.fetch
  log?: (message: string) => void
}
export interface MetaBuildResult { generated: string[]; skipped: string[]; recorded: Array<{ regulation: string; month: string; match: MatchType; sha256: string; publishedAt: string }>; files: string[]; noticeUpdateRequired: boolean }
export function buildMeta(opts: MetaBuildOptions): Promise<MetaBuildResult>
export class MetaPipelineError extends Error {}   // PipelineError 재사용 가능
```

#### 2.6 변환 규칙 요약(생성기 구현 기준)

1. **형식 검증(결정 1):**
   - `info.metagame`은 기록 format과 같아야 한다. `info.cutoff`는 1760, `info["cutoff deviation"]`은 0, `info["number of battles"]`는 0 이상의 정수여야 한다.
   - `data`는 객체이고, 종마다 `usage`(유한수)와 `Raw count`(0 이상의 정수)가 있어야 한다. `Abilities`·`Items`·`Spreads`·`Moves`·`Teammates`는 값이 유한하고 0 이상인 수의 객체여야 한다.
   - Spread 키는 `^[A-Za-z]+:\d+/\d+/\d+/\d+/\d+/\d+$` 형식이어야 한다.
   - Σ특성·Σ도구·Σspread의 상대 오차가 1e-6 이하이고 Σ특성 > 0이어야 한다.
   - 정규화 id가 겹치는 종 키가 없어야 한다.
   - 포맷이 그 레귤레이션 대응에 있어야 하고, 월 구간 `[YYYY-MM-01T00:00Z, 다음 달 1일)`이 레귤레이션 `rules.start~end`와 겹쳐야 한다.
   - 실패하면 사유마다 "종·필드·기대·실제"를 메시지에 넣는다. `Checks and Counters`·`Tera Types`·`Happiness`·`Viability Ceiling`은 읽지 않는다. 없거나 비어 있어도 된다.
2. **정규화·조인(결정 4):**
   - id는 `toID`로 만든다. 종 키 → `game.species[id]`이고, 메가 여부는 `isMega`로만 판정한다. `-Mega` 문자열은 해석하지 않는다.
   - 메가 항목의 원종은 `baseSpecies`, 스톤은 `requiredItem`이다.
   - 별칭은 기존 `aliases.json`에 `meta` 절(출처 메모 포함)을 두어 더한다. 2026-10에는 비어 있다.
3. **위반 판정·제외:**
   - 종 위반(미연결·로스터 밖)이면 항목 전체를 뺀다.
   - 도구 위반은 미연결과 로스터 밖이다. `nothing`은 정상 값이다.
   - 특성 위반은 그 폼(메가는 메가 폼)의 `abilities` 밖인 값이다.
   - 기술 위반은 원종 learnset 밖인 값이다. 빈 칸은 위반이 아니라 제외하고 개수만 센다.
   - spread 위반은 미지 성격, 능력치당 0~`spMaxPerStat` 밖, 합계가 `spTotal` 초과인 값이다.
   - 동료 위반은 미연결과 로스터 밖이다.
   - 남은 점유율은 다시 정규화하지 않는다. 분모 W는 Σ원천 특성이다.
4. **분포·주변분포·표본(결정 5):**
   - 사용률 최소값 이상인 항목만 출력한다.
   - 순위는 위반으로 뺀 항목을 제외한 뒤 (usage 내림차순, id 오름차순)으로 매긴다.
   - weightedBattles는 원천 전체 종(최소값·위반 무관) Σ특성 ÷ 12다.
5. **대표 세트(결정 3):**
   - 일반 항목은 위반 제외 후의 1위 spread, 최다 도구(`nothing`이면 도구 생략), 최다 특성, 빈 칸을 뺀 최다 기술 4개를 합친다. 기술 4개는 컷과 무관하게 전체 분포에서 고른다.
   - 메가 항목은 `species = base`, `item = stone`, `mega: true`로 둔다. 특성은 위반 제외 후 원천 최다 특성이 원종 `abilities`에 있으면 그 값(`source-top`)이고, 없으면 원종 `abilities[0]`(`base-first-slot`)이다. spread·기술은 메가 항목 분포에서 고른다.
   - 동률은 id(키) 순으로 정한다.
   - 생성 시 `validateSet(gameSnapshot, set)`이 던지면 생성이 실패한다. 메시지에 항목 id와 오류 상세를 넣는다.
6. **리포트(`report.json`·`report.md`):**
   - 위반 종류별 개수와 빠진 가중 점유율, 종별 내역
   - 빈 칸 기술 수
   - 미연결 경고(사용률 최소값 이상인 종은 log WARNING)
   - 메가 점검: 최다 도구가 스톤이 아님, 메가 폼 특성 밖 특성
   - 보존 통계: 목표 도달 종 수, 최대 개수 종 수, 누적 최소·평균
   - 파일 바이트 수

### 3. 테스트 입력 전략

**3.1 동결 픽스처(실제 원천 일부)**

- 출처는 2026-10 Bo1 1760 원천(sha256 기록값)이다. `scripts/data/make-meta-fixture.mjs <원천.json> <출력.json>`로 만든다. 스크립트는 원천 디렉터리 밖에 두고 경로를 인자로 받는다.
- 규칙은 다음과 같다.
  - `info`는 그대로 둔다.
  - 아래 종만 남긴다. 종마다 `Raw count`·`usage`·`Abilities`·`Items`·`Spreads`·`Moves`는 원천 그대로다.
  - `Teammates`는 가중값 상위 12개만 남긴다(동률은 키 순). 출력 상위 10의 값은 바뀌지 않는다.
  - 읽지 않는 필드(`Checks and Counters`·`Tera Types`·`Happiness`·`Viability Ceiling`)는 뺀다.
  - 직렬화는 압축 JSON으로 한다(예상 약 100KB).
- 포함 종과 목적:

| 원천 키 | 사용률 | 목적 |
| --- | --- | --- |
| Lycanroc-Dusk | 0.829% | 기본 최소값에서 목록 안. 도구 `nothing`·빈 칸 기술 포함 |
| Aerodactyl | 0.6586% | 기본 최소값에서 목록 안(순위 2개 이상) |
| Meowstic-F-Mega | 0.4454% | 최소값 바로 아래(기본값에서 래더 가정 없음). 메가스톤 공유(meowsticite → 원종 meowsticf) |
| Meowstic-M-Mega | 0.0105% | 메가스톤 공유(→ 원종 meowstic). 냐오닉스 수컷·암컷 메가 해석 |
| Charizard | 0.036% | 메가리자몽Y의 원종. 최소값을 낮추면 별도 항목, 기본값이면 래더 가정 없음 |
| Medicham-Mega | 0.018% | 원천 최다 특성(purepower)이 원종 특성 → `abilityBasis: source-top` |
| Pidgeot-Mega | 0.040% | 원천 최다 특성(noguard)이 원종 밖 → 원종 첫 슬롯 keeneye, `base-first-slot` |
| Toxtricity | 0.2215% | 실제 위반: 특성 minus(폼 밖), 기술 paraboliccharge·magneticflux(learnset 밖). M-B 로스터 밖 종 |
| Pinsir-Mega, Quaquaval | 0.02501% 동률 | 실제 동률 → id 순(pinsirmega < quaquaval) |

- 상위 종(포푸니크 248KB, 메가리자몽Y 242KB, 메가한카리아스Z 126KB, 고릴타 565KB)은 담지 않는다. 담으면 픽스처가 1MB를 넘고, `Spreads`를 자르면 결정 1의 분포 합 검증이 깨진다. 그래서 이 종들의 수용 기준 값(상위 5 사용률, 포푸니크 1위 배분 13.15%·S32 46.65%·고집 54.44%·도구 33.43%·동료 59.81%, 메가리자몽Y·메가한카리아스Z, 상위 5 표본 지표)은 **실제 원천으로 생성해 커밋한 스냅샷**을 검사하는 테스트(`meta-snapshot.test.ts`)로 확인한다. 기대값은 이 notes의 "ADR 근거 실측" 값으로, 생성기와 독립된 실측 스크립트가 낸 값이다.

**3.2 합성 원천(테스트 안에서 픽스처를 복제·변형)**

- 위반 섞기:
  - 종 `Fakemon`(미연결), 종 `Mewtwo`(dex에는 있고 로스터 밖. 구현 시 m-c 로스터 밖인지 확인)
  - 도구 `choiceband`(로스터 밖), `zzfakeitem`(미연결)
  - 특성 `levitate`(Lycanroc-Dusk 폼 밖)
  - 기술 `spore`(learnset 밖), `zzfakemove`(미연결)
  - spread `Adamant:33/32/0/0/0/1`(능력치 상한 초과), `Adamant:32/32/32/0/0/0`(합계 초과), `Fakenature:2/32/0/0/0/32`(미지 성격)
  - 동료 `Fakemon`
  - 위반 가중값을 넣을 때는 Σ특성·Σ도구·Σspread가 같게 유지되도록 기존 값에서 같은 양을 옮긴다.
- 형식 실패: `Spreads` 삭제, `info.cutoff = 1630`, `info["cutoff deviation"] = 0.5`, `info.metagame` 변경, 기록 format을 다른 레귤레이션 포맷으로 지정, 기간 밖 월(2026-06), spread 키 `Adamant:2/32/0`, `Items` 값을 1.01배, `usage` 문자열.
- 상성 정보: `"Checks and Counters": {}`와 `[]`를 넣은 원천이 정상 생성된다.
- 설정만으로 추가: 주입 설정 `regulations["m-b"] = { bo3: "gen9championsvgc2026regmbbo3" }`, 월 2026-09. 픽스처의 `info.metagame`을 바꿔 캐시에 둔다. 그러면 `m-b/2026-09-bo3.json`이 생성되고, 인덱스에서 m-b의 기본 선택이 Bo3가 된다. Toxtricity는 로스터 밖 종으로 리포트된다.
- 오버레이(래더 외 출처): 테스트 안 객체 하나로 둔다. 대상은 rotomwash(실제 Bo1 최소값 바로 아래)이고, `source.kind: 'custom'`, `intent` 텍스트를 넣는다. 세트는 levitate·hydropump 포함이다. 오버레이 파일은 만들지 않는다(결정 3).

**3.3 실제 2026-10 Bo1·Bo3 스냅샷**

- T2가 `--record`(네트워크)로 기록한 뒤 생성해 커밋한다.
- 기록 해시는 notes의 해시 앞부분(`6c693b54…08a5d`, `8a8b678d…e8392c`)과 대조한다. 다르면 원천 파일이 바뀐 것이므로 실측값이 그대로 유지되는지(3.1의 기대값) 확인하고 보고한다.
- `.cache/smogon/`은 커밋하지 않는다(`.gitignore`의 `.cache/`).

### 4. PRD 수용 기준 → 테스트 매핑

| PRD 수용 기준 | 테스트(파일 · 태스크) | 입력 |
| --- | --- | --- |
| 2026-10 Bo1·Bo3 커밋, M-C 기본 = Bo1 2026-10 | `meta-snapshot.test.ts`(T5): 인덱스 m-c 항목 2개·파일 존재, `resolveMetaSelection(index, gameIndex)` = bo1/2026-10, `loadMetaSnapshot()` 결과 일치 | 커밋 생성물 |
| 없는 (매치 방식, 월) 지정 시 오류 | `meta-loader.test.ts`(T1) | 합성 인덱스 |
| Bo1 없는 레귤레이션 → Bo3 최근 월 | `meta-loader.test.ts`(T1, 합성 인덱스) + `meta-pipeline.test.ts`(T2, m-b 설정만 추가 생성 후 선택) | 합성 |
| 상위 5 사용률(소수 첫째 자리) | `meta-snapshot.test.ts`(T5): id·순위 sneasler, kingambit, basculegion, charizardmegay, rillaboom, `usage*100`이 49.9/42.2/34.4/32.3/27.4와 ±0.05 이내 | 커밋 Bo1 |
| 최소값 바로 아래·원천에 없는 로스터 종 → 래더 가정 없음, 커스텀 1개 → 계산 결과, 동률 id 순 | T5: rotomwash·absol `lookupOpponent` → no-ladder·가정 0개, 커스텀 오버레이 → no-ladder + 1개 → `calcDamage` 결과 kind `damage`. T3: 합성 동일 경로. T2: 픽스처 동률 pinsirmega·quaquaval 순위 | 커밋 + 합성 + 픽스처 |
| 메가·기본 폼 별도 항목, 메가 → 원종·스톤, Z 메가, 대표 세트가 메가 폼으로 해석 | T5: garchomp·garchompmega·garchompmegaz 별도 항목, charizardmegay.mega = {charizard, charizarditey}, garchompmegaz.mega = {garchomp, garchompitez}, 두 대표 세트 `validateSet` → species가 메가 폼 id. T2: 최소값을 낮춘 픽스처에서 charizard·메가 별도, meowsticmmega → meowstic, meowsticfmega → meowsticf, medichammega `source-top`, pidgeotmega `base-first-slot`(keeneye) | 커밋 + 픽스처 |
| 포푸니크 1위 spread `고집 H2/A32/B0/C0/D0/S32` 13.2%, 보존 규칙과 누적 | T5: `spreads.kept[0]` = `['adamant:2/32/0/0/0/32', ≈0.1315]`, 모든 항목 `keptShare ≥ target` 또는 `kept.length = spreadMax`. T2: 픽스처·축소 params에서 같은 규칙 | 커밋 + 픽스처 |
| 포푸니크 S32·고집 = 전체 기준, 분산형 종도 전체 기준 | T5: `spMarginal.spe['32']` ≈ 0.4665, `natures.adamant` ≈ 0.5444. rillaboom은 kept 30개·keptShare ≈ 0.439인데 Σnatures ≈ 1 − spreads.excludedShare. T2: spreadMax = 3에서 주변분포 = 픽스처 원천 직접 집계(테스트 안 독립 계산) | 커밋 + 픽스처 |
| 포푸니크 최다 도구·동료 | T5: items 최다 whiteherb ≈ 0.3343, teammates 최다 kingambit ≈ 0.5981 | 커밋 |
| 상위 5 표본 지표 = 정의식 | T5: sample.weighted·raw = notes 값(가중 ±0.05), manifest.sample.weightedBattles ≈ 6357.6(Bo3 6592.7), source.battles = 1,649,648 / 262,609. T2: 픽스처에서 정의식(Σ특성, Raw count, Σ/12) 독립 계산과 같음 | 커밋 + 픽스처 |
| 상위 30 대표 세트 검증 통과, 대도각참 기습 → 포푸니크 대미지 | T5: `topAssumptions(view, 30)` 모두 usable, kingambit 대표 moves ∋ suckerpunch, `calcDamage(game, kingambit, sneasler, 'suckerpunch').kind === 'damage'` | 커밋 |
| 위반 섞은 원천 → 제외 + 리포트 종류별 개수 | T2: 3.2 위반 입력이 스냅샷에 없고 report.json 종류별 개수·빠진 점유율이 맞음. 남은 점유율 = 원천 값 ÷ W(재정규화 없음) | 합성 |
| 필수 필드 누락·컷·다른 레귤레이션 포맷 → 실패, 빈 상성 정보 → 정상 | T2: 사유별 `rejects.toThrow(/종·필드/)` | 합성 |
| 캐시 재생성 바이트 동일, 1바이트 변경 → 실패, 강제 없이 덮어쓰지 않음, 게임 데이터 식별자 기록 | T2: 두 outRoot 바이트 비교, 캐시 변조 → 해시 불일치, 재실행 → skipped·바이트 불변, `--force` → 다시 생성, 미기록 → 실패, manifest.gameData = {m-c, 1, sha256(data.json)}. T5: 커밋본 manifest.gameData.sha256 = 현재 data.json 해시. Phase 3: 실제 캐시로 빈 outRoot 재생성 후 `diff -r`(수동 검증) | 픽스처 + 커밋 |
| 테스트용 레귤레이션·포맷 대응을 설정에만 추가 → 생성 | T2: m-b 설정 주입(3.2) | 합성 |
| 1MB 이하, 상위 30 중앙값 ≤ 50ms(측정 기록) | T5: 커밋 파일 바이트 ≤ 1,000,000, 리포트 size = 실제 바이트. e2e `perf.spec.ts`: `__perf.metaLoad(20, 3)` 중앙값 ≤ 50ms, 환경 주석 | 커밋 |
| 래더 외 출처 가정(의도 포함) → 같은 경로로 결과, 기존 스냅샷 불변 | T3: 합성 메타 + custom 가정 → `resolveAssumption` usable → `calcDamage`. T5: 커밋 파일 바이트를 앞뒤로 읽어 같음 | 합성 + 커밋 |
| 라이선스·출처 고지에 Smogon 출처·링크·원천 월·공개 시각 | T4 `licenses.test.ts`: `buildLicenses`가 메타 인덱스 입력만으로 Smogon 항목을 만든다(인덱스에 없는 월은 안 나옴). T4 `snapshot.test.ts`: 커밋 고지에 `https://www.smogon.com/stats/`·`2026-10`·인덱스의 publishedAt이 있음. `pipeline.test.ts` 재현성 테스트가 커밋본 일치를 지킴 | 합성 + 커밋 |
| 대표 세트의 종(메가 폼 포함)·도구·특성·기술 한국어명 = 기존 매핑 | T5: 상위 30의 `setDisplayNames`가 `game.data.*[id].name.ko`와 같고 missing 없음, charizardmegay = "메가리자몽Y". T3: 합성에서 없는 id → missing·원문 id | 커밋 + 합성 |

ADR 검증 항목 중 위 표에 없는 것:

- 지정한 파일 하나만 로드: T1에서 주입 importer 호출 횟수로 확인한다.
- 스키마 버전 거부: T1(로더)과 T2(디스크의 다른 버전 파일 → 생성 실패, 쓰기 없음)에서 확인한다.
- 인덱스 = 디스크 전체: T2(지난 월 파일 시드 후 다른 월 생성 → 인덱스에 둘 다 있음)와 T5(커밋 디렉터리 ↔ 인덱스)에서 확인한다.
- 메타 명령이 PokeAPI 캐시·네트워크 없이 돌고 고지를 쓰지 않음: T2에서 빈 cacheDir과 던지는 fetch를 주입하고, outRoot에 licenses·notices·pokeapi 디렉터리가 없음을 확인한다.
- 최신 월 해시 불일치 실패 / 지난 월 보고: T1(`classifyGameDataRefs` 합성)과 T5(커밋 전체 적용, `mismatchLatest` = [] 단언, `staleArchived`는 로그)에서 확인한다.

### 5. 성능 측정

- `src/dev/perf.ts`의 `PerfHook`에 `metaLoad(runs = 20, warmup = 3): Promise<PerfStats>`를 더한다.
  - 준비(측정 밖): `loadSnapshot('m-c')`로 게임 데이터를 로드하고, `import('../data/meta/m-c/2026-10-bo1.json?raw')`로 본문 문자열을 받는다(네트워크 제외 = 본문 수신 완료 시점).
  - 측정(1회): `JSON.parse(text)` → `assertMetaSnapshot` → `createMetaView` → `topAssumptions(view, 30)`
  - 기존 `measure`를 재사용한다(중앙값·최소·최대).
- `e2e/perf.spec.ts`에 테스트 하나를 더한다. `window.__perf.metaLoad(20, 3)` 중앙값이 50ms 이하인지 보고, 브라우저 이름·버전과 결과를 `annotations`·로그로 남긴다. 전역 `__perf` 선언에 `metaLoad`도 더한다.
- 기록 항목은 다음과 같다. T5가 보고하고 orchestrator가 notes `## 검증`에 적는다.
  - 기기(CPU), OS, 브라우저 버전
  - 빌드(정적 빌드 미리보기)
  - 캐시 상태(본문 문자열은 메모리에 있음, 게임 데이터는 로드됨, 같은 페이지에서 반복)
  - 중앙값·최소·최대·회수

### 6. 구현 태스크

순서는 T1 → (T2 ∥ T3) → T4 → T5다. T4는 T2에 의존하고, T5는 T2·T3·T4에 의존한다. 파일은 태스크끼리 겹치지 않는다.
예외가 하나 있다. `src/data/meta/index.json`은 T1이 빈 상태(`{"regulations":{},"schemaVersion":1}` + 끝 줄바꿈, `stableStringify` 형식)로 만들고, 그 뒤로는 T2의 생성 명령만 다시 쓴다.

| id | agentType | 의존 | 파일 | 완료 조건 |
| --- | --- | --- | --- | --- |
| T1 | domain-engineer | — | `src/data/meta-schema.ts`, `src/data/meta-guard.ts`, `src/data/meta-loader.ts`, `src/data/meta/index.json`(빈 상태), `src/data/testing.ts`, `src/data/meta-loader.test.ts` | 2.2·2.3 계약대로 구현. 선택 규칙·오류·스키마 거부·파일 1개 로드·`classifyGameDataRefs` 테스트 통과, `npm run lint`·`tsc -b` 통과 |
| T2 | domain-engineer | T1 | `scripts/data/meta.config.json`, `scripts/data/build-meta.mjs`, `scripts/data/lib/ts-hooks.mjs`, `scripts/data/lib/meta-source.mjs`, `scripts/data/lib/meta-build.mjs`, `scripts/data/lib/meta-pipeline.mjs`, `scripts/data/lib/meta-pipeline.d.mts`, `scripts/data/make-meta-fixture.mjs`, `scripts/data/aliases.json`(빈 `meta` 절), `src/data/__fixtures__/meta/…partial.json`, `src/data/meta-pipeline.test.ts`, `package.json`, 생성물 `src/data/meta/**`, `data/reports/meta/**` | 2.1·2.5·2.6 계약 구현. 픽스처 테스트 통과. 실제 2026-10 m-c Bo1·Bo3 기록·생성 완료, 각 1MB 이하, 생성 로그에 미연결 경고 없음, 같은 캐시로 빈 outRoot 재생성 바이트 동일 |
| T3 | domain-engineer | T1 | `src/meta/types.ts`, `src/meta/assumptions.ts`, `src/meta/index.ts`, `src/meta/assumptions.test.ts` | 2.4 계약 구현. 합성 메타 스냅샷(테스트 안에서 커밋 m-c 게임 데이터 기준으로 구성)으로 조회·오버레이·이름 조인·사용 불가·계산 경로 테스트 통과 |
| T4 | domain-engineer | T2 | `scripts/data/lib/licenses.mjs`, `scripts/data/lib/pipeline.mjs`, `scripts/data/lib/pipeline.d.mts`, `src/data/licenses.test.ts`, `src/data/snapshot.test.ts`, 재생성 `src/data/licenses.json`·`THIRD_PARTY_NOTICES.md`, `README.md` | Smogon 고지 항목. `npm run gen:snapshot` 뒤 `git status`에 고지 2개 파일만 바뀜(`data.json` 불변), `pipeline.test.ts` 재현성 통과, README 절차 |
| T5 | test-engineer | T2, T3, T4 | `src/data/meta-snapshot.test.ts`, `src/dev/perf.ts`, `e2e/perf.spec.ts` | 4절의 커밋 생성물 수용 테스트 통과, e2e perf 중앙값 ≤ 50ms와 측정 환경 보고, 전체 `npm run test:run`·`lint`·`build`·`test:e2e` 통과 |

### 7. 위험 요소

1. **PokeAPI 캐시가 없을 때 `pipeline.test.ts`:** `buildAll`이 네트워크로 받으러 간다. 이 워크트리에는 캐시가 있다.
   - 메타 테스트는 `buildAll`을 부르지 않는다. T2 테스트는 PokeAPI 없이 도는지 단언한다.
   - T4 검증은 기존 캐시로 한다. 캐시가 없는 환경에서 실패하는 것은 기존 동작이고, 이 단위의 회귀가 아니다.
2. **고지 생성 경로 변경:** `buildAll`이 입력 루트의 `src/data/meta/index.json`을 읽게 된다.
   - 메타 생성 뒤 `gen:snapshot`을 다시 돌리지 않으면 재현성 테스트가 실패한다(의도된 동작, 결정 2). 순서는 T2(생성) → T4(고지 재생성)다.
   - 라이선스 검사 `KNOWN_LICENSES`가 Smogon(공식 문구 없음)을 거부하지 않게 해야 한다. `attributionOnly: true` 항목만 예외로 두고 라이선스 값은 `NOASSERTION`으로 한다. 기존 테스트의 "불명확 항목 없음"은 attributionOnly를 뺀 항목에 적용하도록 바꾼다.
   - 개발 확인 페이지(`Licenses.tsx`)는 `entries`를 그대로 표에 그린다. Smogon 항목의 `version`에 "2026-10 Bo1(공개 …Z) · 2026-10 Bo3(공개 …Z)"를 담아 코드 수정 없이 보이게 한다.
3. **m-c `frozen: false` 해시 연동:**
   - T4가 `gen:snapshot`을 다시 돌려도 `data.json`은 바이트가 같아야 한다. `git diff`로 확인한다.
   - 이후 보정표 등으로 `data.json`이 바뀌면 T5의 최신 월 해시 테스트가 실패한다. 그때는 같은 변경에서 `npm run gen:meta -- --regulation m-c --month 2026-10 --force`를 돌려야 한다. 그러려면 원천 캐시나 재다운로드가 필요하다. 이 절차는 README에 적는다(T4).
4. **Node CLI 확장자 해석:** 훅 없이 `src/core`를 import하면 CLI만 실패하고 Vitest는 통과해서 문제가 숨는다. 그래서 T2 완료 조건에 실제 CLI 실행을 넣었다. `module.registerHooks`는 Node 22.15+에 있고, engines는 ≥22.18이다.
5. **기록에는 네트워크가 필요하다.** Bo1 `Last-Modified`는 실측되지 않았다. 네트워크가 없으면 T2를 멈추고 보고한다. 공개 시각을 지어내거나 Bo3 값을 복사하지 않는다.
6. **엔진 미지원:** 대표 세트의 특성·도구·종이 `engineUnsupported`면 `validateSet`이 던져 생성이 실패한다(ADR상 의도된 동작). 2026-10 상위 종에는 해당 사항이 없다.
7. **부동소수 표기:** `13.15.toFixed(1)`처럼 `toFixed`가 "13.1"을 낼 수 있다. 수용 테스트는 notes의 소수 둘째 자리 값과 `toBeCloseTo(v, 1)`(오차 0.05 미만)로 비교한다.
8. **크기:** spread·분포의 직렬화 형식을 바꾸면 ADR 실측과 어긋날 수 있다. 생성기의 1MB 검사가 막지만, 형식은 2.2를 지킨다.
9. **glob 오염:** `src/data/meta/` 아래에 픽스처나 리포트를 두면 로더 glob과 인덱스 재생성 allowlist가 깨진다.
10. **PRD 예시 문구(리자몽):** 0절대로 실제 스냅샷에서 리자몽은 목록 밖이다. 이 계획은 한카리아스 세 항목과 픽스처로 검증한다. 이 해석을 PRD에 반영할지는 orchestrator가 사용자에게 확인한다.

### 8. 구현 규칙 발췌

- **코드리뷰 §0:**
  - 동작이 바뀌면 문서도 같은 diff에서 바꾼다(README·고지).
  - 같은 사실을 두 곳에서 계산하지 않는다. 예를 들어 반올림·id 규칙·매치 방식 상수는 한 곳에서 파생한다. 생성기는 `toID`를 `util.mjs`의 것으로 쓰고, 앱은 스키마 상수를 import한다.
  - 경계 입력은 allowlist로 검증한다(설정·원천·파일 이름·요청 인자).
  - 기록↔생성, 생성↔인덱스 재생성, 보존↔`--force`가 같은 diff에 짝으로 들어간다.
- **§1:** 고지·NOTICE는 실제 존재하는 산출물만 나열하고, 출처 URL·월·공개 시각으로 뒷받침한다. "라이선스 있음" 같은 포괄 선언은 하지 않는다.
- **§2:** 생성기와 앱의 정규화 규칙이 하나여야 한다(id, 반올림, 메가 판정 = 게임 데이터 `isMega`).
- **§9:**
  - 캐시 키에 월·포맷·컷이 들어가고, 원천 해시를 기록값과 대조한다.
  - 필터 정책(최소값·컷)을 바꾸면 스키마·매니페스트 params와 리포트가 함께 바뀐다.
  - 외부 원천은 해시로 고정한다. floating 참조를 쓰지 않는다.
- **§10:** 게이트가 개수만 보지 않게 한다. 예를 들어 상위 30 세트 "검증 통과"는 실제 `validateSet` 호출로 확인한다. `tsc -b`(테스트 포함)와 lint를 커밋 전에 따로 돌린다.
- **주석(관문 요지):** WHY·결정 ID·실측 수치·이력은 ADR/notes 몫이라 코드에 옮겨 적지 않는다. 남기는 것은 허용목록뿐이다.
  - ① 외부 제약(Node 훅이 필요한 이유 같은 것)
  - ② 단위·경계(점유율 0~1, 반올림 자리)
  - ③ 순서 의존
  - ④ 공개 API 문서
  - ⑤ 테스트 파일 봉인 1줄
  - ⑥ `@see` 하나

  5줄을 넘으면 문서로 옮긴다. 마크다운과 줄 번호는 쓰지 않는다.
- **지식 불변식(brief):**
  - `INV-261105-snapshot-deterministic`: 메타 생성도 고정 설정 시각과 정렬 직렬화만 쓴다. 동결 레귤레이션 게임 데이터는 건드리지 않는다.
  - `INV-261105-legal-rule-forme-name`: 메타 판정은 게임 데이터 `isMega`(폼 이름으로 만든 값)만 쓰고, 원천 문자열 `-Mega`를 해석하지 않는다.
  - `INV-261105-mega-ko-nospace`: 한국어명은 게임 데이터 이름만 쓰고 메타 쪽에서 다시 조립하지 않는다.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

- G: Node 명령에서 `src/core/*.ts`를 import하려면 확장자 보정 resolve 훅(`scripts/data/lib/ts-hooks.mjs`)이 먼저 등록돼야 한다. Vitest는 훅 없이도 통과해 누락이 숨는다 — 실제 CLI 실행으로 확인한다.
- G: 수용 테스트에서 백분율을 `toFixed(1)`로 비교하면 부동소수 반올림이 틀린다(13.15 → "13.1"). `toBeCloseTo`를 쓴다.
- G: 메타 스냅샷을 더하거나 바꾼 뒤에는 `npm run gen:snapshot`으로 출처 고지를 다시 만들어야 한다(고지는 게임 데이터 명령만 쓴다). 빠뜨리면 재현성 테스트가 실패한다.
- INV: 동결되지 않은 레귤레이션에서 매치 방식별 최신 월 메타 스냅샷의 게임 데이터 해시는 현재 `data.json`과 같다. 게임 데이터를 바꾸면 같은 변경 안에서 최신 월 메타를 `--force`로 다시 만든다.
- INV: 메타 원천 값은 위반 제외 후 재정규화하지 않는다(분모는 원천 가중 출현 수). 원천 값과 소수 자리까지 대조하는 수용 테스트의 전제다.

## 검증

- 원천 기록(2026-11-06 실측, `npm run gen:meta -- --regulation m-c --month 2026-10 --record`): Bo1 sha256 `6c693b54b5bc52056af8e32e355c715e954491f9d9f5daa901b81de3d4408a5d`, Bo3 `8a8b678d980a3c71851d1e1b1392253f547ea70686cfb9580cc1a6ce23e8392c`(조사 값과 일치). 공개 시각은 둘 다 Last-Modified `2026-11-01T13:27:17Z`.
- 생성물: `src/data/meta/m-c/2026-10-bo1.json` 79종 637,313바이트, `2026-10-bo3.json` 68종 460,742바이트(1MB 이하). ADR 추정 579KB·390KB보다 큰 이유는 추정에 대표 세트·매니페스트·주변분포가 빠져 있었기 때문이다. 연결한 게임 데이터 m-c `data.json` sha256 `48725096b7d2440b815ec067b1f754a17837788360fccb0d974cf4c9be0d4593`.
- 위반 리포트: Bo1 특성 위반 3(toxtricity minus·meowstic competitive·squawkabilly sheerforce), learnset 밖 기술 3(toxtricity paraboliccharge·magneticflux, meowstic futuresight), 그 밖 0. Bo3 특성 2·기술 1. 미연결 0.
- 결정론: 빈 `--out-root`에서 다시 생성한 결과와 `diff -r` 동일. `gen:snapshot` 재생성 후 고지 2개 파일 외 변경 없음, `pipeline.test.ts` 재현성 통과.
- 로드 성능(`e2e/perf.spec.ts` 메타 로드, `metaLoad(20,3)`): 중앙값 0.70ms(최소 0.60, 최대 1.50, n=20). 범위는 메타 본문 수신 완료 후 JSON 파싱 → 스키마 검증 → 메타 뷰 → 상위 30 대표 가정(한국어 조인·코어 세트 검증 포함), 게임 데이터는 로드된 상태. 환경: Apple M4 Pro 12코어, macOS 26.6.2, Playwright Chromium 156.0.8078.4, `npm run build` 결과를 `vite preview`로 서빙, 같은 페이지 반복(웜). 콜드 캐시·다른 브라우저는 측정하지 않았다.
- 빌드: 메타 스냅샷은 별도 청크(Bo1 637.34kB)로 나오고 메인 번들에 본문이 없다.
- 테스트: `npm run test:run` 18파일 389건, `npm run test:e2e` 13건, `lint`·`tsc -b` 통과(T5 시점).
- 구현 리뷰(4렌즈 × 3회 + 잔여 수정 검증): 1·2회 MAJOR(메가 점검 리포트 경로 미검증, 동률 id 순·대표 세트 구성 규칙 미검증, 해시 규칙 테스트 범위) 수정. 3회 MAJOR 1건(PRD 리자몽 예시)은 사용자 확인으로 PRD 예시 개정. 잔여 MINOR 7·COSMETIC 1 수정 — 보존 결과 3범주(reachedTarget/hitMax/exhausted, exhausted는 WARNING), 생성 모드 캐시는 해시 일치 후에만 기록, 가정의 해석 종 ≠ target이면 usable:false, 픽스처를 고지 testOnly에 추가, 대표 세트 basis·abilityBasis 단언, CLI 머리 주석 축소.
- 잔여 수정 후: `npm run test:run` 18파일 396건, `lint`·`tsc -b`·`build`·`test:e2e` 13건 통과. 캐시로 임시 경로 재생성 결과가 커밋 `src/data/meta`·`data/reports/meta`와 `diff -r` 동일(오케스트레이터 직접 확인). 리포트 retention: Bo1 reachedTarget 54·hitMax 25·exhausted 0, Bo3 55·13·0.
- 리포트 필드 추가: `retention.exhausted`(수)·`retention.exhaustedSpecies`(목록).
- 참고: notes "ADR 근거 실측"의 기술 위반 "가중 0.0001%"는 전체 가중 대비 비율이다. 종 내 점유율로는 toxtricity paraboliccharge 1.24%다. 고릴타 keptShare 실측 0.4385(앞의 43.9%는 반올림).

## 후속 작업

- 후속 작업
