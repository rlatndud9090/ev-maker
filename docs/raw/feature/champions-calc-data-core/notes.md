# Notes: 챔피언스 계산 코어(SP 어댑터·스피드 엔진)와 게임 데이터·한국어 매핑

> 사람은 중립 역할어(`사용자`/`개발자`/`검증자`)로 지칭한다 — 개인 호칭·별명은 넣지 않는다
> (운영자 설정이 그렇게 부르라 해도). 상세: `harness/templates/examples/README.md` §5.

Date: 2026-11-04 Asia/Seoul
Unit type: feature
Status: draft

## 맥락

- 2026-11-04 next-feature 리서치(에이전트 9개, 교차검증 포함)에서 확인한 사실:
  - 챔피언스는 EV/IV가 아니라 SP(Stat Points)를 쓴다. 능력치 하나에 0~32, 합계 66이다. IV 31·레벨 50 고정.
  - 실능치: HP = 종족값 + SP + 75. 나머지 = ⌊(종족값 + SP + 20) × 성격보정⌋.
    골든값: 고집 맘모꾸리 공격 32 SP = 200, 겁쟁이 플라엣테(Eternal) 스피드 32 SP = 158.
  - `@smogon/calc` 0.12.0(MIT)이 `Generations.get(0)`으로 챔피언스를 지원한다. SP는 `evs` 필드에 그대로
    넣는다(`sps` 필드 없음). 레벨 처리 검증 결과가 엇갈려 `level: 50`을 항상 명시해야 한다.
  - 대미지 공식은 9세대와 같다(16난수, 범위기 3072/4096). 스피드 보정: 스카프 ×1.5(내림), 순풍 ×2,
    날씨 특성 ×2, 트릭룸은 부호만 반전(언더플로 제거). 구애머리띠·구애안경·부스트에너지는 사용 불가.
  - 9세대 데이터를 그대로 쓰면 안 된다(PP, 속이기 조건, 상태이상, 기술 위력이 다름).
    Showdown `data/mods/champions`만 게임 데이터 원천으로 쓴다.
  - 현재 규칙 Reg M-C는 2026-12-02에 끝난다. 데이터 오버라이드 계층과 regulation 키가 필요하다.
  - PokeAPI(BSD-3)가 champions version group(id 32)을 지원하지만 신규 메가 폼 ko 이름은 비어 있다.
- 재사용 후보(같은 개발자의 형제 프로젝트):
  - `~/prvprjt/poke-sherpa`: `scripts/build-champions-data.mjs`, `build-ko-data.mjs`, `src/matchup/mega.ts`,
    `src/calc/engine.ts`. 단 `@smogon/calc` 0.11 gen9·Reg M-B 기준이라 gen 0·M-C로 올려 이식해야 한다.
  - `~/prvprjt/poke-battle-quiz`: `scripts/gen-pokemon-data.mjs`의 메가 X/Y/Z 접미 한국어 규칙(예: 메가앱솔Z).
- 상위 데이터 방침(후속 단위): 상대 SP는 통계 분포로 가정하고, 참가자가 SNS·블로그에 올린 SP와
  구축 기사의 SP 의도도 수집한다. 이 단위의 데이터 스키마가 이를 막지 않게 설계한다.

## 조사 결과 (PRD 근거, 2026-11-04 실측·감사)

### 계산 라이브러리 런타임 실측 (`@smogon/calc` 0.12.0, 2026-09-18 배포)

- 실측 스크립트: `/tmp/ev-maker-calc-probe/probe.js`, `probe2.js`(임시 위치라 휘발될 수 있다).
- gen 0은 생성자가 level을 무시하고 50으로 고정한다(`dist/pokemon.js:39`). IV도 무시한다(`:52`).
  level을 미지정/50/100으로 넣어도 결과가 같다. → 이전 리서치의 "레벨 처리 엇갈림"은 해소됐다.
- SP는 `evs` 필드에 그대로 넣는다. 고집 Mamoswine 공격 SP32 = 200, 겁쟁이 Floette-Eternal 스피드 SP32 = 158,
  Mamoswine HP SP0 = 185 / SP32 = 217, Delphox-Mega HP SP2 = 152가 재현된다.
- **SP 범위·합계 검증이 없다.** 252, 33, -5를 넣어도 그대로 계산한다. → 앱이 검증해야 한다.
- `calculate()`: 더블 Field면 범위기 0.75 보정이 자동으로 들어간다(Earthquake 싱글 204-240 → 더블 152-180).
  결과는 16개 난수 배열(`damage`)이고, `kochance()`가 `{chance, n, text}`를 준다. text·desc는 영어다.
  예: Kingambit Sucker Punch(공격 SP32) vs 2 HP / 0 Def Delphox-Mega(더블) = 176-210(115.7-138.1%), 확정 1타.
  난1 예: Mamoswine Iron Head vs Floette-Eternal, 56.3% chance to OHKO.
- `calculate()`는 입력 객체를 바꾸지 않는다. 최종 스피드는 결과로 받을 수 없다.
- 스피드: `getFinalSpeed`가 `dist/mechanics/util`에만 있다(공개 export 아님). 순풍, 스카프, 랭크, 마비, 쓱쓱 등을
  처리하지만 트릭룸·행동순서 비교·"목표 스피드를 넘는 최소 SP 역산"은 없다.
  실측: Floette-Eternal 158 → 순풍 316, 스카프 237, +1 237, -1 105, 마비 79.
- gen 0 데이터: 종 359(메가 82), 기술 526, 도구 166, 특성 215, 성격 25. M-C 신규 메가가 모두 있다.
  learnset은 없다.
- **함정 1** 사용 불가 도구(Choice Band·Specs·Assault Vest)는 데이터에 없다. 넣으면 에러 없이 보관되고
  대미지에는 반영되지 않는다(무음 무시).
- **함정 2** `Pokemon.getForme(gen,'Garchomp','Garchompite Z')`가 `Garchomp-Mega`를 반환한다(Z 오매핑).
  `MEGA_STONES` 맵은 올바르다.
- **함정 3** 없는 종 이름을 넣으면 `TypeError`가 난다(친절한 에러 아님).
- **함정 4** gen 0 species의 특성 목록이 불완전해 보인다. Kingambit이 `{0:'Defiant'}`만 가진다.
  특성 선택지의 출처는 따로 정해야 한다.
- 크기: calc 본체와 데이터를 합쳐 gzip 약 114KB. 클라이언트 번들로 감당할 수 있다.
- 입력 고정 실측(`/tmp/ev-maker-calc-probe/probe3.js`, 2026-11-04). 모두 Doubles, 방어측 Delphox-Mega는 Hardy, HP SP 2, 나머지 SP 0, 특성 Levitate, 실능 HP 152 / 방어 92다:
  - Kingambit Hardy·특성 기본(Defiant)·공격 SP32(실능 187), 도구 없음, Sucker Punch →
    162-192(106.5-126.3%), 확정 1타. 16개 값: 162,164,164,168,168,170,174,174,176,180,180,182,186,186,188,192
  - Kingambit Adamant·Supreme Overlord(쓰러진 아군 0)·공격 SP32(실능 205) → 176-210(115.7-138.1%), 확정 1타.
    16개 값: 176,180,180,182,186,188,188,192,194,194,198,200,200,204,206,210
  - Mamoswine Adamant 공격 SP32, Earthquake → Incineroar Careful, HP SP32, 방어 SP2:
    Singles 204-240(100.9-118.8%) 확정 1타. Doubles 152-180(75.2-89.1%) 확정 2타.
- 독립 손계산(9세대 대미지 공식, 계산 도구와 무관). Kingambit Hardy 공격 187, Sucker Punch 위력 70, Delphox-Mega 방어 92:
  기본 = ⌊⌊22 × 70 × 187 / 92⌋ / 50⌋ + 2 = ⌊3130 / 50⌋ + 2 = 64.
  최소 = 난수 ⌊64 × 0.85⌋ = 54 → 자속 54 × 1.5 = 81 → 악 → 에스퍼 2배 = 162.
  최대 = 64 → 96 → 192. 손계산 162-192가 calc 결과와 일치한다.
- **함정 5** 방어측이 Leftovers를 지니면 `kochance()`가 `{chance:0, n:0, text:""}`를 돌려준다(Mamoswine Ice Shard → Incineroar).
  도구가 없을 때는 `possible 9HKO`다. calc의 n타 판정은 턴 종료 회복·칩 대미지를 섞어 계산하다가 판정을 못 내는 경우가
  있다. → 이 단위의 n타 판정은 순수 대미지 기준으로 직접 정의한다(PRD F3).

### poke-sherpa 재사용 감사 (읽기 전용, `@smogon/calc` 0.11 gen9·`@pkmn/*` 0.10.11·Reg M-B)

- 옮길 것: 빌드 시점에만 추출하는 구조, 생성 데이터를 엔진에서 실제로 만들어 보는 계약 테스트, 폼 별칭
  (`Aegislash`→`Aegislash-Shield`), 코스메틱 폼 제외, 면역일 때 `desc()` 예외를 피해 `range()`를 쓰는 방식,
  기술 없음·변화기 오류 구분, `mega.ts`(메가 모드 판정), `hko.ts`(확N/난N 판정: n=ceil(100/max%),
  min% ≥ 100/n이면 확정).
- 옮기지 않을 것: gen9+EV252 고정 3단계 방어 프로필, 종족 스피드만 비교하는 `speedPredict`,
  championsbattledata 기반 스프레드 근사(성격·SP 주변분포의 곱, 표본수 sentinel 999).
- sherpa에서 발견된 함정:
  - 데이터 JSON과 엔진의 종족값이 어긋날 수 있다(Starmie-Mega 공격: sherpa가 쓰던 calc 0.11 gen9는 140, champions 100.
    calc 0.12.0은 gen9·gen0 모두 100으로 고쳐졌다. Showdown champions 모드에는 pokedex 오버라이드가 없다).
    → 종족값의 단일 진실원과 대조 테스트가 필요하다.
  - 한국어 결손 시 영문 대체값을 미리 넣어 두는데, 결손 목록을 남기지 않아 대체값과 진짜 한국어를 구별할 수 없다.
    결손: 신규 메가스톤 약 33개, 특성 2개(Eelevate, Fire Mane), 9세대 신기술 37개(2026-07 캐시 기준).
  - 메가 한국어명을 UI 정규식으로 붙여 Z 메가와 냐오닉스 성별을 처리하지 못했다.
  - sherpa의 골든값(Garchomp EQ→Tyranitar 99.4–117.7 등)은 gen9 기준이라 그대로 쓸 수 없다. gen 0에서 다시 잰다.

### 메가 한국어명 (poke-battle-quiz 규칙 + 공식 도감 대조)

- 규칙: PokeAPI form_names ko 완성형이 있으면 그것을 쓰고, 없으면 `메가` + 종 한국어명 + 반각 X/Y/Z를
  **공백 없이** 붙인다(예: 메가앱솔Z, 메가리자몽X).
- 이 규칙으로 Showdown champions의 M-C 합법 메가 82항목이 포켓몬코리아 공식 도감(pokemonkorea.co.kr/pokedex)
  표기와 82/82 일치했다. 대조표: [mega-ko-official.tsv](./mega-ko-official.tsv) (Showdown 이름 / 공식 한국어명 / 대조 결과).
- Meowstic-M-Mega와 Meowstic-F-Mega는 둘 다 공식명이 "메가냐오닉스"다. 화면에서 구분하려면 보조 라벨이 필요하다.
- poke-battle-quiz `gen-pokemon-data.mjs:500`의 `메가 ${baseKo}`(공백 있음)는 공식 표기와 다르다. 답습하지 않는다.
- M-C 신규 메가 6종의 특성 한국어명: 스카이스킨, 단단한발톱, 열교환, 예리함, 부유, 파동의방호(게임플 기사 기준).
- 게임 내 한국어 UI 표기가 공식 도감과 같은지는 아직 확인하지 않았다.

### 레귤레이션 로스터 진실원

- 공식 발표(포켓몬 보도자료)에는 M-C 전체 허용 목록이 없다. 신규 종 일부와 기간만 나온다
  (UTC 2026-09-09 02:00 ~ 2026-12-02 01:59). https://asia-press.portal-pokemon.com/press-release/pokemon-champions_20260830/
- Serebii는 M-C 신규 추가분(종 26개·폼 포함, 도구 12종)만 나열한다.
  https://www.serebii.net/pokemonchampions/rankedbattle/regulationm-c.shtml
- Showdown master `data/mods/champions`는 레귤레이션 시작 당일 반영됐다(2026-09-09 커밋 812501ed).
  M-C 합법 ID 349개 중 M-B(314개) 대비 추가 35개가 Serebii 신규 목록과 정확히 일치했고, 제거는 0개다.
- Showdown VGC Reg M-C 포맷에는 종별 밴이 없다. `tier`·`doublesTier`(Uber/DUber)는 Smogon 커뮤니티 포맷용이라
  VGC 합법성 판정에 쓰지 않는다(예: Archaludon, Sneasler, Baxcalibur는 VGC M-C에서 합법).
- 아직 쓸 수 없는 메가(Heatran, Darkrai, Zygarde, Magearna, Zeraora, Tatsugiri)가 `isNonstandard:"Future"`로 들어 있다.
  필터 없이 쓰면 섞인다.
- Showdown champions `items.ts`는 합법 도구 일부만 명시하고 나머지는 9세대 상속이다. 파일만 정적으로 파싱하면
  도구 목록이 불완전하다. 상속을 해석하면 합법 도구가 166개이고, calc gen 0 도구 166개와 완전히 같다.
- 패키지 배포 지연: `@pkmn/mods`는 M-C를 npm에 약 7주 늦게 반영했다(0.10.12, 10-28). calc npm은 M-C 9일,
  M-B 약 3개월 늦었다. → 레귤레이션 전환 시 패키지 배포만 기다릴 수 없다.
- M-D는 공식 발표가 없다. 12/2 시작은 M-C 종료일에서 나온 추정이다.
- M-C 신규 도구 12종(Serebii): Leek(대파), Rocky Helmet(울퉁불퉁멧), Air Balloon(풍선), Red Card(레드카드),
  Binding Band(조임밴드), Eject Button(탈출버튼), Normal Gem(노말주얼), Terrain Extender(그라운드코트),
  Electric Seed, Psychic Seed, Misty Seed, Grassy Seed(시드 4종).
- M-C에서 아직 쓸 수 없는 메가(Showdown `Future`): Heatran, Darkrai, Zygarde, Magearna(2폼), Zeraora, Tatsugiri(3폼).
- 대도각참(Kingambit) 특성: 오기(Defiant), 총대장(Supreme Overlord), 숨겨진 특성 프레셔(Pressure).
  Showdown champions 모드에 pokedex 오버라이드가 없어 9세대 기본 데이터를 그대로 물려받는다. calc gen 0은 Defiant 하나만 가진다(함정 4).
  "불굴의 싸움꾼"은 공식 특성명이 아니다(PRD 초안 오기 정정).
- champions learnset 원천: Showdown `data/mods/champions`에 learnsets가 있다. poke-sherpa `build-move-data.mjs`가 이미 이를 추출해 쓴다.

## ADR 근거 실측 (2026-11-04, adr-helper)

스크립트는 `/tmp/ev-maker-adr-probe/` 아래에 있다(임시 위치라 휘발될 수 있다).

### 데이터 원천 (`@pkmn/mods`·`@pkmn/dex` 0.10.13, 2026-11-03 배포)

- 로드 방법: `Dex.mod('champions', …)`. championsregmb는 `inherit: 'champions'`이므로 champions를 먼저 등록해야 한다.
  두 모드 모두 Pokedex 오버라이드가 없어 종 데이터는 9세대 base를 상속한다.
- 0.10.13의 champions·championsregmb 원본은 Showdown master 커밋 4148c118(2026-11-02)과 데이터가 같다
  (정적 텍스트 비교 기준, desc 텍스트만 다르다).
- M-C 합법 종 규칙: `isNonstandard == null` + cosmetic 폼 아님 + (battleOnly 아님 또는 forme에 "Mega" 포함).
  이 규칙이면 351종(메가 82)이다. `isMega`로 판정하면 Meowstic-M/F-Mega가 빠져 349/80이 된다.
  노트 앞부분의 "349개"는 이 정의 차이에서 나온 값이다.
- M-B → M-C diff: 종 추가 35·제거 0(재현됨). 도구 추가 18(신규 메가스톤 6 + 신규 도구 12)·제거 0. 도구는 M-C 166, M-B 148.
- 대도각참 특성: Defiant / Supreme Overlord / H:Pressure. learnset 53개, Sucker Punch 포함.
  9세대에서는 배우지만 champions에서는 못 배우는 기술: False Swipe, Fury Cutter, Leer, Metal Claw, Retaliate, Scratch, Take Down, Tera Blast.
- 기술 수치: 9세대 대비 위력·명중·타입·대상이 다른 기술 22개(Bone Rush 25→30, First Impression 90→100, Meteor Assault 150→170 등).
- calc gen0와 대조:
  - 종족값·타입 불일치 0종. 도구 166/166 일치.
  - 특성 0번 슬롯 불일치 2종: Skarmory-Mega(mods Stalwart / calc Keen Eye), Hawlucha-Mega(mods No Guard / calc Limber).
  - calc는 모든 종이 특성 1개뿐이다.
  - Aegislash 표기가 다르다: calc는 Aegislash-Shield/-Both, mods는 Aegislash.
- 크기: `@pkmn/dex`는 gzip 약 347KB, learnsets는 약 417KB → 런타임에 넣지 않고 빌드 시 추출해야 한다.
- 배포 지연은 일정하지 않다(M-C는 약 7주, 최근은 1일). Showdown 커밋을 직접 평가하는 경로는 외부 TS 코드 실행이 필요해 이번에 검증하지 못했다.

### 계산 라이브러리 감싸기 (`@smogon/calc` 0.12.0)

- `overrides.baseStats`는 gen0 실능·대미지에 반영된다. `overrides.types`는 배열을 깊은 병합하므로 단타입화할 수 없다.
  타입은 생성 후 직접 대입해야 한다.
- 데이터에 없는 특성도 지정하면 효과가 적용된다(Supreme Overlord + alliesFainted 0/1/3/5 → 최대 192/210/248/284).
  존재하지 않는 특성명은 오류 없이 무시된다.
- 연속기의 `damage`는 2차원(타수 × 16)이다. 기본 타수는 2-5회 기술이 3타, 고정 타수 기술은 data 값, Population Bomb은 10타다.
  `hits` 옵션은 가변 타수 기술에만 먹힌다. Skill Link는 Move 옵션으로 넘겨야 반영된다.
  Dragon Darts의 더블 대상 분할은 표현하지 못한다.
- 멀티스케일은 HP가 가득일 때만 반감되고, 연속기는 첫 타만 반감된다. 급소는 기본으로 꺼져 있다.
- 1타 확률을 직접 계산한 값(HP 이상 개수 ÷ 16, 연속기는 타별 분포 합성)이 kochance n=1 확률과 모든 사례에서 일치했다.
- 성능(Node 22.18, Apple M4 Pro): calculate 1회 약 0.011ms, 33칸 스윕 중앙값 0.39ms, 300세트 일괄 3.4~4.1ms.
- `getFinalSpeed`(비공개 경로)에 999 상한 버그가 있다: `gen.num <= 2` 조건에 gen0이 걸린다.
  자체 공식은 상한만 빼면 42,672개 조합에서 100% 일치했다. 상한 때문에 값이 다른 조합은 7,734개다.
  실전 예: 실능 스피드 230, 랭크 +1, 스카프, 순풍이면 230 × 1.5 × 3 = 1035인데 엔진은 999를 낸다.
- calc 엔진 API 우회 요령(ADR 결정 2의 구현 메모):
  - 종족값은 `Pokemon` 생성 옵션 `overrides.baseStats`로 넣는다. 타입은 생성 후 `types`에 직접 대입한다.
  - 기술 수치는 `Move` 생성 옵션 `overrides`(basePower·type·category·multihit·target)로 넣는다.
  - Skill Link는 `Move` 생성 옵션 `ability`로도 전달해야 5타가 된다.
- `Pokemon.getForme`는 8쌍을 잘못 해석한다: Z 스톤 3, Slowbronite→Slowbro-Galar, Raichunite X/Y, Meowsticite M/F.
  `MEGA_STONES[stone][base]` 조회는 gen0 메가 82개를 빠짐없이 정확히 덮는다.

### 엔진 기술 수치 대조와 대상 수 (ADR 리뷰 후 추가 실측, `probe4.js`·`probe5.js`)

- calc gen0의 기술 525개를 `@pkmn/mods` champions와 대조했다(위력·타입·분류·우선도·타수). 불일치는 23개다.
  - **함정 6** 11개 기술은 calc에서 타입이 undefined이고 분류가 Status다. Anchor Shot, Astral Barrage, Blood Moon,
    Bolt Beak, Dragon Hammer, Fishious Rend, Gear Grind, Hyper Drill, Metal Claw, Revelation Dance, Triple Dive가 해당한다.
    Gear Grind와 Triple Dive는 타수도 없다. 계산하면 오류 없이 대미지 [0,0]이 나온다(Kingambit Anchor Shot → Delphox-Mega).
  - 우선도 10개는 calc가 0으로 갖고 있다(Avalanche, Trick Room 등). calc의 대미지 계산에는 쓰이지 않는다.
  - Growth(변화기) 타입, Struggle 타입이 다르다.
  - 위력은 앞의 11개를 빼면 모두 일치한다(Bone Rush 30 등).
- `new Move(gen, name, {overrides: {type, category, basePower}})`로 덮어쓰면 정상 계산된다.
  Anchor Shot(Steel·Physical·90) → 57-67이고, 이는 위력 90으로 덮어쓴 Iron Head의 57-67과 같다.
- 범위기 대상 수: 더블 Field는 유지하고 `overrides.target`을 단일 대상(`normal`)으로 바꾸면 싱글과 같은 값이 나온다(EQ 204-240).
  리플렉터 같은 더블 조건은 더블 기준으로 유지된다(2732/4096 → 136-160).
- 형제 프로젝트 스택 확인: poke-sherpa `package.json`은 vite, react 19, vitest, @playwright/test, @smogon/calc, @pkmn/*를 쓴다.

### 한국어 원천 (PokeAPI CSV, 커밋 e5b79b2e15d7c50735a945936afd4cd1cfd94eae, 2026-11-02)

- ko 결손(calc gen0 집합 기준):
  - 기술 526: 결손 0
  - 도구 166: 결손 0(신규 메가스톤 포함)
  - 성격 25, 기본 종 231: 결손 0
  - 특성 215: 결손 3(Aura Guard, Eelevate, Fire Mane)
- 폼 128개 중 ko 결손 47개(신규 메가 38, 히스이 7종, Palafin-Hero, Polteageist-Antique).
  메가 82개 중 40개는 PokeAPI ko가 없고, 있는 42개는 공식 대조표와 42/42 일치한다.
- 조인 키: Showdown id = PokeAPI identifier에서 영숫자만 남긴 값. 특성·기술·성격·기본 종에서 100% 일치한다.
  예외는 폼 별칭(-F/-M → female/male, Maushold-Four, Squawkabilly 깃털, Tauros-Paldea 품종), Leek → stick,
  Roseli Berry 중복 identifier다.
- ko 폼명은 form_name 열에만 있다. 지역 폼은 "알로라의 모습"처럼 접미만 있다.
- 라이선스: BSD-3-Clause. 저작권 고지와 면책 문구를 함께 실어야 한다. 포켓몬 이름은 Nintendo 상표다.
- 포켓몬코리아 공식 사이트에는 기술·도구 DB가 없다(종 대조용으로만 쓸 수 있다). 나무위키는 CC BY-NC-SA다.

## 결정

- 2026-11-04 사용자 결정(prd-helper 인터뷰):
  - 로스터는 공식 레귤레이션 기준이다. Showdown 데이터는 수치 원천으로만 쓰고 커뮤니티 밴은 반영하지 않는다.
  - 확인 수단은 실측 대조 테스트와 개발용 확인 페이지다. 제품 UI는 다음 단위로 넘긴다.
  - 레귤레이션별 스냅샷을 보존하고 선택할 수 있게 한다.
  - 대상 포맷은 더블(VGC)을 우선한다(next-feature 인터뷰).
- 2026-11-04 사용자 결정(PRD review 피드백):
  - 트릭룸은 이 단위에서 배제한다.
  - 대미지 판정은 1타냐 아니냐만 본다. 더블에서는 2타 이상 계산(확정 2타가 난수 3타가 되는지 등)을 잘 하지 않는다.
  - 1타 확률 안의 변화는 중요한 구간이지만 확률마다 나누지는 않는다. 실전 기준은 이렇다.
    - 버텨야 할 때는 저난수 1타(12.5%~18% 정도)로라도 버틸 수 있는지를 본다.
    - 공격할 때는 고난수 1타(75% 이상)로 처리할 수 있는지를 본다.
  - 그래서 구간을 이렇게 나눈다. 경계값 75%와 18.75%(3/16)는 기본값이고 조정할 수 있다.
    - 공격: 중난수 이하(확2타~중난수1타) / 고난수 1타 / 확정 1타
    - 방어: 중난수 이상(확1타~중난수1타) / 저난수 1타 / 확정 버팀(사용자 표현 "확정 2타")

## 구현 계획 (feature-develop Phase 1, 2026-11-04)

공유 계약: `src/data/schema.ts`(스냅샷 스키마), `src/core/types.ts`(도메인 타입·오류·결과). 이 두 파일은 오케스트레이터가 고정했다.

### 파일 경계

- 데이터 파이프라인(결정 5·6·7)
  - `scripts/data/build-snapshot.mjs`: 추출기
  - `scripts/data/sources.config.json`: 원천 버전·시각·PokeAPI 커밋·파일 해시
  - `scripts/data/overrides/{game,ko}.json`: 출처를 단 보정표
  - `scripts/data/aliases.json`: 별칭표
  - 생성물
    - `src/data/regulations/index.json`
    - `src/data/regulations/<id>/{manifest,data}.json`(id: `m-c`, `m-b`)
    - `src/data/licenses.json`, `THIRD_PARTY_NOTICES.md`
    - 리포트: `data/reports/<id>/`(diff·엔진 차이·한국어 대체 목록·보정 내역)
  - 로더: `src/data/loader.ts`(지연 로드), `src/data/testing.ts`(테스트용 동기 로드)
- 계산 코어(결정 2·3·4): `src/core/*`. 공개 API는 `src/core/index.ts`에서 내보낸다.
  - 스탯·검증: `computeStats`, `statValue`, `spNoGainCells`, `validateSet`
  - 대미지: `calcDamage`, `attackBand`, `defenseBand`, `DEFAULT_THRESHOLDS`
  - 스피드: `finalSpeed`, `compareSpeed`, `minSpToOutspeed`
  - 스윕: `sweepDamage`, `sweepSpeed`
- 확인 페이지(결정 1): `src/main.tsx`, `src/dev/*`. 코어와 로더만 호출한다.
- 테스트: 코어·데이터는 `src/**/*.test.ts`(Vitest). UI 스모크·오프라인·정적 빌드·성능은 `e2e/*.spec.ts`(Playwright).

### 단계

1. 병렬로 진행한다.
   - 데이터 파이프라인을 만들고 M-C·M-B 스냅샷을 생성한다.
   - 독립 기준값을 계산 도구 없이 산술로 구해 이 노트에 먼저 기록한다. 대상: 경계 SP, 손계산, 연속기 계수.
2. 계산 코어를 실제 M-C 스냅샷과 독립 기준값으로 테스트하며 구현한다.
3. 병렬로 진행한다.
   - 확인 페이지와 e2e를 만든다.
   - PRD 수용 기준 전수 통합 테스트를 쓴다.
4. 적대적 검증(결정↔구현 정합, 경계 입력, 데이터 완전성)을 하고 수정한다.
5. 오케스트레이터가 `harness:gate`를 판정한다. 커밋은 `$make-pr`에서 한다.

## 독립 기준값

- 출처(모든 항목 공통): 독립 산술(scripts/golden/compute-independent.mjs). `@smogon/calc`를 쓰지 않는다.
  종족값·타입·기술 수치·learnset·특성 합법성은 `@pkmn/dex`·`@pkmn/mods` 0.10.13 champions에서 읽는다.
- 기계 판독본: `src/core/__golden__/independent.json`(스키마 `ev-maker/independent-golden@1`). 각 칸의 16개 값·개수·구간이 들어 있다.
  `node scripts/golden/compute-independent.mjs --check`로 바이트 재현을 확인한다(시각·비결정 요소 없음).
- 공식: 레벨 50. 실능은 위 "맥락"의 식. 대미지는
  base = ⌊⌊22 × 위력 × A / D⌋ / 50⌋ + 2 → 더블 범위기 pokeRound(× 3072/4096) → 난수 ⌊× r/100⌋(r = 85~100)
  → 자속 pokeRound(× 6144/4096) → 상성 ⌊× 배율⌋ → 최종 보정 pokeRound(× M/4096), 최소 1.
  pokeRound는 .5를 내린다. 도우미는 위력 보정(6144/4096), 멀티스케일은 최종 보정 2048(HP 가득일 때만).
- 1타 확률 = 타별 16개 난수 전수 조합 중 합계 ≥ HP인 개수 ÷ 16^타수. 구간은 기본 경계(75%, 18.75%)로 정수 비교한다.
- 공통 조건: 더블, 날씨·필드 없음, 급소 없음, 랭크·상태이상 없음, 도구 없음(메가 폼은 메가스톤), 방어측 HP 가득.

### a) 공격 SP 스윕: 대도각참 기습 → 메가마폭시

- 공격: 대도각참(Kingambit) Hardy, 오기(Defiant), 도구 없음, SP 공격 0~32·나머지 0. 실능 공격 155 + SP.
- 방어: 메가마폭시(Delphox + Delphoxite, 메가) Hardy, 부유(Levitate), SP HP 2·나머지 0. 실능 HP 152, 방어 92.
- 기술: 기습(Sucker Punch) 위력 70, 악, 물리, 단일 대상. 자속 1.5, 악 → 불꽃/에스퍼 2배.

| 공격 SP | 공격 실능 | 대미지 | HP 이상 | 공격 관점 |
|---|---|---|---|---|
| 0 | 155 | 134~158 | 4/16 | 중난수 이하 |
| 1~3 | 156~158 | 134~162 | 6/16 | 중난수 이하 |
| 4~6 | 159~161 | 138~164 | 8/16 | 중난수 이하 |
| 7~9 | 162~164 | 140~168 | 9/16 | 중난수 이하 |
| 10~12 | 165~167 | 144~170 | 11/16 (68.75%) | 중난수 이하 |
| 13~15 | 168~170 | 146~174 | 13/16 (81.25%) | 고난수 1타 |
| 16~18 | 171~173 | 150~176 | 14/16 | 고난수 1타 |
| 19~21 | 174~176 | 152~180 | 16/16 | 확정 1타 |
| 22~24 | 177~179 | 152~182 | 16/16 | 확정 1타 |
| 25~27 | 180~182 | 156~186 | 16/16 | 확정 1타 |
| 28~30 | 183~185 | 158~188 | 16/16 | 확정 1타 |
| 31~32 | 186~187 | 162~192 | 16/16 | 확정 1타 |

- 기대 경계 SP: **13**(중난수 이하 → 고난수 1타), **19**(고난수 1타 → 확정 1타).
  4→6→8→9/16처럼 같은 구간 안에서 확률만 바뀐 칸(1, 4, 7, 10, 16)은 경계가 아니다.
- SP 32 = 162, 164, 164, 168, 168, 170, 174, 174, 176, 180, 180, 182, 186, 186, 188, 192. 위 "조사 결과"의 손계산(기본 64 → 162~192)과 같다.

### b) 방어 HP SP 스윕: 한카리아스 드래곤클로 → 망나뇽

- 공격: 한카리아스(Garchomp) Adamant, 까칠한피부(Rough Skin), SP 공격 32·나머지 0. 실능 공격 200.
- 방어: 망나뇽(Dragonite) Hardy, 정신력(Inner Focus), SP HP 0~32·나머지 0. 실능 HP 166 + SP, 방어 115.
- 기술: 드래곤클로(Dragon Claw) 위력 80, 드래곤, 물리, 단일 대상. 자속 1.5, 드래곤 → 드래곤/비행 2배.
- 손계산: base = ⌊⌊22 × 80 × 200 / 115⌋ / 50⌋ + 2 = ⌊3060 / 50⌋ + 2 = 63. 최소 ⌊63 × 0.85⌋ = 53 → 79.5 → 79 → 158. 최대 63 → 94.5 → 94 → 188.
- 대미지는 모든 칸에서 같다: 158, 162, 162, 164, 168, 168, 170, 170, 174, 176, 176, 180, 182, 182, 186, 188.

| HP SP | 실능 HP | HP 이상 | 방어 관점 |
|---|---|---|---|
| 0~2 | 166~168 | 12/16 | 중난수 이상 |
| 3~4 | 169~170 | 10/16 | 중난수 이상 |
| 5~8 | 171~174 | 8/16 | 중난수 이상 |
| 9~10 | 175~176 | 7/16 | 중난수 이상 |
| 11~14 | 177~180 | 5/16 | 중난수 이상 |
| 15~16 | 181~182 | 4/16 (25%) | 중난수 이상 |
| 17~20 | 183~186 | 2/16 (12.5%) | 저난수 1타 |
| 21~22 | 187~188 | 1/16 | 저난수 1타 |
| 23~32 | 189~198 | 0/16 | 확정 버팀 |

- 기대 경계 SP: **17**(중난수 이상 → 저난수 1타), **23**(저난수 1타 → 확정 버팀).

### c) 스피드 SP 스윕: 겁쟁이 플라엣테(Eternal) vs 명랑 한카리아스

- 바꾸는 쪽: 플라엣테(Floette-Eternal) Timid, 플라워베일(Flower Veil), SP 스피드 0~32·나머지 0. 스피드 = ⌊(92 + SP + 20) × 1.1⌋.
- 고정 쪽: 한카리아스(Garchomp) Jolly, 까칠한피부, SP 전부 0. 스피드 = ⌊122 × 1.1⌋ = 134.
- 조건: 순풍·스카프·랭크·마비·트릭룸 없음.
- 스피드: SP 0~7 = 123~130, 8~9 = 132~133(후공) / SP 10 = 134(동속) / SP 11~32 = 135~158(선공). SP 32 = 158(골든값과 같다).
- 기대 경계 SP: **10**(후공 → 동속), **11**(동속 → 선공). 추월 최소 SP는 11이다(10은 동속이라 추월이 아니다).

### d) 고정 2타 연속기: 보만다 더블윙 → 고릴타

- 공격: 보만다(Salamence) Adamant, 위협(Intimidate, 등장 효과는 계산에 넣지 않음), SP 공격 32·나머지 0. 실능 공격 205.
- 방어: 고릴타(Rillaboom) Hardy, 심록(Overgrow), SP HP 2·나머지 0. 실능 HP 177, 방어 110.
- 기술: 더블윙(Dual Wingbeat) 위력 40 × 2타(고정), 비행, 물리. 자속 1.5, 비행 → 풀 2배. champions learnset에 있다.
- 손계산: base = ⌊⌊22 × 40 × 205 / 110⌋ / 50⌋ + 2 = ⌊1640 / 50⌋ + 2 = 34. 타당 84~102:
  84, 86, 86, 86, 90, 90, 90, 92, 92, 92, 96, 96, 96, 98, 98, 102.
- 16 × 16 = 256 조합 전수: 합계 168~204(94.9~115.3%), HP 177 이상 **210/256 = 82.03125%**.
  공격 관점 고난수 1타, 방어 관점 중난수 이상. 사용 타수 2.

### e) 더블 범위기 + 도우미: 맘모꾸리 지진 → 어흥염

- 공격: 맘모꾸리(Mamoswine) Adamant, 둔감(Oblivious), SP 공격 32·나머지 0. 실능 공격 200.
- 방어: 어흥염(Incineroar) Careful, 맹화(Blaze), SP HP 32·방어 2·나머지 0. 실능 HP 202, 방어 112.
- 기술: 지진(Earthquake) 위력 100, 땅, 물리, 인접 전체(범위기, 대상 2). 자속 1.5, 땅 → 불꽃/악 2배. 공격측 도우미 켬.
- 손계산: 위력 pokeRound(100 × 6144/4096) = 150. base = ⌊⌊22 × 150 × 200 / 112⌋ / 50⌋ + 2 = ⌊5892 / 50⌋ + 2 = 119.
  범위기 pokeRound(119 × 0.75 = 89.25) = 89. 최소 ⌊89 × 0.85⌋ = 75 → 112.5 → 112 → 224. 최대 89 → 133.5 → 133 → 266.
- 16개 값: 224, 228, 230, 234, 236, 240, 240, 242, 246, 248, 252, 254, 258, 260, 264, 266(110.9~131.7%). 16/16 확정 1타.
- 참고(같은 산술): 도우미 끔 더블 152~180(base 80 → 범위 60), 싱글 204~240(base 80). 위 "조사 결과"의 엔진 실측과 같다.

### f) 멀티스케일 망나뇽(HP 가득)

- 공격: 맘모꾸리 Adamant, 둔감, SP 공격 32·나머지 0. 실능 공격 200.
- 방어: 망나뇽(Dragonite) Hardy, 멀티스케일(Multiscale), SP HP 32·나머지 0. 실능 HP 198, 방어 115. HP 가득.
- 기술: 고드름떨구기(Icicle Crash) 위력 85, 얼음, 물리, 단일 대상. 자속 1.5, 얼음 → 드래곤/비행 4배.
- 손계산: base = ⌊⌊22 × 85 × 200 / 115⌋ / 50⌋ + 2 = ⌊3252 / 50⌋ + 2 = 67. 특성 없음 최소 56 → 84 → 336, 최대 67 → 100.5 → 100 → 400.
- 멀티스케일 16개 값(특성 없음 값의 pokeRound(÷2)): 168, 170, 174, 174, 176, 180, 180, 182, 186, 186, 188, 192, 192, 194, 198, 200.
  HP 198 이상 **2/16 = 12.5%** → 공격 관점 중난수 이하, 방어 관점 저난수 1타.
- 비교(정신력 망나뇽, 같은 SP): 336~400, 16/16 확정 1타.

### 다루지 않은 것

- 멀티스케일 + 연속기(첫 타만 반감) 합성 기준값은 이 절에 없다. 가변 타수 기술의 기본 타수가 엔진 규칙(ADR 결정 3)에 묶여 있어 독립 산술로 고정하지 않았다.
- 화상·날씨·필드·벽·랭크·도구 보정은 구현하지 않았다(위 6건에 필요 없음).

## 성능 측정

- 환경: Node 22.18.0, Apple M4 Pro, Vitest 4.1.12(단일 프로세스), 실제 M-C 스냅샷. 브라우저(Playwright) 측정은 확인 페이지 단계에서 따로 한다.
- 방법: `npx vitest run src/core/sweep.test.ts -t "33칸" --silent=false`. 코어 공개 API(입력 검증·메가 해석·엔진 호출·분포 합성 포함)를 그대로 호출한다.
  - 스윕: 대도각참 기습 → 메가마폭시 공격 SP 33칸 `sweepDamage`. 예열 5회 후 50회의 중앙값.
  - 일괄: 고집 맘모꾸리 지진 → 상대 300세트(비메가 합법 종 269 중 탈 전용 따라큐를 뺀 268을 순환, HP SP 32/0) `calcDamage` 300회. 10회의 중앙값.
- 결과(3회 실행): 33칸 스윕 중앙값 1.064~1.090ms(기준 50ms 이하 통과, 테스트가 단언), 1 × 300 × 1 일괄 중앙값 8.06~8.34ms.
- ADR 근거 실측(엔진 호출만, 0.39ms / 3.4~4.1ms)보다 2~3배 느리다. 칸마다 두 세트를 다시 검증·해석하는 비용으로 추정한다(구간별 분해 측정은 하지 않았다).
- 브라우저(2회 실행): Playwright Chromium headless shell 156.0.8078.4, Apple M4 Pro, `npm run build` 결과물을 `vite preview`로 정적 서빙.
  방법은 `npx playwright test --config e2e/playwright.config.ts e2e/perf.spec.ts`이고, 페이지의 개발용 훅 `window.__perf`(`src/dev/perf.ts`)가 위와 같은 입력과 같은 회수로 `performance.now()`를 잰다.
  33칸 스윕 중앙값 1.40ms(최소 1.10~1.20, 최대 1.90~2.00, n=50, 기준 50ms 이하를 테스트가 단언). 1 × 300 × 1 일괄 중앙값 11.75~11.90ms(n=10).
  Chromium은 교차 출처 격리가 없으면 `performance.now()` 해상도를 0.1ms로 낮춘다.

## 수용 기준 커버리지

- 테스트: `src/acceptance/*.test.ts`(Vitest). 테스트 이름 앞의 `AC-xx`가 아래 ID다. 독립 산술은 `src/acceptance/oracle.ts`(코어·엔진을 import하지 않음).
- 실행: `npx vitest run src/acceptance` 4파일 75개 통과(2026-11-04). 전체 `npx vitest run` 12파일 218개 통과.
- 상태: 통과 = 자동 테스트 통과, 부분 = 문구 그대로는 원천 제약으로 충족 불가(대체 검증만 통과), e2e = Playwright 확인 페이지 담당(아직 `e2e/` 없음), 문서 = 문서 확인.

| ID | 수용 기준(요지) | 테스트 파일 | 상태 |
|---|---|---|---|
| AC-S1 | 맘모꾸리 공격 200, 플라엣테 스피드 158, 맘모꾸리 HP 185/217 | stats-validation | 통과 |
| AC-S2 | 하락 성격·종족값 100 → SP0·1 모두 108, 올라가지 않는 칸 | stats-validation | 통과 |
| AC-S3 | 종족값 HP 1 → HP 1(공식 단위) | stats-validation | 통과 |
| AC-S4 | SP 33·음수·소수·합계 67 거부, 위반 능력치 표시 | stats-validation | 통과 |
| AC-V1 | M-C 구애머리띠·구애안경·돌격조끼·부스트에너지 거부 | stats-validation | 통과 |
| AC-V2 | 없는 종·기술, 대도각참 위협, 못 배우는 기술 → 이유 있는 오류 | stats-validation | 통과 |
| AC-V3 | 메가한카리아스Z·메가한카리아스·메가리자몽Y 해석 | stats-validation | 통과 |
| AC-V4 | 리자몽+한카리아스나이트, 스톤 없는 메가 → 오류 | stats-validation | 통과 |
| AC-V5 | (과제 지정) 레귤레이션 불일치 → REGULATION_MISMATCH 단독 | stats-validation | 통과 |
| AC-D1 | 대도각참 기습 → 메가마폭시 16개 값·106.5~126.3%·확정 1타/중난수 이상, 손계산 일치 | damage | 통과 |
| AC-D2 | 지진 싱글 204~240 / 더블 152~180·0%, 대상 수 1 = 싱글 | damage | 통과 |
| AC-D3 | 1타 확률 = HP 이상 개수 ÷ 16(독립 계수) | damage | 통과 |
| AC-D4 | 구간 사례표 0~100%, 경계값 변경(고난수 62.5%) | damage | 통과 |
| AC-D5 | 멀티스케일 절반 분포와 1타 확률 | damage | 통과 |
| AC-D6 | 연속기 타수가 결과에 나온다 | damage | 통과 |
| AC-D7 | 방어측 먹다남은음식도 판정이 비지 않고 도구 없음과 같다 | damage | 통과 |
| AC-D8 | 변화기·면역·대미지 결과 종류 구별, 예외 없음 | damage | 통과 |
| AC-D9 | 대전 조건 11종 배율(최소·최대 = 끈 값 × 배율 ±1) | damage | 통과(12건, 도우미·공격 랭크 +1 포함) |
| AC-D10 | 총대장 쓰러진 아군 수 반영, 0명 176~210 | damage | 통과 |
| AC-D11 | 레귤레이션·형식 생략 = M-C·더블 | damage | 통과 |
| AC-P1 | 158 → 순풍 316·스카프 237·474·+1 237·−1 105·마비 79 | speed-sweep | 통과 |
| AC-P2 | 쓱쓱·엽록소·모래헤치기·눈치우기 해당 날씨 2배, 그 외 그대로(실제 보유 종) | speed-sweep | 통과 |
| AC-P3 | 같은 스피드 = 동속 | speed-sweep | 통과 |
| AC-P4 | 우선도 기술은 순서 불변, 우선도 별도 정보 | speed-sweep | 통과 |
| AC-P5 | 추월 역산: 결과/결과−1, 동속 제외, 불가, 예산 초과 | speed-sweep | 통과 |
| AC-W1 | 스윕 3종(공격 13·19, HP 17·23, 스피드 10·11), 칸 = 단건, 경계 불변식, 확률만 바뀐 칸 제외, 동속 범주 | speed-sweep | 통과 |
| AC-W2 | 합계 40(HP 32·스피드 8) → 공격 27~32 예산 초과·경계 제외 | speed-sweep | 통과 |
| AC-W3 | 스윕 중앙값 ≤ 50ms / 측정값·환경·일괄 측정 notes 기록 | speed-sweep | 통과(Node) + 문서(위 "성능 측정"). 브라우저 측정은 e2e |
| AC-G1 | 신규 메가 6종·신규 도구 12종 포함 | data-ko | 통과 |
| AC-G2 | 미허용 메가·사용 불가 도구 4종·배틀 중/외형 폼 없음(@pkmn/dex 폼 정보로 대조) | data-ko | 통과 |
| AC-G3 | Archaludon·Sneasler·Baxcalibur 허용 | data-ko | 통과 |
| AC-G4 | 챔피언스 기술 수치(본러시 30, 대단한 첫걸음 100)가 스냅샷·계산 모두에 | data-ko | 통과 |
| AC-G5 | 엔진 데이터가 깨진 11개 기술도 스냅샷 수치로 계산 | data-ko | 부분: 11개가 `@pkmn/mods` 0.10.13 champions에서 Past라 스냅샷에 없어 계산 자체가 이유 있는 오류로 거부된다. 대신 스냅샷의 모든 공격기가 대미지 0이 아님을 확인(합성 주입 경로는 `src/core/damage.test.ts`) |
| AC-G6 | 대도각참 특성 오기·총대장·프레셔, 기습 학습, 못 배우는 기술 예 | data-ko | 통과 |
| AC-G7 | M-B → M-C diff: 종 +35/−0(Serebii 목록 일치), 메가 +6, 도구 12+스톤/−0, 수치 경고 | data-ko | 통과 |
| AC-G8 | M-B 메가한카리아스Z 거부 / M-C 계산 | data-ko | 통과(코어). 확인 페이지 쪽은 e2e |
| AC-G9 | 공통 종 id 동일, 스키마 버전 기록 | data-ko | 통과 |
| AC-G10 | 원천 기준 시각·개정 식별자, 같은 원천 재생성 = 커밋본 바이트 동일 | data-ko | 통과 |
| AC-G11 | 엔진 ↔ 스냅샷 대조 리포트 생성, 모든 합법 종 계산 가능 | data-ko | 통과 |
| AC-K1 | 메가 82항목 한국어명 = 공식 도감 대조표 | data-ko | 통과 |
| AC-K2 | 메가냐오닉스 수컷·암컷 구분 라벨 | data-ko | 통과 |
| AC-K3 | 영문 대체 목록 산출물, 종·메가·성격·신규 도구 대체 0 | data-ko | 통과 |
| AC-K4 | 대체 목록 완전성(한글 없음 ⇒ 대체 목록) | data-ko | 통과 |
| AC-K5 | 개발자 보정값이 공개 데이터보다 우선(실데이터 + 원천 충돌 합성 보정) | data-ko | 통과 |
| AC-U1 | 확인 페이지 UI 스모크 4시나리오 | — | e2e |
| AC-U2 | 확인 페이지 외부 네트워크 요청 없음 | — | e2e |
| AC-U3 | 정적 빌드 결과물에서 확인 페이지 동작 | — | e2e |
| AC-U4 | 스냅샷 생성 명령이 문서에 있고 그대로 재생성 | data-ko | 부분 통과 + 문서: `npm run gen:snapshot`이 package.json·THIRD_PARTY_NOTICES.md에 있고 재생성은 AC-G10이 확인. notes·README에는 실행 절차 문장이 아직 없다 |
| AC-U5 | 라이선스·출처 목록, 불명확 0개 | data-ko | 통과 |

- 코어 보고의 "도우미·공격 랭크 +1은 ±1 불가" 판단은 반증됐다. 비자속·등배 고정 대면(고집 한카리아스 공격 SP32 아이언헤드 → 앱솔 HP SP32)에서 11종 모두 ±1을 만족한다. 같은 공격자로 합법 종 × SP 조합을 훑으면 도우미·공격 +1을 포함한 물리 8종이 동시에 ±1인 대면이 다수 있다. PRD 기준은 고칠 필요가 없다.

## 적대적 검증 후 수정 (2026-11-04, test-engineer)

확정 결함 4건을 실패 테스트로 먼저 재현한 뒤 고쳤다. 회귀 테스트: `src/core/engine-limits.test.ts`, `src/core/speed.test.ts`.

- **스피드 의존 대미지(ADR 결정 2·4 보강 필요):** 엔진 gen 0 `calculate`는 내부 `getFinalSpeed`(999 상한)로 Electro Ball·Gyro Ball 위력과 Payback·분석(Analytic) 순서를 정한다. 위력 덮어쓰기로는 막을 수 없다(`calculateBasePowerChampions`가 다시 덮음).
  - 택한 방식: 대안 (a)의 변형이다. 이 기술·특성을 계산할 때 엔진이 쓴 스피드(`result.attacker/defender.stats.spe`)를 앱 `speedOf`와 대조하고, 다르면 `ENGINE_UNSUPPORTED`로 거부한다. 같으면 그대로 계산한다(대부분의 실전 조합).
  - 버리지 않은 대안 (b): 앱 스피드로 위력을 내 대리 기술로 넘기는 방식. 플래그·기술 고유 효과를 잃을 수 있어 이번에는 택하지 않았다. 상위 결정이 필요하다.
  - 엔진 소스의 `stats.spe`·`turnOrder` 사용 횟수를 테스트로 고정해, 엔진을 올리면 이 가정을 다시 보게 했다.
- **위력 0 공격기의 '면역' 오분류:** 생성기가 위력 0 공격기마다 엔진을 실측한다(비면역 대상 1개, 대미지 무관 특성 Pressure, 도구 Leftovers). 대미지가 0이면 매니페스트 `engineUnsupported.moves`와 `engine-diff.json`의 `zeroPowerUnimplemented`에 올린다. M-B·M-C 모두 12개: beatup, comeuppance, counter, endeavor, fissure, guillotine, horndrill, metalburst, mirrorcoat, sheercold, spitup, superfang.
  - 포함 정책이 바뀌어 M-B도 `--force`로 한 번 다시 만들었다. 커밋 전이라 동결을 깬 것은 아니다. 스키마 모양은 그대로라 schemaVersion은 1로 둔다.
  - 세트 기술 목록에 미지원 기술이 있기만 한 경우는 더 이상 세트를 거부하지 않는다. 그 기술로 계산할 때만 거부한다(ADR 결정 2 "그 항목으로 계산을 요청하면"). 그러지 않으면 카운터·분노의앞니를 든 세트는 스피드 비교도 할 수 없다.
- **HP 가득일 때 생존 효과(PRD F3):** 옹골참(틀깨기 공격자면 무시)과 기합의띠(서투름이면 무효)는 HP 가득일 때 첫 타를 HP − 1로 막는다. 단타는 1타 확률이 0이 되고, 연속기는 첫 타만 막아 합성한다. 난수 배열(`rolls`)과 최소~최대 비율은 순수 대미지 그대로다. 결과 타입(types.ts)에 "생존 효과로 막힘" 표시 칸이 없어 비율이 100%를 넘는데 확정 버팀일 수 있다.
  - 탈(Disguise)·아이스페이스(Ice Face)는 발동 전·후 상태를 입력으로 받지 않으므로, 틀깨기가 아니면 `ENGINE_UNSUPPORTED`(field `defender.ability`)로 거부한다. 지원 범위로 PRD·ADR에 반영할 필요가 있다.
- **스피드 보정 범위(PRD F4):** 스냅샷에 있는 퀵풋(상태이상 ×1.5, 마비 반감 없음), 서핑테일(일렉트릭필드 ×2), 검은철구(×0.5)를 4096 체인에 넣었다. 엔진 `getFinalSpeed`와 조합 대조를 통과했다.
  - 앱이 구현하지 않은 스피드 보정(slowstart, protosynthesis, quarkdrive, 교정깁스·파워 계열 도구, quickpowder)은 `CoreInputError`로 거부한다(현재 스냅샷에는 없음).
  - 스피드와 별개로 행동 순서를 바꾸는 보정(시간벌기 stall, 퀵드로 quickdraw, 선제공격손톱 quickclaw 등)은 `compareSpeed`·`sweepSpeed`에서 거부한다. `finalSpeed`·`minSpToOutspeed`는 스피드 수치만 다루므로 거부하지 않는다.
- **자잘한 정리:** 객체가 아닌 세트는 `CoreInputError('set')`로, 숫자도 세트도 아닌 추월 목표는 `CoreInputError('target')`로 거부한다.
  동결 스냅샷의 schemaVersion·레귤레이션 id·rules 불일치, data 검증 실패, 파일 한쪽만 있음은 생성 단계에서 `PipelineError`로 실패한다.
  메가 learnset은 원종 값에서 다시 파생하고, 메가 폼 learnset 보정은 거부한다.
  재현성 테스트는 동결 스냅샷을 먼저 두고 현재 원천분만 커밋본과 비교한다.
  LICENSE 파일 없이 표준 문안으로 채운 고지에는 "원문 아님"을 명시한다.
- **남은 위험:** 내던지기(Fling)를 도구 없이 쓰면 엔진이 0을 내 '면역'으로 나온다. 위력이 0보다 큰 조건부 기술(예: 도구가 있어야 하는 기술)도 엔진이 0을 내면 '면역'으로 분류된다. 기합의띠 외의 확률형 생존 도구(기합의머리띠 focusband)는 1타 확률에 넣지 않았다.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

-

## 검증

- 명령 또는 근거

## 후속 작업

- 후속 작업
