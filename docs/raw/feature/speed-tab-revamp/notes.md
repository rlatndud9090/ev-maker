# Notes: 스피드 탭 개편

> 사람은 중립 역할어(`사용자`/`개발자`/`검증자`)로 지칭한다 — 개인 호칭·별명은 넣지 않는다
> (운영자 설정이 그렇게 부르라 해도). 상세: `harness/templates/examples/README.md` §5.

Date: 2026-11-15 Asia/Seoul
Unit type: feature
Status: draft

## 맥락

- 상위 단위 `damage-tabs-row-revamp`(PR #4)는 스피드 탭 개편과 날씨 스피드 특성을 후속으로 미뤘다(그 PRD 비목표·R12, AC15 "스피드 탭 랭크·스카프 행은 이전과 같다"). 이 단위가 AC15의 스피드 부분을 대체한다.
- 사용자 원요청(2026-11-15): S0부터 S32+, S32+에 스카프까지 고려한 스피드 구간을 세로로 그리고, 포켓몬 배지(왼쪽 이미지, 오른쪽 배분)로 현 배분이 어디까지 추월하는지 한눈에 보기. 도구 이미지를 따로 두지 말고 포켓몬 챔피언스 박스·파티처럼 포켓몬 이미지 오른쪽 아래에 겹쳐 표시(공격·방어 탭 포함).

## 인터뷰 결정(2026-11-15)

1. 스피드 탭을 기존 메타 카드 리스트(행·상세·직접 배분 추가·핀)에서 **세로 스피드 구간 차트로 완전 대체**한다. 리스트 전환 토글은 두지 않는다. → PRD R1·R12
2. 세로축은 스피드 실수치. 상대 포켓몬 배지(왼쪽 이미지, 오른쪽 배분 표기 'S32+'·'S20 ='·'S0 −'·'S32+ 스카프')를 그 상대 실수치 높이에 둔다. **상대 배지가 화면의 주인공**이다. → R2·R3
3. 내 쪽은 S0~S32 눈금을 그리지 않고 **현재 배분 기준선 하나**만 표시한다. 기준선 아래 배지 = 추월 대상(동속은 따로 처리). → R4·R5
4. 배지 호버 시 "내가 S몇부터 추월 가능한지"를 **성격 무보정·상승 두 경우** 모두 표시한다. 축은 대략 내 S0 무보정 ~ S32+ 스카프 수준까지 고려. → R6, R2(축 범위·범위 밖 배지 미절단. 도달 범위 띠는 그리지 않음 — 2차 결정)
5. 조건이 붙은 상대(랭크업 수단·스카프·순풍·날씨/필드 스피드 특성 쓱쓱·엽록소·모래헤치기·눈치우기·서핑테일)는 같은 포켓몬이라도 **조건별 별도 배지**로 그 실수치 위치에 두고 조건 태그(+1·스카프·순풍·비 등)를 단다. 조건 배지 표시는 **필터로 켜고 끈다**. → R7·R8
6. 도구 표시를 포켓몬 이미지 **오른쪽 아래 겹침**으로 바꾸고, 스피드 차트뿐 아니라 **공격·방어 탭까지 이번 작업에서 함께** 바꾼다(이름 옆 별도 도구 아이콘 제거). → R13·R14

사용자가 고르지 않아 기본값으로 둔 것(PRD 열린 질문에 기본값과 함께 명시): 조건 배지 묶음 범위(→ 2차 결정: 1위 배분 하나에만), 필터 기본 상태(순풍만 꺼짐), 날씨 배지 자격(특성 점유율 10%), 계산 불가 상대 처리(축 밖 영역), 메가스톤 겹침(겹침), 내 포켓몬 이미지 겹침(범위 밖), 내 날씨 특성(기준선 미반영), 축 간격(ADR).
비목표로 둔 후보(사용자 미선택 → 후속): 트릭룸, 마비 조건, 곡예·고대활성·쿼크차지 지원, 선공기 우선도 표시.

## 리서치

스피드 구간 차트 선행 사례와 도구 아이콘 겹침 표시 조사(2026-11-15).

- **세로 차트 선례는 없다. 가장 가까운 것은 "실수치 정렬 목록 + 내 위치 구분선".**
  - [PokeTools Speed Tiers](https://www.poketools.com/speed-tiers): 실수치 순 행 목록, "Vs you" 열, 추월/피추월 사이 구분선. 메타 포켓몬은 최대 보정값·최다 배분, 스카프가 흔하면 스카프 줄 별도.
  - [포켓스트 素早さ早見表](https://pokest.com/guide/speed-guide): 실효 스피드가 같은 포켓몬을 한 행으로 묶어 빠른 순 나열. 최속·준속·무보정·하강 태그와 특성·스카프 태그. 검색하면 내 포켓몬이 해당 실수치 행에 끼워 넣어지고 스크롤된다.
  - [VGC Multi Calc Speed Calc](https://vgcmulticalc.com/how-to-use/speed-calc/): 느린 쪽→빠른 쪽 척도, 동속이면 "Speed Tie" 라벨, 스프라이트 아래 Min/Max/성격/점유율/Scarf 라벨. "Outspeed" 조작이 선공에 필요한 최소 SP를 제시 → PRD R6과 같은 개념.
- **같은 실수치는 묶는 것이 표준**(포켓스트). → PRD R2: 같은 실수치는 한 줄 가로 나열·라벨 1회·겹침 금지.
- **조건은 "별도 항목 + 태그"가 일반적.** PokeTools 스카프 줄, [aquadragon VGC Speed Tier Explorer](https://aquadragon.github.io/VGC-speed-tier-explorer/)(Scarf·Iron Ball·엽록소/쓱쓱/모래헤치기/눈치우기/곡예·순풍 포함 규칙, 종족값 컷오프), [Pokémon Zone Champions Speed Tiers](https://www.pokemon-zone.com/champions/speed-tiers/)(Max/Min/Scarf/+1/+2/Tailwind 열). → 인터뷰 결정 5와 일치. 과밀 방지를 위해 점유율 임계(기존 0.1) 재사용을 기본값으로 둠(열린 질문 1·3).
- **배수 적용 순서가 출처마다 다르다(미검증).**
  - [Trainer Tower VGC20 Speed Tiers](https://www.trainertower.com/vgc20-speed-tiers/): 스카프 ×1.5 뒤 내림.
  - PokeTools 설명: 날씨 ×2 → 스카프 → 순풍 → 랭크 → 마비, 단계마다 내림. 랭크를 먼저 적용하는 앱 공식과 순서가 다르다.
  - 1~2 차이로 동속·추월이 바뀔 수 있으므로 엔진은 유지하고 경계 사례 단위 테스트로 고정(PRD 비기능 "계산 일관성").
- **일본어권 스피드 조정 도구**: [yakkun](https://yakkun.com/tool/speed.htm), [damekei](https://damekei.com/speedtier), [GameWith](https://gamewith.jp/pokemon-champions/555514), [365-day-evolution](https://www.365-day-evolution.site/speed-lines/). 공통: 최속·준속·무보정·최지와 스카프 프리셋, 순풍·마비 토글. 다메케이는 순풍·스카프 토글이 랭킹 표와 조정 도구에 공통으로 걸린다. 배분 표기 'S32+ / S20 = / S0 −'는 준속·최속 개념의 SP판.
- **포챔스 도구 아이콘 우하단 겹침은 미확인.**
  - [Bulbapedia Party](https://bulbapedia.bulbagarden.net/wiki/Party) 요약: 본가 2세대 파티 화면은 아이콘 좌하단 1/4을 상자 아이콘으로 가림, 소드실드 이후 실제 도구 아이콘.
  - [雑談上手 포챔스 박스 화면 보는 법](https://zatudanjouzu.com/%E3%80%90%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3%E3%83%81%E3%83%A3%E3%83%B3%E3%83%94%E3%82%AA%E3%83%B3%E3%82%BA%E3%80%91%E3%83%9C%E3%83%83%E3%82%AF%E3%82%B9%E7%94%BB%E9%9D%A2%E3%81%AE%E8%A6%8B%E6%96%B9/): 박스 아이콘 우하단은 트라이얼 스카우트 모래시계, 좌상단 꽃 문양. 도구 위치 언급 없음.
  - [GameWith 포챔스 도구](https://gamewith.jp/pokemon-champions/553042): 도구는 팀 단위 지정.
  - 처리: 위치(우하단)는 사용자 결정값으로 고정, 크기 35~45%는 본가 1/4 관례 기반 추정(미검증, 열린 질문 9). 대비 배경·도구 없으면 미표시·도구 이름 읽기 이름 노출을 공통 요구로.
- **차트 접근성은 시각 차트와 의미 구조를 분리.**
  - [Zong 외 2022](https://arxiv.org/pdf/2205.04917): 가장 일반적 권장안은 대체 텍스트와 데이터 표.
  - [fizz.studio: Accessible charts with ARIA](https://fizz.studio/blog/accessible-charts-with-aria/): SVG·절대배치 요소에 tabindex·aria-label로 항목별 값.
  - [Telerik Charts Accessibility](https://www.telerik.com/design-system/docs/components/charts/accessibility/): 루트 graphics-document, 점마다 graphics-symbol, Esc로 루트 복귀.
  - [WAI-ARIA 1.3](https://w3c.github.io/aria/): 복합 위젯 포커스는 roving tabindex 또는 aria-activedescendant.
  - → PRD 비기능 접근성: 실수치 내림차순 목록 의미 구조, 기준선 구분 항목, 화살표 이동, 포커스·탭으로도 열리는 상세, 기준선 변화 요약 알림. 실사용 검증은 ui-verification 단계.
- 미검증·후속 확인: 포챔스 도구 아이콘 실제 위치·크기(사용자 스크린샷 필요), Pikalytics·Showdown 계열 UI 직접 확인 못 함, 배수 적용 순서.

## 코드 제약

경로는 워크트리 기준. PRD에는 이름을 넣지 않고 이곳에 근거로 남긴다.

계산 코어
1. 스피드는 앱 공식 `speedOf`로만 계산, 999 상한 없음 → 축 상한 없음(INV-261105-app-speed-no-engine, `docs/knowledge/invariants/계산-엔진.md:17-20`).
2. 순서: 랭크 → 순풍 → 특성 → 도구 → 반올림 → 마비(`src/core/speed.ts:51-68`). 조건 배지 실수치도 이 경로를 거쳐야 하고 UI가 따로 곱하면 안 된다(PRD R7).
3. 날씨·필드 ×2 특성은 쓱쓱·엽록소·모래헤치기·눈치우기·서핑테일 5개(`speed.ts:11-15`). 구름보기·에어록이 어느 쪽에든 있으면 날씨 무효(`speed.ts:22, 46-48`) → 내가 구름보기·에어록이면 날씨 배지 없음(R7). 서핑테일은 일렉트릭필드 조건.
4. 거부 목록 둘: 슬로스타트·고대활성·쿼크차지·교정깁스류는 계산 거부(`speed.ts:24-25`), 선제공격·퀵드로·균사의힘·선제공격손톱·느림보꼬리·만복향로·애터열매는 순서 비교 거부(`speed.ts:27-28, 72-79`) → R9. 곡예(Unburden)는 거부 목록에 없어 경고 없이 기본 실수치로 놓인다(비목표, 열린 질문 15). 내 세트도 같은 거부를 받는다 → R4 "내 세트 거부".
5. 날씨 조건은 양쪽 공통 입력(`c.weather`) → 날씨 배지가 내 기준선을 움직이지 않도록 기준선은 "조건 없음" 고정(R4, 열린 질문 7). 상대에게만 날씨를 거는 계산 입력은 ADR 2.

날씨 불변식
6. INV-261115-attacker-field-only(`docs/knowledge/invariants/SP-구간-표.md:22-25`)는 대미지 판정 범위(`fieldAbilities.ts:withAttackerField`, `plan.ts:damageConditions`). 스피드 탭은 이 경로 밖(`damage-tabs-row-revamp/notes.md:121`). 날씨 배지를 가정 조건 태그로 명시하고 필터로 끌 수 있게 하면 충돌하지 않는다. 기본 배지에 날씨를 섞지 않는다(스피드 탭 `conditionsFor`는 순풍만, `plan.ts:774-778`). 날씨 배지는 "파트너 날씨" 가정으로 문구화(R7).
7. 방어 탭 `speedEdge`(`plan.ts:415-417`)는 공격측 날씨 반영 별도 규칙 — 이번에 건드리지 않음(비목표). 독립 오라클 부재는 기존 후속 과제(`damage-tabs-row-revamp/notes.md:122`).

카드·래더 규칙
8. 배지 단위 = S의 (SP, 성격 +/=/−) 묶음, 점유율 ≥ `bundleShareMin`(0.05) 전부, 없으면 최대 묶음 1개 "소수 배분"(`plan.ts:204-219`, `sp-sweep-table/prd.md:160-161`) → R3. — **2차 결정으로 대체: 포켓몬마다 1위 묶음 하나(R3)**
9. 랭크 배지는 능동 수단만, 래더 수단 점유율 ≥ `rankShareMin`(0.1)(`rank.ts:30-34`, INV-261113-rank-active-means-only). 순풍은 수단 아님(rankMeans.test "순풍은 수단이 아니다"). S 없는 수단 제외, 껍질깨기 S+2는 S만 → R7.
10. 스카프: 메가 아닌 래더 종의 첫 묶음(최대 점유율)에만, `scarfShareMin`(0.1), 대표 도구가 스카프면 "스카프 아닌 최다 도구", 메가 제외(`plan.ts:683-697, 923-924`, `sp-sweep-table/prd.md:163-165`) → R7, 열린 질문 1. (빌드 중 개정 7차로 대체: 기본 배지는 늘 스카프 없는 세트, 스카프는 조건 배지)
11. 상대 도구는 스피드 탭에서 가정 세트 그대로(`sp-sweep-table/prd.md:143`; INV-261113-attack-opp-no-item은 공격 탭 한정) → 기본 배지에도 도구 겹침 가능(R3).
12. 목록 밖 타겟 프리셋 3종(S32 무보정, S32+ 명랑, S0 무보정)과 커스텀 맨 앞 정렬(`presets.ts:26`, `sp-sweep-table/prd.md:209, 275`) → R10.
13. 상위 N(기본 30)·포켓몬 선택 필터는 전 탭 공통(`Toolbar.tsx:225, 283`), 순풍 토글은 스피드 탭 전용·탭 간 유지(`Toolbar.tsx:245-261`) → R8·R11.
14. 행에 실수치 `mySpeed`·`opponentSpeed`가 이미 있음(`types.ts:404-405`, `rowTask.ts:44-45`). 최소 S는 기존 목표 문구 "선공: 최소 S20 / S12+"와 같은 규칙(`sp-sweep-table/prd.md:173, 178`), 동속은 추월 아님(`prd.md:118` "엄격히 느림") → R6·R12.

도구 겹침
15. 아이콘 자산 부족: `src/assets/item-icons` 40개(반감열매 18 + 화력 도구 22, `README.md:4`, `scripts/data/lib/images.mjs:152` `ITEM_ICON_IDS`). 구애스카프·검은철구·메가스톤·기합의띠 등 없음 → `gen:images` 범위 확장, Bulbagarden 판 고정(manifest), LICENSE/THIRD_PARTY_NOTICES 갱신, 폴백 필요(현재 폴백은 텍스트 배지 `images.ts:24-25`) → R14, ADR 5.
16. 현재 이름 옆 `ItemVariantBadge`(`CardItem.tsx:204-213, 739-746`): 접근 이름 "OO 지닌 경우", 툴팁에만 도구 이름, 점유율 미표기(사용자 결정 2026-11-14, `damage-tabs-row-revamp/prd.md:220`), 줄 높이 동일. 겹침으로 바꿔도 접근 이름·`data-item-id`·줄 높이 유지 → R13. 지금은 변형 줄에만 표시. 공격·방어 기본 줄은 도구를 지우고 메가스톤만 남김 → 열린 질문 5.
17. `PokemonIcon`은 단독 `<img>`, e2e가 `.card-who > [data-testid="mon-icon"]` 직계 자식 전제(`e2e/product-images.spec.ts:51-59, 116-119`) → 래퍼를 씌우면 셀렉터가 깨짐(ADR 4, AC23 매핑).

깨질 테스트(갱신 대상, AC23 매핑 대상)
18. 스피드 탭 상세 목록 의존: `e2e/product.spec.ts:1185`(상세 왼쪽 배분 목록), `:1666`·`:1729`(직접 추가·핀·Delete) — PR #4에서 "상세 목록이 남은 유일한 탭"이라 스피드 탭으로 옮겨 되살린 테스트(`damage-tabs-row-revamp/notes.md:72-77, 81, 83`). 스피드 탭이 없어지면 공격·방어 탭에 해당 기능이 남아 있는지 확인 후 재배치하거나 매핑(직접 추가→R15·AC26, 핀→없어진 기능). `e2e/product-layout.spec.ts:115-117`.
19. 스피드 카드 행·배지 전제: `e2e/product.spec.ts:130, 605(:627), 696(:715), 735(:740 "S\d+ 선공|동속|후공"), 879(:960), 970(:983), 1085, 1328`, `e2e/product-toolbar.spec.ts:17, 129, 207, 400`, `e2e/product-berry.spec.ts:142-185`(순풍 토글로 후공 감소), `e2e/product-images.spec.ts:45`, `e2e/offline.spec.ts:31`, `e2e/product-perf.spec.ts:184`, 단위 `src/cards/acceptance.test.ts:521-524, 939, 956`.
20. 모델(행 스윕)을 그대로 두고 표시만 바꾸면 acceptance·plan 테스트 유지 가능(ADR 2). 직접 추가 배분·핀(`addedBundles`, `plan.ts:228`)은 중 핀·배분 선택은 걷어내고 직접 추가는 R15 추가 배분으로 대체(공격·방어와 격리, ADR 2 하위 항목).

이전 PRD 결정·비목표
21. 트릭룸·턴 종료 효과·날씨/필드 일반 입력은 비목표(`sp-sweep-table/prd.md:49-51`), 랭크 변화 아닌 조건부 스피드 특성(언더버튼 등) 미지원(`:54`). 이번 날씨 배지는 "날씨 입력"이 아니라 조건 배지(PRD 비목표에 명시).
22. `damage-tabs-row-revamp`가 스피드 탭 변경·날씨 스피드 특성을 후속으로 미룸(`prd.md:59, 184, 210`), AC15(`prd.md:278`) 스피드 부분을 이 단위가 대체(R12).
23. 성능 기준선: 스피드 첫 카드 19ms, 완료 305ms, Long Task 0(`damage-tabs-row-revamp/notes.md:121`). 조건 배지로 계산량 증가 → 조건 필터 전부 켬 기준으로 재측정(PRD 비기능 성능, AC21).

## 결정

- 인터뷰 결정 1~6은 위 절 참고. 구조·배치 결정은 ADR에서 다룬다(PRD "ADR 필요 여부" 1~6).

## 리뷰 반영 (2026-11-15, testability·consistency·ux-gaps)

사용자 결정 1~6은 바꾸지 않았다. status는 draft 그대로다. BLOCKER 0. MAJOR 18건·MINOR 25건을 모두 반영했다. 반영하지 않은 지적은 없다.

testability (MAJOR 9 · MINOR 9)
- R8 필터 유지·새로고침 기본값 → AC11에 추가.
- R6 상세 내용·바깥 클릭·터치 → AC7에 내용 목록, 닫기, 배지 전환, 모바일 터치 e2e 1건을 추가.
- R7 목록 밖 타겟 조건 배지 → AC9 단위 항목 추가.
- AC7 "이전 규칙과 같다"는 판정 기준이 사라짐 → AC7b. 기존 카드를 지우기 전에 목표 문구 결과를 기대값 표(최소 6건)로 notes에 고정한다.
- 깜박임 없음 → AC25(프레임별 배치 좌표를 기록해 비교).
- R13 대비·크기·클릭 → 수치 기준(받침 대비 3:1, 너비 0.35~0.45배)으로 바꿈. AC17에 크기·클릭·대비를 추가. 열린 질문 9와 연동.
- R14 대상 집합 → 닫힌 합집합 5종으로 정의. AC19는 스냅숏 대조 검사로 판정. 대체 표지 모양은 ADR 5로.
- AC10 실데이터 의존·기대 높이 → 해당 상대가 없으면 고정 데이터로 돌린다. 기대값은 "최대 묶음 + 비 조건의 앱 공식 값". (2차 결정으로 대체: 1위 배분 묶음)
- R5 상태 구분·요약 위치 → 세 상태를 텍스트(접근 이름)로 구분. 요약 위치는 ADR 1.
- MINOR:
  - AC12 문구를 실제 발생 조합 열거로 바꿈.
  - AC18에 메가 배지, AC5에 기준선 실수치·배분 표기 추가.
  - AC20에 탭 한 자리·4.5:1·이름 항목 추가.
  - AC15에 "기본·조건 모두" 추가.
  - R12 "예전 상태값" 문장 삭제. 새로고침 보존이 비목표라 해당 상태가 없다.
  - AC19에 오프라인 포켓몬 이미지 추가.
  - R13 적용 위치를 열거함.
  - 성능 조작 정의: 슬라이더 +4/−4, 상위 단위 측정과 같은 조작.
  - 계산 근거를 "경계 사례 입력·기대값 표"로 구체화.

consistency (MAJOR 4 · MINOR 6)
- 내 세트 거부 → R4 요구 추가, AC5b(단위 1건 + e2e 1건).
- 비기능 계산 일관성과 AC12가 다름 → 둘 다 "조건 하나 + 가정 세트 도구·내 도구·내 순풍 겹침" 경계 사례로 맞춤. 비목표 "조건 2개 배지"와 다르다고 명시.
- 도달 범위 띠와 사용자 결정 3 충돌 소지 → 확정 요구에서 내림. 축 범위 보장만 요구로 둔다(R2·AC3). 띠는 열린 질문 10(기본값 없음, ADR 1 시안 비교와 사용자 확인). (2차 결정으로 대체: 띠 없음)
- 날씨 입력 → `withEffectiveWeather`가 양쪽 세트를 보는 문제. R7에 두 가지를 요구로 둠: 무효 판정은 내 특성으로만 한다, 날씨 배지의 상대 세트는 그 날씨 특성이라 상대 쪽 무효가 생기지 않는다. 계산 입력은 ADR 2에 명시.
  - 열린 질문으로 올리지 않은 이유: 날씨 배지 세트는 특성을 날씨 특성으로 두므로, 상대에게 날씨 무효 특성이 동시에 있을 수 없다.
- MINOR:
  - R7 랭크업 "상위 규칙과 다른 점"을 분리(R12·AC9 연동).
  - 곡예 비목표 문구 정정.
  - 무딘손 → R13 "효과가 무효화된 도구도 겹침 + 상세 안내", AC12.
  - AC8에 내 순풍 + 상대 순풍 배지 사례 추가.
  - ADR 6을 ADR 2 하위 항목으로 내림. 기존 ADR 7은 6으로 번호를 당김.

ux-gaps (MAJOR 5 · MINOR 10)
- 화면 높이·스크롤 → R2 요구 추가: 처음 열면 기준선이 보임, 기준선으로 돌아갈 수 있음, 요약이 늘 보임. AC24. 세부는 ADR 1.
- 내 쪽 계산 불가 → consistency와 같은 R4·AC5b.
- 내 랭크업 → 열린 질문 11(기본값: 비목표). 비목표에도 추가. (2차 결정으로 확정: 제외)
- 같은 줄 키보드 이동 → 좌우 화살표, Home/End, 기준선 항목 포커스 제외, 같은 줄 순서 규칙(R2). 비기능 접근성·AC20.
- 이웃 줄 겹침 → R2 최소 줄 간격. AC2는 1 차이 줄과 라벨까지 교차 검사.
- MINOR:
  - 동속 줄과 기준선 배치(R5).
  - 요약 단위(열린 질문 12).
  - 띠의 순풍 입력(열린 질문 10에 명시). (2차 결정으로 대체: 띠 없음)
  - 모바일 탭 전환·호버 지연(R6). 상세 형태는 ADR 1.
  - 모바일 도구 이름: 스피드는 R6 상세에 넣음, 공격·방어는 열린 질문 13.
  - 직접 추가 대체 경로(R12, 열린 질문 14, 비목표). (2차 결정으로 대체: R15)
  - 빈 상태와 목록 밖 타겟의 필터 무관(R11). 현행 `plan.ts:781-797` `opponentsOf`가 목록 밖 타겟을 상위 N·선택과 따로 모은다.
  - 곡예 안내(열린 질문 15).
  - R13 적용 위치 열거, 메가스톤 아이콘 정책(R14 5번 → ADR 5).
  - 탭별 도구 표시 차이를 R13 원칙 문장으로 명시.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

- INV 후보: 스피드 차트의 모든 실수치(배지·기준선·최소 S)는 앱 스피드 공식으로만 낸다 — 화면에서 배수를 곱하지 않는다.
- INV 후보: 스피드 날씨 배지는 상대에게만 거는 "파트너 날씨 가정"이며 기준선과 기본 배지에는 날씨를 섞지 않는다.
- G 후보: 포켓몬 이미지에 래퍼를 씌우면 이미지 직계 자식을 전제한 e2e 셀렉터가 깨진다.

## 검증

> 2026-11-16 T12 기록. 값은 모두 테스트에 고정된 값이나 이번에 직접 잰 측정값이다. 출처 테스트를 행마다 적는다.

### AC7b 기존 목표 문구 고정표 (10건)

- 고정 데이터: `src/cards/__fixtures__/speedMinSpLegacy.ts`(기존 경로 `planTab(input, 'speed')` → `computeRowTask` → `assembleTab` → `targetText` 결과를 기존 스피드 카드를 지우기 전에 고정). 앱 코드는 이 파일을 import하지 않는다.
- 새 결과 출처: `src/cards/speedLadder.test.ts` "기존 결과 고정표" 두 테스트(`minSpToPass`, 추월 목표 사례는 코어 `minSpToOutspeed`와도 같은지 확인).
- 내 세트는 모두 한카리아스(m-c). "잔여"는 규칙 합계 66 − 내 SP 합으로, 10건 모두 0이다. 새 결과의 `over-budget`는 `remaining` = 현재 S SP + 잔여.
- 표기: 무보정 / 상승. "S n"은 ok, "S n 초과(잔여 r)"은 over-budget, "불가"는 impossible.

| id | 입력 요약 | 기존 문구 (목표) | 분류 | 새 결과 (엄격 추월 최소 S) |
|---|---|---|---|---|
| both-impossible | 내 S32 무보정 생명의구슬 vs 포푸니크 고집 S32 흰색허브 | 없음(전 칸 후공, 변화 없음) | 추월 목표 비교 대상 | 불가 / 불가 |
| neutral-impossible | 내 S32 무보정 vs 메가 플라엣테(영원의꽃) 조심 S32 | "선공: 무보정 불가 / S19+" (better) | 추월 목표 비교 대상 | 불가 / S19 |
| tie-boundary-outspeed | 내 S14 무보정 vs 타부자고 조심 S32 | "선공: 최소 S15 (다른 능력치에서 1 필요) / S3+" (better) | 추월 목표 비교 대상 | S15 초과(잔여 14) / S3 |
| tie-boundary-tie-goal | 내 S16 무보정 vs 타부자고 겁쟁이 S32 | "동속: 최소 S27 (다른 능력치에서 11 필요) / S14+" (better, 동속 목표) | 규칙 변경으로 결과 다름 | S28 초과(잔여 16) / S15 |
| my-tailwind | 내 S6 용감 + 내 순풍 vs 한카리아스 명랑 S32 스카프 | "선공: 최소 S5 / S0+" (better) | 추월 목표 비교 대상 | S5 / S0 |
| my-scarf | 내 S14 용감 스카프 vs 메가 라이츄Y 겁쟁이 S32 | "선공: 최소 S12 / S0+" (better) | 추월 목표 비교 대상 | S12 / S0 |
| opponent-scarf-tie-goal | 내 S10 용감 스카프 vs 대쓰여너 고집 S32 스카프(스카프 행) | "동속: 최소 S8 / S0+" (better, 무보정 동속 목표) | 규칙 변경으로 결과 다름 | S9 / S0 |
| over-budget | 내 S0 무보정 스카프(H32·A32·B2) vs 메가 한카리아스Z 조심 S32 | "선공: 최소 S14 (다른 능력치에서 14 필요) / S2+ (다른 능력치에서 2 필요)" (better) | 추월 목표 비교 대상 | S14 초과(잔여 0) / S2 초과(잔여 0) |
| keep-first | 내 S32 무보정 vs 대쓰여너 고집 S32 기합의띠 | "선공: 최소 S9 / S0+" (keep, 현재 유지) | 규칙 변경으로 결과 다름 | S9 / S0 |
| opponent-scarf-keep | 내 S10 무보정 스카프 vs 대쓰여너 고집 S32 스카프(스카프 행) | "선공: 최소 S9 / S0+" (keep, 현재 유지) | 규칙 변경으로 결과 다름 | S9 / S0 |

- 추월 목표 비교 대상 6건은 기존 값과 같다. 기존 "다른 능력치에서 n 필요"는 새 결과에서 `sp − remaining = n`으로 같은지 함께 본다(tie-boundary-outspeed 15 − 14 = 1, over-budget 14 − 0 = 14, 2 − 0 = 2).
- 규칙 변경 4건: 동속 목표 2건은 엄격 추월이라 1씩 오른다(S27 → S28, S14+ → S15, S8 → S9). 현재 유지 2건은 숫자가 같지만 목표 뜻이 "현재 유지"에서 "추월"로 바뀌어 비교에서 뺀다(ADR 결정 2).
- AC7b (a)(b)(c)도 같은 파일에서 고정한다: "(a) 그 SP에서 엄격히 앞서고 SP−1에서는 아니다, (b) 동속은 추월이 아니다", "(c) 0~32에서 닿지 않으면 불가".

### AC12 조건 배지 경계 실수치

- 출처: `src/cards/speedChart.test.ts` describe "경계 실수치(AC12)"(배지), `src/cards/speedLadder.test.ts` "기준선" 첫 테스트(내 기준선). 배지 값은 매번 `finalSpeed` 호출 결과와도 같은지 함께 본다(화면이 배수를 곱하지 않음).
- 실데이터는 m-c 스냅숏·Bo1 메타(`realData()`). 합성 항목은 `speciesEntry` + `syntheticView`로 만든다.

| 경계 | 입력 | 기대값 | 계산 |
|---|---|---|---|
| 스카프×순풍(상대 배지) | 실데이터 한카리아스 가정 세트(스카프 지님)의 순풍 배지 | 462 | 154 × 1.5 × 2 |
| 스카프×순풍(내 기준선) | 내 한카리아스 무보정 S32: 도구 없음 / 스카프 / 스카프 + 내 순풍 | 154 / 231 / 462 | 154 × 1.5 = 231, × 2 = 462. 날씨·필드는 넣지 않고, 내 S 랭크(+2)도 기준선에 넣지 않는다(154) |
| +1×스카프 | 합성 한카리아스 고집 S32 스카프, 용의춤 20% → 랭크업 배지 | 346 | floor(154 × 1.5) = 231, × 1.5 = 346.5 → 내림 346 |
| 날씨×스카프 | 합성 대쓰여너 고집 S32 스카프, 특성 적응력 80%·쓱쓱 20% → 비 배지 | 390 | 130 × 2 × 1.5 (`finalSpeed(set, { weather: 'Rain' })`와 같음) |
| 홀수 반올림 | 실데이터 펠리퍼 스카프 조건 배지 | 127 | 85 × 1.5 = 127.5 → 127 |
| 무딘손 | 합성 이어롭 무딘손 명랑 S32: (1) 대표 도구 스카프(60%)·먹다남은음식 40% (2) 대표 도구 먹다남은음식 60%·스카프 40% | (1) 기본 배지 172, 도구 표시 `negated`, "스카프 아닌 최다 도구" 배지 없음 (2) 스카프 배지 없음 | 도구 효과가 없어 스카프 배수 미적용 |

### AC21 성능 (2026-11-16)

- 조건: `e2e/product-perf.spec.ts` 단독 실행(`--project=desktop`), 프로덕션 빌드 + vite preview, Chromium 156.0.8078.4, 상위 30, 시나리오마다 10회 중앙값. 스피드 차트 슬라이더 놓기는 조건 필터 전부 켬.
- 예산: 첫 표시 중앙값 ≤ 500ms, 완료 중앙값 ≤ 3000ms, 계산 구간 Long Task ≤ 100ms.

| 시나리오 | 첫 표시(첫 카드) 중앙값 | 완료 중앙값 | Long Task 최대 | 이전 측정(main 이력) |
|---|---|---|---|---|
| 스피드 차트 처음 열기(조건 필터 기본값, 배지 37개) | 11ms | 13ms | 0ms | 카드 리스트 18~20ms · 300~465ms |
| 스피드 차트 다시 열기(조건 필터 전부 켬, 배지 67개) | 8ms | 9ms | 0ms | — |
| 스피드 차트 S 슬라이더 놓기(전부 켬, SP 32→28) | 1ms | 11ms | 0ms | 카드 27ms · 146ms |
| 공격 탭 처음 열기 | 80ms | 950ms | 0ms | 76ms · 619ms, 77 · 777ms |
| 공격 탭 슬라이더 놓기(SP 32→28) | 25ms | 305ms | 0ms | 25ms · 230ms |
| 방어 탭 처음 열기 | 35ms (2회 35·35) | 1652ms (2회 1627·1652) | 0ms | 17 · 561ms, 35 · 1103ms, 35 · 1117ms |
| 방어 탭 슬라이더 놓기(SP 2→0) | 36ms (2회 33·36) | 588ms (2회 584·588) | 0ms | 25ms · 251ms |
| 보조: 공격 탭 계산 중 클릭 입력 지연 | 중앙값 9ms, 최대 11ms | — | — | 9ms · 14ms |
| 보조: 공격 탭 계산 중 rAF 간격 | 회차 중앙값 17ms | — | — | 17ms |

- 스피드 탭은 첫 기준(첫 카드 19ms·완료 305ms)보다 빨라졌다. 계산 구간 Long Task는 전 시나리오 0ms이고 계측 자체 확인(120ms setTimeout 작업이 Long Task로 잡힘)도 통과했다.
- 공격·방어 탭 Long Task 예산 초과는 재현되지 않았다. 첫 표시·완료 중앙값도 예산 안이다.
- 첫 전체 실행에서 공격 탭 시나리오가 한 번 실패했다: 슬라이더를 놓은 뒤 5초 안에 `data-generation`이 바뀌지 않았다(`product-perf.spec.ts:184`, 예산 단언 전 단계라 측정값 없음). 같은 시나리오만 다시 돌리니 통과했다(위 공격 탭 값). 드래그 입력이 부하 때 반영되지 않는 계측 쪽 불안정으로 보며, 코드 결함으로 확인하지는 않았다.
- 완료 시간 악화(예산 안): 공격 처음 열기 619 → 950ms, 방어 처음 열기 561 → 1652ms(main 이력 마지막 값 1117ms보다도 느림), 방어 슬라이더 놓기 251 → 588ms, 공격 슬라이더 놓기 230 → 305ms. 첫 카드 시간은 거의 같다.
  - main과의 비교 근거: 같은 날 main 빌드를 재지 않았다(작업 지시로 stash·`git worktree add` 금지). 비교값은 `docs/raw/feature/damage-tabs-row-revamp/notes.md`의 측정 이력(2026-11-14, 같은 Chromium 156, 같은 spec)이다. 그 이력 안에서도 방어 완료가 561 → 1103 → 1117ms로 R14~R16 추가 때마다 늘었다.
  - 원인 추정(확인 안 함): (1) 측정 기계 부하 차이. 이전 측정과 같은 조건이라 보장할 수 없다. (2) 공격·방어 행마다 도구 겹침 이미지 상자(`MonWithItem`)가 생겨 도구 아이콘 이미지 요청·디코드가 늘었다. 첫 카드 시간이 그대로이고 완료(전 카드 표시)만 늘어난 모양이 렌더 쪽 비용과 맞는다. (3) 계산은 줄었을 것이다: 실행기가 스피드 탭을 계산하지 않는다(`executor.test.ts` "스피드 탭은 계산하지 않는다"). 분리 확인은 main 빌드 같은 기계 재측정이 필요하다(후속).

### AC23 바꾸거나 지운 기존 테스트 매핑

- 확인 방법: `git diff origin/main --stat`, `git diff origin/main -- e2e 'src/**/*.test.ts' 'src/**/*.test.tsx'`. 새로 만든 테스트 파일(`e2e/speed-chart.spec.ts`(미추적), `e2e/speed-chart-a11y.spec.ts`, `src/cards/speedChart.test.ts`, `src/cards/speedLadder.test.ts`, `src/cards/iconTargets.test.ts`, `src/app/components/MonWithItem.test.tsx`, `src/app/components/RowDetail.test.tsx`)은 신규라 표에서 뺀다. diff에 없는 기존 spec(`product-myset`·`offline`·`product-power-item` 등)은 바뀌지 않았다.
- "구조 변경"은 기능은 같고 셀렉터·타입·탭 목록만 바뀐 것이다.

| 파일 | 바꾸거나 지운 테스트 | 대체 요구 / 없어진 기능 | 대체 테스트 |
|---|---|---|---|
| e2e/product-berry.spec.ts | 통계 설정 줄 "다섯 칸" → "여섯 칸" | R7 날씨/필드(툴바 "날씨 특성 최소(%)" 추가) | 같은 테스트(제목·기대 칸 수 갱신) |
| e2e/product-berry.spec.ts | 삭제: "순풍 토글(스피드 탭 전용)" describe | 없어진 기능: 툴바 내 순풍/상대 순풍 토글. 내 순풍 → R11(차트 머리), 상대 순풍 → R8(순풍 조건 필터) | speed-chart.spec AC8, AC11 |
| e2e/product-layout.spec.ts | 삭제: "스피드 탭 배분 메뉴·상세 배분 목록이 화면 안 …" | 없어진 기능: 스피드 카드 배분 메뉴·상세(R12). 좁은 폭 배치는 R2 | speed-chart.spec AC2(400px·1280px), AC24 |
| e2e/product-toolbar.spec.ts | "최소 사용률 3종 인라인 반영" → 카드 기준 2종은 세대 +1, 스피드 차트 전용 2종(구애스카프·날씨 특성)은 세대 그대로 | R7(스카프 기준은 스피드 차트만 씀, 날씨 특성 기준 신설) | 같은 테스트(재작성), state.test "스피드 차트 상태" |
| e2e/product-toolbar.spec.ts | 구애스카프 기본 표시값 10 → 5, 날씨 특성 10 | R7 구애스카프 기준 기본값 10% → 5% | 같은 테스트, speed-chart.spec AC11(새로고침 기본값 5) |
| e2e/product-toolbar.spec.ts | 2행 순서에서 순풍 토글 제거, 결과 배지 단계에서 선공·동속·후공 제거 | R11(순풍은 차트 머리), R12 결과 배지 → R5 상태 | speed-chart.spec AC5, AC8 |
| e2e/product.spec.ts | 삭제: 스피드 탭 펼친 상세(왼쪽 배분 목록·결과 배지) | 없어진 기능: 스피드 카드 상세(R12) → R6 배지 상세 | speed-chart.spec AC7 |
| e2e/product.spec.ts | 삭제: 스피드 탭 상세 직접 추가 폼 → "고정됨", Delete·핀 삭제 | 직접 추가 → R15. 핀 = 없어진 기능(R12) | speed-chart.spec AC26 |
| e2e/product.spec.ts | 삭제: 핀 Tab 순서·Enter 고정·Delete 해제 | 없어진 기능: 핀(R12). 키보드 조작은 R6 배지 포커스로 | speed-chart-a11y.spec |
| e2e/product-images.spec.ts | 스피드 탭을 목록 행 아이콘 루프에서 뺌, `.card-who > [data-testid="mon-icon"]` 직계 → 자손 셀렉터 | R1(스피드 카드 없음) + 구조 변경(R13 이미지 상자) | 같은 테스트, speed-chart.spec AC3(배지 이미지) |
| e2e/product-perf.spec.ts | 스피드 탭 카드 측정 → 스피드 차트 측정(표식 `speed-chart:first`·`complete`) | R1, 비기능 성능 | 같은 파일 "반응성 스피드 차트" |
| src/app/components/text.test.ts | "스피드 탭(refs 없음)·랭크 아닌 근거" → "refs 없음: S 랭크만 남긴다"·"근거 없음"으로 나눔, scarf 근거 사례 삭제 | R7(스카프 행 근거 `ScarfBasis` 삭제, 스카프는 조건 배지) | 같은 파일 두 테스트, speedChart.test AC9 스카프 |
| src/app/executor.test.ts | "최종 뷰는 탭마다 buildTabView와 같다" → 공격·방어만, 스피드는 idle | R1(스피드 탭은 실행기 밖 동기 배지 모델, ADR 결정 2) | 같은 파일 "스피드 탭은 계산하지 않는다" 3건 |
| src/app/state.test.ts | "표시 기준 변경은 세대를 올린다" → 공격·방어 기준만 | R7(스카프·날씨 기준은 차트 전용, 세대 그대로) | 같은 파일 "스피드 차트 상태" |
| src/app/state.test.ts | "순풍·세트 초안 변경" → "세트 초안 변경" | R11(내 순풍은 스피드 차트 상태) | "조건 필터·내 순풍은 세대 그대로" |
| src/cards/__fixtures__/acceptance.test.ts | 삭제: 스피드 탭 대쓰여너 최대 S 묶음 경계, "F4 스피드 탭" 4건(스카프 ≥ 10%, < 10%, 대표 도구 스카프, 내·상대 순풍) | R3(1위 묶음 기본 배지), R7(스카프 기준 5%·스카프 아닌 최다 도구), R8·R11(순풍) | speedChart.test 기본 배지·AC9 스카프·순풍, speedLadder.test 기준선 |
| src/cards/acceptance.test.ts | AC1 "세 탭" → 공격·방어 탭, 스피드 기본 행 경계 제거 | R1, R3·R4 | speedChart.test 기본 배지, speedLadder.test 최소 S |
| src/cards/acceptance.test.ts | 삭제: "AC7 스피드 탭 스카프·순풍(F4)" 4건 | R7 스카프·순풍 조건 배지, R11 내 순풍 | speedChart.test AC9·AC12 |
| src/cards/acceptance.test.ts | 삭제: 스피드 탭 일렉트릭네트(상대 하락기)는 랭크 행 아님 | R7 랭크업(능동 수단만, ADR 결정 3) | speedChart.test "랭크업: … S 없는 수단·순풍 제외" |
| src/cards/acceptance.test.ts | "내 세트 오류: 퀵드로는 스피드 탭만" → "퀵드로는 공격·방어 탭에서 정상" | R4·R9(스피드 전용 거부는 차트 머리 안내) | executor.test my-set-error 부재, speedLadder.test AC5b, speed-chart.spec AC5b |
| src/cards/acceptance.test.ts | AC15 "표시 기준 3개" → "묶음 표시 기준", 랭크 기준 스피드 랭크 행·스카프 기준 대쓰여너/타부자고 사례 삭제 | R12(상위 AC15 스피드 부분 대체) → R7 | speedChart.test 랭크업 10% 경계, 스카프 5.0%/4.9% 경계 |
| src/cards/batch.test.ts | `TABS` → `DAMAGE_TABS`, 삭제: "스피드 판정은 기준을 읽지 않아 키가 같고 전부 캐시 적중" | R1. 없어진 기능: 스피드 행 캐시 | 같은 파일(공격·방어) |
| src/cards/berries.test.ts | "스피드 탭은 대표 도구 그대로, 방어 탭 도구 없음" → 방어 탭만 | R3(스피드 기본 배지는 가정 세트 도구 그대로), R13 | speedChart.test "기본 배지는 가정 세트 도구를 그대로" |
| src/cards/items.test.ts | 삭제: "후보 없는 카드(스피드 탭)는 메뉴 작업이 없다", 타입 `Tab` → `DamageTab` | 없어진 기능: 스피드 카드·배분 메뉴(R12) | 없음(기능 삭제) |
| src/cards/plan.test.ts | "선제공격손톱은 스피드 탭만 my-set-error" → "공격·방어 탭은 ok" | R4·R9 | executor.test, speedLadder.test AC5b |
| src/cards/plan.test.ts | 조건 순풍 3건 → 공격·방어 순풍 없음 2건(스피드 attacker/defender 순풍 사례 삭제) | R11 내 순풍, R8 상대 순풍 배지 | speedLadder.test 기준선 순풍·"내 순풍을 켠 채 상대 순풍 배지의 최소 S", speedChart.test 순풍 |
| src/cards/plan.test.ts | 삭제: "planTab: 스피드 탭" describe 9건(기본 행, 스카프 아닌 최다 도구, 스카프 기준, 도구 없음, 랭크 행, 비교 불가, 커스텀, 랭크 기준 경계) | R3, R7, R9, R10. 묶음 기준 이상 전부 카드 → R3(1위 묶음 하나) | speedChart.test 기본 배지·AC9·AC13·목록 밖 타겟 |
| src/cards/plan.test.ts | "메가리자몽Y면 쾌청, 스피드 탭은 날씨 없음" → 공격 탭만 | R4(기준선에 날씨 미포함) | speedLadder.test "날씨·필드는 넣지 않는다" |
| src/cards/rank.test.ts | 스피드 탭 랭크 주체 "양쪽" → "상대만", 랭크 기준 경계 제목 정리 | R7 랭크업(ADR 결정 3 `TAB_MEANS_OWNERS.speed`), 내 랭크업 토글은 후속 | 같은 파일 |
| src/cards/relevance.test.ts | 삭제: 스피드 판정 양쪽 S, 스피드 행 S 외 의존 없음. `relevantStats`·`myDependsOn`에서 `judge` 인자 제거 | 없어진 기능: 스피드 행 계산 경로(R1) | 같은 파일(대미지만) |
| src/cards/resultSort.test.ts | `TABS` → `DAMAGE_TABS` | R1(구조 변경) | 같은 파일 |
| src/cards/rowTask.test.ts | 삭제: speed 양 끝·스윕, 스피드 키 spe만 | 없어진 기능: 스피드 rowTask(R1). 코어 스피드 함수는 core/speed.test 유지 | speedChart.test·speedLadder.test(코어 값 대조) |
| src/ui/images.test.ts | "도구 아이콘 대상 = 18 + 22종" → "포함", 폴백 "텍스트 배지" → "가방 표지" | R14(대상 집합 확대, 공통 가방 표지) | 같은 파일 "R14 아이콘 대상 집합 대조(AC19)" 4건 |
| src/core/speed.test.ts | 추가만(거부 원인·날씨 특성 표) | — | — |

- 매핑 밖 기존 테스트는 바뀌지 않았다. 이번 T12에서는 `product-perf.spec.ts`만 다시 돌렸다. 단위·e2e 전체와 harness gate 통과는 이 기록에서 확인하지 않았으므로 최종 gate에서 본다.

## 후속 작업

- 트릭룸, 마비 조건, 곡예·고대활성·쿼크차지 지원, 선공기 우선도 표시.
- 스피드 배수 적용 순서의 외부 근거 확인(현재 앱 공식 유지, 경계 사례 테스트만).
- 방어 탭 `speedEdge` 독립 오라클(기존 후속 과제).
- **(다음 피처 후보) 공·방 사다리 뷰**: 공격·방어 탭도 스피드 탭처럼 내 SP를 축으로 상대를 사다리로 늘어놓는 보기.
- **(다음 피처 후보) 컷 고정**: 특정 컷(예: 어떤 상대 추월·확정수)을 고정한 뒤 남은 SP 예산으로 나머지를 다시 계산하는 기능.
- **(다음 피처 후보) 포켓몬 추가 UX**: '포켓몬 추가'에서 이미 목록에 있는 포켓몬도 새 배분으로 추가할 수 있게 하고(예: 몰드류 새 배분을 배지를 찾아가지 않고 추가), 같은 포켓몬+배분이 이미 있으면 '이미 존재합니다'로 막는다(사용자 제안 2026-11-17).

## 인터뷰 결정 2차 (2026-11-15, PRD review 중)

- 기본 배지: 포켓몬마다 **사용률 1위 S 배분 묶음 하나만**(사용자: "기본적으로 모든 포켓몬이 사용률 1위 배분 1개만 보여주게 할거임"). 상위 단위의 5% 이상 묶음 전부 카드 규칙을 스피드 탭에서 대체(R3, AC4).
- 스카프 배지: "스카프 채용률이 유의미한 경우에만". 기준은 툴바 통계 설정의 기존 "구애스카프" 기준을 쓰고 **기본값 10% → 5%**(사용자: "스카프 기준이 이미 툴바에 있었지 참. 그걸로 하고 기본값을 5%로 하자"). 이 값은 `speedCard` 스카프 판단에서만 쓰여 공격·방어 탭엔 영향 없음(코드 확인: 기준 사용처 1곳).
  - 근거 데이터(m-c 2026-10 스냅숏, 구애스카프 점유율): 펠리퍼 Bo1 5.5%(사용률 14위) / Bo3 0%. 5~10% 구간: 왕구리 9.3%, 알로라나인테일 6.6%(Bo1). 주류: 한카리아스 52%(Bo1)·60%(Bo3), 대쓰여너 15%(Bo1)·39%(Bo3).
- 랭크업·순풍·날씨/필드 조건 배지는 유지(1위 배분 배지에만 붙음).
- 내 랭크업 토글: 이번 단위에서 제외(후속).
- 배분 추가: 목록 밖 타겟 우회가 아니라 **차트에 배분 추가 조작**을 둔다(R15, AC26).
- 내 도달 범위 띠: 그리지 않음.

## 구현 계획 (feature-develop Phase 1)

> 입력: PRD(pre-approved) R1~R15·비기능·AC1~AC26(AC5b·AC7b 포함), ADR(pre-accepted) 결정 1~6, `./design-options.html` 대안 C, 위 "코드 제약". 코드 조사 2026-11-15.
> 파일·함수·타입 이름은 제안이다. 바꾸면 이 절을 같이 고친다. 층 경계는 ADR 결정 6을 따른다: 데이터 계약(core·cards 타입) → 응용 로직(cards 순수 함수·app 리듀서) → UI 렌더링(app/components).

### 1. 코드 지도

계산 코어 `src/core`
- `speed.ts` (변경): 거부 종류·원인을 돌려주는 `speedSupport`를 더하고, `checkSpeedSupport`는 그 결과를 던지는 얇은 래퍼로 둔다. 날씨·필드 ×2 특성 표를 술어 Record에서 데이터 표 `SPEED_FIELD_ABILITIES`로 바꾸고 판정 술어는 표에서 만든다. `ITEM_NEGATING_ABILITIES`를 공개한다. 공식·체인 순서는 그대로다(INV-261105).
- `types.ts` (변경): `SpeedRejection`, `SpeedFieldCondition` 타입.
- `index.ts` (변경): 위 심볼 export.

카드 모델 `src/cards`
- `speedChart.ts` (신규): 배지 모델 생성. 기본 배지(1위 묶음), 조건 배지(랭크업·스카프/스카프 아닌 최다 도구·순풍·날씨/필드), 추가 배지(R15), 목록 밖 타겟 배지, 순서 비교 불가 목록, 상대별 묶음 목록을 낸다. `plan.ts`에서 옮겨 온 스카프 규칙 `scarfConditionOf`가 여기 있다(ADR 결정 3). (빌드 중 개정 7차로 대체: 기본 배지는 늘 스카프 없는 세트, 스카프는 조건 배지)
- `speedLadder.ts` (신규): 기준선·상태·요약, 조건 필터 적용, 같은 줄 순서, 사다리 줄 구성, 최소 S, 키보드 탐색, 추가·삭제 뒤 포커스, 배분 표기 문자열. 전부 화면 없는 순수 함수다.
- `iconTargets.ts` (신규): R14 아이콘 대상 집합 계산(ADR 결정 5).
- `types.ts` (변경)
  - 추가: `DisplayCriteria.weatherShareMin`(기본 0.1), `SpeedConditionKind`·`SpeedConditionFilters`·`DEFAULT_SPEED_FILTERS`·`SpeedAddedBundle`, `DamageTab`·`DAMAGE_TABS`.
  - 변경: `scarfShareMin` 기본값 0.05.
  - 삭제: `CardConditions`·`CardInput.conditions`, `RowKind`의 `scarf`·`non-scarf`, `ScarfBasis`. (빌드 중 개정 7차로 대체: 기본 배지는 늘 스카프 없는 세트, 스카프는 조건 배지)
- `spTrim.ts` (신규): `plan.ts:738`의 비공개 `trimSp`를 옮긴 공유 헬퍼 `trimSp(sp, keys, total)`. `plan.ts`와 `speedChart.ts`가 같이 쓴다(단일 출처).
- `plan.ts` (변경): `speedCard`, 스피드 분기, `conditionsFor`의 순풍, `seed`의 스피드 검사를 지운다. `planTab(input, tab: DamageTab)`. 방어 탭 `outspeedsAtMax`(speedEdge)는 그대로 둔다.
- `batch.ts` (변경): `buildTabView(input, tab: DamageTab, …)`. `planTab` 시그니처 변경에 맞춘다.
- `rowTask.ts`·`assemble.ts`·`key.ts`·`relevance.ts` (변경): 스피드 판정(`judge: 'speed'`) 분기를 지운다.
- `rank.ts` (변경): `TAB_MEANS_OWNERS.speed = ['opponent']`(ADR 결정 3).
- `presets.ts`: 변경 없음(스피드 프리셋 3종 재사용).
- `index.ts` (변경): 새 모듈 export.
- `testing.ts`·`__fixtures__/acceptance.ts` (변경): `conditions` 제거, 스피드 픽스처 정리.

앱 `src/app`
- `state.ts` (변경): `conditions`를 `speedChart: { filters, myTailwind, added }`로 바꾼다. 액션 `set-speed-filter`·`set-my-tailwind`·`add-speed-bundle`·`remove-speed-bundle`을 더하고(모두 세대 그대로), `set-tailwind`를 지운다. 기존 `addedBundles`·`pinnedBundles`는 공격·방어용으로 남는다(스피드 값은 만들어지지 않는다).
- `input.ts` (변경): `conditions` 제거.
- `executor.ts`·`useExecutor.ts` (변경): 계산 대상 탭을 `DAMAGE_TABS`로 줄인다. `ExecutorSnapshot.tabs`는 `Record<Tab, …>` 모양을 유지하고 speed는 늘 idle이다(ProductApp 호환, 테스트로 고정).
- `displaySp.ts` (신규): SP 드래그 중 표시 SP를 담는 구독형 저장소. 스피드 차트만 구독해, 드래그 중 Workspace 전체가 다시 그려지지 않게 한다.
- `ProductApp.tsx` (변경): 스피드 탭이면 `ResultBox`·`ResultPanel` 대신 `SpeedTab`을 그린다. onDisplaySp를 실행기와 displaySp 저장소 양쪽에 전달한다.
- `perf.ts` (변경): 스피드 차트 첫 표시·완료 표식(기존 표식 API 형식).
- `components/Toolbar.tsx` (변경): 순풍 토글 묶음 삭제, 통계 설정에 "날씨 특성" ShareField 추가, 스피드 탭에서는 정렬 토글·판정 기준을 숨긴다.
- `components/SpeedTab.tsx` (신규): 스피드 탭 컨테이너. 배지 모델 useMemo, 기준선(표시 SP), 차트 머리, 계산 불가 안내, 차트 프레임, 알림 영역.
- `components/SpeedChartHead.tsx` (신규): 조건 필터 칩 4개 + "내 순풍" 칩(ADR 결정 1 차트 머리).
- `components/SpeedChart.tsx` (신규): 바깥 목록(실수치 줄), 기준선 띠(sticky), 인라인 상세 자리, 순서 비교 불가 영역, 빈 상태, 로빙 탭 인덱스.
- `components/SpeedBadge.tsx` (신규): 배지 버튼(이미지+도구 겹침·이름·배분 표기·태그·표지, 접근 이름).
- `components/SpeedBadgeDetail.tsx` (신규): 인라인 상세(내용 순서는 ADR 결정 1), "다른 배분 추가"(목록·직접 입력·이미 있음), "이 배지 지우기".
- `components/speedChart.css` (신규): 차트 전용 스타일(라이트·다크). `index.css`와 소유를 나눈다.
- `components/MonWithItem.tsx` (신규): 공용 "포켓몬 이미지 + 도구 겹침" 상자(ADR 결정 4).
- `components/monWithItem.css` (신규): 겹침 상자 스타일.
- `components/CardItem.tsx` (변경): `PokemonIcon` + 이름 옆 `ItemVariantBadge`를 `MonWithItem`(변형 줄 = variant, 메가 기본 줄 = mega)으로 바꾼다. 스피드 분기(상세 왼쪽 `BundleList`·`speed` 플래그)를 지운다.
- `components/RowDetail.tsx`·`components/ResultPanel.tsx` (변경): 스피드 행·`orderBadge`·스피드 분기 삭제. `RowDetail.tsx:129-192`의 `tab === 'speed'` 분기(over·need·basisText)를 지운다. 변형 줄 상세에 `MonWithItem`과 도구 이름 텍스트(점유율 없음, 열린 질문 13 기본값)를 둔다.
- `components/text.ts`·`text.test.ts` (변경): `ScarfBasis` import, `ROW_KIND_LABEL`의 `scarf`·`non-scarf`, `basisText`의 `ScarfBasis` 갈래를 지운다. `text.test.ts:47-48`의 scarf basis 사례를 지우고 AC23 매핑에 적는다. (빌드 중 개정 7차로 대체: 기본 배지는 늘 스카프 없는 세트, 스카프는 조건 배지)

UI 공용 `src/ui`
- `images.ts` (변경): `itemGlyphOf(game, itemId)` → `{ kind: 'img'; url } | { kind: 'mega' } | { kind: 'bag' }`. 메가스톤 판정은 `game.data.megas`의 stone이다. 텍스트 배지 폴백은 지운다.
- `ItemGlyph.tsx` (신규): 자체 제작 공통 메가스톤 표지·공통 도구(가방) 표지. 인라인 SVG라 외부 요청이 없다.
- `images.test.ts` (변경): R14 집합 대조 검사 추가.

자산·스크립트
- `scripts/data/lib/images.mjs` (변경): `ITEM_ICON_IDS` 확장(가정 세트 도구·스카프 후보·프리셋 도구, 메가스톤 제외)과 범위 설명 갱신. `gen-images.mjs`는 로직 변경이 없을 것으로 본다(필요하면 같은 태스크).
- `src/assets/item-icons/*` (생성물): PNG·`manifest.json`, `README.md`·`LICENSE` 범위 문구. `THIRD_PARTY_NOTICES.md`와 라이선스 산출물도 갱신한다.

테스트
- 단위
  - 신규: `src/cards/speedChart.test.ts`, `src/cards/speedLadder.test.ts`, `src/cards/iconTargets.test.ts`, `src/cards/__fixtures__/speedMinSpLegacy.ts`(AC7b 기존 결과 고정표).
  - 변경: `src/core/speed.test.ts`, `src/app/state.test.ts`, `src/app/executor.test.ts`, `src/app/components/text.test.ts`, 스피드 카드에 의존하는 기존 cards 테스트(`plan`·`acceptance`·`rowTask`·`assemble`·`batch`·`items`·`powerItems`·`target`·`resultSort`·`rank`·`presets`·`ids`·`berries`·`relevance`).
  - 확인만: `src/dev/*`는 코어 `BattleConditions`·`compareSpeed`·`minSpToOutspeed`·`sweepSpeed`만 쓰고 cards·app 상태 타입을 쓰지 않는다(2026-11-15 grep). 그래도 게이트의 `tsc -b`가 dev 진입점까지 통과해야 한다.
  - 그대로: `src/acceptance/speed-sweep.test.ts`(코어 sweepSpeed 경로는 남는다).
- e2e: `e2e/speed-chart.spec.ts`·`e2e/speed-chart-a11y.spec.ts`(신규), 위 "코드 제약" 18·19의 기존 spec, `e2e/product-myset.spec.ts`(스피드 탭 참조), `e2e/helpers.ts`, `e2e/product-perf.spec.ts`.

### 2. 인터페이스 계약

코어(`src/core/types.ts`·`speed.ts`)

```ts
type SpeedRejection = { kind: 'unsupported' | 'order'; field: 'ability' | 'item'; id: string }
type SpeedFieldCondition =
  | { kind: 'weather'; weather: Exclude<Weather, 'none'> }
  | { kind: 'terrain'; terrain: Exclude<Terrain, 'none'> }
const SPEED_FIELD_ABILITIES: Readonly<Record<string, SpeedFieldCondition>> // swiftswim→Rain, chlorophyll→Sun, sandrush→Sand, slushrush→Snow, surgesurfer→Electric
const ITEM_NEGATING_ABILITIES: readonly string[]                            // ['klutz']
function speedSupport(snapshot: Snapshot, set: PokemonSet, options?: EvalOptions): SpeedRejection | null // 세트 자체 오류는 지금처럼 CoreError
function checkSpeedSupport(snapshot: Snapshot, set: PokemonSet, options?: EvalOptions): void          // 지금과 같은 CoreInputError(field)
```

카드 입력 타입(`src/cards/types.ts`)

```ts
type SpeedConditionKind = 'rank' | 'scarf' | 'tailwind' | 'field'
type SpeedConditionFilters = Readonly<Record<SpeedConditionKind, boolean>>
const DEFAULT_SPEED_FILTERS: SpeedConditionFilters // { rank: true, scarf: true, tailwind: false, field: true }
interface SpeedAddedBundle { opponentId: string; sp: number; nature: NatureSign } // NatureSign = BundleStat['nature']
interface DisplayCriteria { /* 기존 … */ scarfShareMin: number /* 기본 0.05 */; weatherShareMin: number /* 신규, 기본 0.1 */ }
type DamageTab = Exclude<Tab, 'speed'>
const DAMAGE_TABS: readonly DamageTab[]
```

배지 모델(`src/cards/speedChart.ts`)

```ts
type SpeedBadgeOrigin = 'ladder' | 'added' | 'preset' // preset = 목록 밖 타겟 전체(CustomTarget 하나당 프리셋 3종 배지). 따로 'custom'은 두지 않는다
type SpeedCondition =
  | { kind: 'none' }
  | { kind: 'rank'; stage: number; means: readonly { means: MeansRef; share?: number }[] } // 같은 S 랭크 값 수단은 합친다
  | { kind: 'scarf'; share: number }                                                       // 도구 = choicescarf
  | { kind: 'non-scarf'; item: string | null; share: number }                              // 필터 종류는 'scarf' // (빌드 중 개정 7차로 대체: 기본 배지는 늘 스카프 없는 세트, 스카프는 조건 배지)
  | { kind: 'tailwind' }
  | { kind: 'field'; ability: string; field: SpeedFieldCondition; share?: number }         // share 없음 = 목록 밖 타겟
interface SpeedBadge {
  id: string                    // JSON [origin, opponentId, presetIndex|null, sp, nature, conditionKey]
  origin: SpeedBadgeOrigin
  opponentId: string            // 래더 = 메타 항목 id, 프리셋 = rosterId
  speciesId: string             // 이미지·이름용 계산 폼(메가면 메가 폼)
  mega: boolean
  bundle: { sp: number; nature: NatureSign; share: number | null } // null = 직접 입력(added) 또는 프리셋
  listed: boolean               // added 중 묶음 목록에 있는 배분(점유율 표시·R2 정렬)
  presetIndex?: PresetIndex     // origin = 'preset'이면 필수. "프리셋 n" 표지의 n = presetIndex + 1(R10). 그 밖에는 없음
  condition: SpeedCondition
  filterKind: SpeedConditionKind | null // null = 기본·추가 배지(조건 필터 무관)
  speed: number                 // 앱 공식 단독 계산(finalSpeed) 결과
  item: { id: string; negated: boolean } | null // 계산에 쓴 지닌 도구. 무딘손이면 negated
  set: PokemonSet               // 그 배지의 계산 세트
  usageRank: number             // 래더 순위(같은 줄 보조 정렬)
  addedOrder?: number           // added·preset의 추가 순
}
interface SpeedUnsupported { opponentId: string; speciesId: string; origin: 'ladder' | 'preset'; presetIndex?: PresetIndex; rejection: SpeedRejection; item: string | null }
interface SpeedBundleOption { sp: number; nature: NatureSign; share: number; speed: number; onChart: boolean }
interface SpeedChartModel {
  badges: readonly SpeedBadge[]        // 상위 N·선택 필터 적용 후, 조건 필터 적용 전 전부
  unsupported: readonly SpeedUnsupported[]
  options: ReadonlyMap<string, readonly SpeedBundleOption[]> // 래더 상대 id → 스냅숏 전 묶음(점유율 내림차순, bundleShareMin 무관)
}
interface SpeedChartInput {
  game: Snapshot
  view: MetaView
  myAbility: string | null             // 내 계산 특성(메가면 메가 폼). null = 해석 불가, 날씨 무효 없음으로 본다
  criteria: Pick<DisplayCriteria, 'rankShareMin' | 'scarfShareMin' | 'weatherShareMin'>
  filters: CardFilters
  customTargets: readonly CustomTarget[]
  added: readonly SpeedAddedBundle[]
}
function buildSpeedChart(input: SpeedChartInput): SpeedChartModel
function scarfConditionOf(entry: MetaEntry, assumedItem: string | undefined, scarfShareMin: number): Extract<SpeedCondition, { kind: 'scarf' | 'non-scarf' }> | null // 메가는 호출 전에 뺀다 // (빌드 중 개정 7차로 대체: 기본 배지는 늘 스카프 없는 세트, 스카프는 조건 배지)
type AddCheck = { kind: 'ok'; listed: boolean } | { kind: 'duplicate' } | { kind: 'invalid' }
function checkSpeedAddition(model: SpeedChartModel, opponentId: string, sp: number, nature: NatureSign, spMax: number): AddCheck
function ladderBaseSet(game: Snapshot, entry: MetaEntry): { set: PokemonSet; speciesId: string; mega: boolean } // 래더 기본 배지 가정 세트(1위 묶음 적용 전 대표 세트). buildSpeedChart와 iconTargets가 같이 쓴다
```

```ts
// src/cards/spTrim.ts (T6 첫 단계에서 plan.ts에서 옮긴다)
function trimSp(sp: SpTable, keys: ReadonlySet<StatId>, total: number): void // 기존 동작 그대로(keys 밖에서 큰 것부터 덜기)
```

- export 소유: `src/cards/index.ts`는 T5만 고친다. T5가 `speedChart`(`ladderBaseSet`·`scarfConditionOf` 포함)·`speedLadder`를 export한다. `iconTargets`는 index에 넣지 않는다. T9는 `iconTargets.ts`를 cards 내부 모듈로 두고 `src/ui/images.test.ts`·`iconTargets.test.ts`에서 상대 경로로 import한다(앱 런타임은 쓰지 않는다). `spTrim.ts`는 내부 모듈이라 export하지 않는다.

- 배지 목록은 내 SP·성격·도구·순풍과 무관하다. 입력은 `myAbility`뿐이다(ADR 결정 2). 화면은 이 결과에 배수를 곱하지 않는다.
- 조건 배지는 기본 배지에만 붙고, 실수치가 기본 배지와 같으면 만들지 않는다. 조건 세트가 거부되면 그 조건 배지만 빠지고, 기본 세트가 거부되면 그 상대는 `unsupported`로 간다.
- 추가 배지의 가정 세트는 기본 배지 가정 세트에서 S SP와 S 보정 부호만 바꾼다. 대표 성격의 S 부호가 같으면 그대로 쓰고, 다르면 S 보정만 맞는 성격으로 바꾼다. SP 합 초과는 `src/cards/spTrim.ts`의 `trimSp`(S 밖에서 큰 것부터 덜기)를 쓴다. 헬퍼 추출은 T6 첫 단계이고 T5는 그것에 의존한다(단일 출처).

응용 로직(`src/cards/speedLadder.ts`)

```ts
type SpeedStatus = 'outspeeds' | 'tie' | 'outsped'
type SpeedBaseline =
  | { kind: 'ok'; speed: number; sp: number; nature: NatureSign; tailwind: boolean }
  | { kind: 'rejected'; rejection: SpeedRejection }
  | { kind: 'invalid' }                                // 세트 자체 오류(내 세트 패널이 안내)
function speedBaseline(game: Snapshot, mySet: PokemonSet, myTailwind: boolean): SpeedBaseline // 날씨·필드 없음
function statusOf(badgeSpeed: number, baseline: SpeedBaseline): SpeedStatus | null          // ok가 아니면 null(중립)
function summarize(badges: readonly SpeedBadge[], baseline: SpeedBaseline): { outspeeds: number; tie: number; outsped: number } | null
function visibleBadges(model: SpeedChartModel, filters: SpeedConditionFilters): SpeedBadge[]
function compareInRow(nameOf: (speciesId: string) => string): (a: SpeedBadge, b: SpeedBadge) => number // R2 같은 줄 순서
interface LadderRow { speed: number; diff: number | null; badgeIds: readonly string[]; baseline: boolean } // diff = 윗줄 − 이 줄, 맨 윗줄 null
function ladderRows(badges: readonly SpeedBadge[], baselineSpeed: number | null, cmp: (a: SpeedBadge, b: SpeedBadge) => number): LadderRow[]
type MinSp = { kind: 'ok'; sp: number } | { kind: 'over-budget'; sp: number; remaining: number } | { kind: 'impossible' }
function minSpToPass(game: Snapshot, mySet: PokemonSet, target: number, myTailwind: boolean): { neutral: MinSp; plus: MinSp } | null // 코어 minSpToOutspeed(수치 목표), 엄격 추월
type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'
function navigate(rows: readonly LadderRow[], currentId: string, key: NavKey): string     // 배지 없는 기준선 줄은 건너뛴다
function focusAfterRemove(rows: readonly LadderRow[], removedId: string): string | null     // 같은 줄 이웃 → 이웃 줄
function bundleLabel(sp: number, nature: NatureSign): string                               // "S32+" · "S20 =" · "S0 −"
```

- 기준선 줄: 내 실수치에 배지가 없으면 `baseline: true`·`badgeIds: []` 줄이 끼고, 동속 배지가 있으면 그 줄이 `baseline: true`다. 거부·invalid면 기준선 줄이 없다.
- 최소 S의 무보정·상승 성격은 `natureVariants(game, nature, 'spe', [])`로 얻는다(기존 규칙 재사용).
- `MinSp`는 코어 `OutspeedResult`(`src/core/types.ts:143`)를 그대로 옮긴다. `over-budget.remaining`은 코어 `minSpToOutspeed`가 `mySet`의 S 밖 SP 합과 스냅숏 SP 총량으로 계산한다. 잔여 예산 입력을 따로 두지 않는다.

공용 겹침 컴포넌트(`src/app/components/MonWithItem.tsx`)

```ts
interface MonWithItemProps {
  speciesId: string | undefined
  size: number    // 상자 = 이미지 크기(px). 겹침 너비 = round(size × 0.4)
  lazy?: boolean
  item?: { id: string; name: string; role: 'variant' | 'mega' | 'held' }
  className?: string
}
```

- `variant`: 기존 `ItemVariantBadge`의 성질을 그대로 옮긴다. `data-testid="berry-badge"`·`data-item-id`·`data-item-icon`, `title` = 도구 이름, sr-only "OO 지닌 경우", 점유율 없음.
- `mega`: `data-item-role="mega"`, 장식(aria-hidden), `title`만 종별 메가스톤 이름이다. 변형 testid를 쓰지 않는다.
- `held`(스피드 배지·상세·불가 영역): 장식(aria-hidden) + `title`. 도구 이름은 배지 접근 이름이 담는다.
- 그림: `itemGlyphOf` 결과에 따라 PNG(`data-item-icon`), 공통 메가스톤 표지(`data-item-glyph="mega"`), 공통 가방 표지(`data-item-glyph="bag"`) 중 하나다. 깨진 이미지가 생기지 않는다.
- 포켓몬 이미지는 기존 `PokemonIcon`을 상자 안에 그대로 둔다(`data-testid="mon-icon"`·`data-species-icon`·클래스 유지). 상자와 겹침에는 상호작용이 없다.

앱 상태(`src/app/state.ts`)

```ts
interface AppState { /* 기존 … (conditions 삭제) */ speedChart: { filters: SpeedConditionFilters; myTailwind: boolean; added: readonly SpeedAddedBundle[] } }
type AppAction = /* 기존 … (set-tailwind 삭제) */
  | { type: 'set-speed-filter'; kind: SpeedConditionKind; on: boolean }
  | { type: 'set-my-tailwind'; on: boolean }
  | { type: 'add-speed-bundle'; bundle: SpeedAddedBundle; spMax: number } // 형식만 거른다. 중복 최종 판정은 checkSpeedAddition
  | { type: 'remove-speed-bundle'; bundle: SpeedAddedBundle }
```

- 네 액션은 세대를 올리지 않는다. 초기값: `filters = DEFAULT_SPEED_FILTERS`, `myTailwind = false`, `added = []`, `criteria.scarfShareMin = 0.05`, `criteria.weatherShareMin = 0.1`.
- `set-criteria`는 공격·방어 계산에 쓰는 키(bundleShareMin·rankShareMin·berryShareMin·powerItemShareMin)가 바뀔 때만 세대를 올린다. scarf·weather 기준은 스피드 차트만 쓴다.
- 기존 `addedBundles`·`pinnedBundles`에 `tab: 'speed'` 값을 만드는 경로는 없어진다. 남아 있어도 무시된다(R12).

### 3. 태스크 분해

규칙
- 같은 파일은 한 태스크에만 있다. 웨이브 안 태스크는 병렬이다.
- 웨이브 끝마다 `npm run lint`·`tsc -b`·`npm run test:run`을 건다. 웨이브 2는 T5·T6·T7이 모두 끝난 뒤 한 번 건다.
- `notes.md`는 T12만 쓴다. 다른 태스크는 표·매핑·측정값을 결과 보고로 넘긴다.

웨이브 1
- **T1 코어 스피드 확장** — lph:domain-engineer. 의존 없음.
  - 파일: `src/core/speed.ts`, `src/core/types.ts`, `src/core/index.ts`, `src/core/speed.test.ts`.
  - 요구: R4(거부 원인)·R7·R9·비기능 계산 일관성.
  - 완료: `speedSupport`가 계산 거부(3특성·8도구)와 순서 변경(3특성·4도구)을 종류·원인으로 구분한다(단위). `SPEED_FIELD_ABILITIES` 5항목과 거기서 만든 판정 술어로 바꾼 뒤 기존 `speed.test.ts`·`src/acceptance/speed-sweep.test.ts`가 그대로 통과한다. 상대 단독 날씨 `finalSpeed(set, { weather })`가 자기 특성만 보는 사례를 고정한다.
- **T2 AC7b 기존 목표 문구 고정표** — lph:test-engineer. 의존 없음. 기존 스피드 카드 경로가 살아 있을 때 실행해야 하므로 T6보다 먼저 끝난다.
  - 파일: `src/cards/__fixtures__/speedMinSpLegacy.ts`(신규: 입력, 기존 문구 결과, 분류 "추월 목표 비교 대상" / "규칙 변경으로 결과 다름").
  - 요구: AC7b.
  - 완료: 최소 7건(양쪽 불가, 무보정만 불가, 동속 경계, 내 순풍 켬, 내 스카프, 상대 스카프 조건, 예산 초과)을 기존 `planTab('speed')` → 행 작업 → `cellLabel` 실행 결과로 채운다. 생성용 임시 스크립트는 커밋하지 않는다.
- **T3 도구 아이콘 자산 확장** — lph:domain-engineer. 의존 없음. 네트워크 필요.
  - 파일: `scripts/data/lib/images.mjs`, `scripts/data/gen-images.mjs`(필요할 때만), `src/assets/item-icons/*`(PNG·manifest·README·LICENSE), `THIRD_PARTY_NOTICES.md`, 라이선스 산출물(`src/data/licenses.json` 등 생성 경로에 있는 것).
  - 요구: R14·AC19(자산 쪽).
  - 완료: 번들된 전 메타(월·매치 방식)의 래더 전 종 가정 세트 도구, 구애스카프, "스카프 아닌 최다 도구" 후보, 프리셋 도구의 합집합에서 메가스톤을 뺀 id가 모두 manifest와 PNG를 가진다(판 고정·sha1 대조). 출처에 없는 id는 목록과 이유를 보고한다(공통 가방 표지 대상). 라이선스 범위 문구를 갱신하고, 기존 `src/ui/images.test.ts`·`src/data/licenses.test.ts`가 통과한다.
- **T4 공용 겹침 상자·공통 표지** — lph:ui-engineer. 의존 없음.
  - 파일: `src/app/components/MonWithItem.tsx`(신규), `src/app/components/monWithItem.css`(신규), `src/ui/ItemGlyph.tsx`(신규), `src/ui/images.ts`.
  - 요구: R13·R14(대체 표지·메가스톤 표지)·ADR 결정 4·5.
  - 완료: 위 props 계약대로 세 역할을 그린다. 겹침은 상자 오른쪽 아래 절대 배치, 너비는 이미지의 0.35~0.45배, 상자 크기는 이미지 크기와 같다. 받침 대비가 라이트·다크 3:1 이상이다(측정값 보고). 메가스톤·가방 표지는 외부 요청이 없다. 기존 `ItemVariantBadge` 삭제는 T7이 한다.

웨이브 2
- **T5 스피드 차트 배지 모델·사다리 순수 로직** — lph:domain-engineer. 의존 T1, T6의 `types.ts` 추가분과 `spTrim.ts` 추출(둘 다 T6 첫 단계, 위 계약 이름 그대로 병행).
  - 파일: `src/cards/speedChart.ts`, `src/cards/speedLadder.ts`, `src/cards/speedChart.test.ts`, `src/cards/speedLadder.test.ts`, `src/cards/index.ts`.
  - 요구: R2(줄·순서)·R3·R4·R5·R6(최소 S)·R7·R8(필터 적용)·R9·R10·R11·R15(모델)·비기능 계산 일관성·접근성(탐색 규칙).
  - AC: AC4·AC5b(단위)·AC6(단위)·AC7b·AC8(단위)·AC9·AC12·AC13(단위)·AC20(탐색 단위).
  - 완료
    - AC9 항목 전부, AC12 경계(스카프×순풍, +1×스카프, 날씨×스카프, 홀수 반올림, 무딘손), AC4(1위 5% 미만, 동률이면 실수치 높은 묶음)를 단위 테스트로 고정한다.
    - AC7b: T2 고정표 중 "추월 목표" 사례는 일치하고, "규칙 변경" 사례는 새 기대값으로 고정한다. 예산 초과 사례 포함.
    - 배지 목록이 내 SP와 무관함을 단언한다.
    - `ladderBaseSet`을 공개하고 `index.ts`에서 export한다(T9가 쓴다). 추가 배지 SP 덜기는 `spTrim.ts`를 쓰고 같은 규칙을 다시 짜지 않는다.
    - `minSpToPass`의 `over-budget.remaining`이 코어 결과 그대로임을 예산 초과 사례로 고정한다.
    - 탐색 함수(위아래 같은 순번·없으면 그 줄 마지막, 좌우, Home/End, 빈 기준선 줄 건너뜀, 삭제 뒤 포커스)를 테스트한다.
    - AC12 경계표의 입력·기대값을 결과 보고로 넘긴다.
- **T6 기존 스피드 카드 경로 제거·앱 상태·실행기** — lph:domain-engineer. 의존 T2.
  - 파일
    - cards: `src/cards/types.ts`, `spTrim.ts`(신규), `plan.ts`, `batch.ts`, `rowTask.ts`, `assemble.ts`, `key.ts`, `relevance.ts`, `rank.ts`, `testing.ts`, `__fixtures__/acceptance.ts`, `__fixtures__/acceptance.test.ts`, 기존 테스트(`plan`·`acceptance`·`rowTask`·`assemble`·`batch`·`items`·`powerItems`·`target`·`resultSort`·`rank`·`presets`·`ids`·`berries`·`relevance`.test.ts).
    - app: `src/app/state.ts`, `state.test.ts`, `input.ts`, `executor.ts`, `executor.test.ts`, `useExecutor.ts`.
  - 요구: R7(스카프 기본 5%·날씨 기준)·R8(상대 순풍 상태 삭제)·R11(내 순풍)·R12·R15(상태)·ADR 결정 2 하위.
  - AC: AC11(기본값 단위)·AC16·AC26(리듀서)·AC23(단위 매핑).
  - 완료
    - 첫 단계: `types.ts` 계약 추가분을 넣고, `plan.ts`의 `trimSp`를 `spTrim.ts`로 옮겨 `plan.ts`가 그것을 import한다(동작 불변, T5 병행용).
    - `planTab`·`buildTabView`의 `tab`을 `DamageTab`으로 좁힌다. 실행기는 `DAMAGE_TABS`만 돌리므로 호출 쪽에서 `Tab` → `DamageTab` 좁힘이 타입으로 드러나야 한다(단언 캐스트 금지).
    - 스피드 카드 계획·행·조립 분기를 지운 뒤 공격·방어 단위 테스트가 그대로 통과한다.
    - 리듀서 테스트: 네 액션 세대 불변, 필터 기본값, 스카프·날씨 기준 변경은 세대 불변, 공격·방어 직접 추가·핀과 격리.
    - 실행기 테스트: speed는 계산하지 않고 늘 idle, 공격·방어 우선순위 불변. speed 탭 스냅숏에서 `my-set-error`가 나오지 않음을 고정한다(ProductApp `reasons`에 스피드 갈래가 빠지는 것의 단위 근거).
    - `src/dev/*` 포함 `tsc -b`가 T6 범위 안에서 통과한다(dev는 cards·app 상태 타입을 쓰지 않음을 재확인).
    - 지우거나 바꾼 단위 테스트의 "테스트 → R번호 / 없어진 기능" 매핑을 결과 보고로 넘긴다.
- **T7 공격·방어 카드에 겹침 적용·스피드 카드 UI 제거** — lph:ui-engineer. 의존 T4, T6(타입 삭제분 계약).
  - 파일: `src/app/components/CardItem.tsx`, `RowDetail.tsx`, `ResultPanel.tsx`, `text.ts`, `text.test.ts`, `Toolbar.tsx`, `src/index.css`(이름 옆 `berry-badge` 배치·스피드 카드 전용 스타일 정리. 새 css 파일 import 지점이 필요하면 여기). 공격·방어 상세 회귀 단위 테스트를 새로 두면 `src/app/components/RowDetail.test.tsx`(신규)도 T7 소유다.
  - 요구: R7(날씨 특성 기준 칸)·R8(상대 순풍 토글 삭제)·R12(스피드 카드 UI 삭제)·R13(공격·방어 간단행·상세). AC11(툴바 표시)·AC17·AC18(공격·방어).
  - 완료
    - 간단행이 `MonWithItem`을 쓴다(변형 줄 = variant, 메가 기본 줄 = mega, 그 밖은 겹침 없음). 이름 옆 도구 아이콘이 없다. 줄 높이·클릭 펼침이 그대로다.
    - 펼친 상세(`RowDetail`)도 같은 규칙으로 `MonWithItem`을 쓰고, 변형 줄이면 도구 이름을 텍스트로 적는다(점유율 없음, 열린 질문 13 기본값).
    - `RowDetail.tsx:129-192`의 스피드 분기(over·need·basisText)·`orderBadge`·`BundleList`의 스피드 사용처를 지운다. `text.ts`의 `ScarfBasis`·`ROW_KIND_LABEL` scarf 키를 지우고 `text.test.ts`의 scarf 사례를 지운다(AC23 매핑 보고).
    - 공격·방어 상세 회귀: 랭크 basis·변형 줄·SP 구간 표기가 지우기 전과 같음을 단위 테스트(또는 기존 공격·방어 e2e 로컬 실행 결과)로 보인다. 기존 공격·방어 e2e가 셀렉터 변경 외에는 같게 동작함을 로컬에서 확인한다.
    - 툴바: 순풍 토글 묶음(`Toolbar.tsx:248-261`)을 지우고, 통계 설정에 "날씨 특성" ShareField(`weatherShareMin`)를 더하고, 활성 탭이 스피드면 정렬 토글·판정 기준을 숨긴다. 이것으로 W2 게이트에서 `state.conditions` 참조가 남지 않는다.

웨이브 3
- **T8 스피드 차트 UI·툴바·앱 연결** — lph:ui-engineer. 의존 T4·T5·T6. 시각 기준은 `./design-options.html` 대안 C.
  - 파일: `src/app/components/SpeedTab.tsx`·`SpeedChartHead.tsx`·`SpeedChart.tsx`·`SpeedBadge.tsx`·`SpeedBadgeDetail.tsx`·`speedChart.css`(신규), `src/app/displaySp.ts`(신규), `src/app/ProductApp.tsx`, `src/app/perf.ts`. 툴바는 T7 소유다.
  - 요구: R1~R6·R8~R11·R13(스피드 위치)·R15·비기능 접근성·반응형·깜박임 없음·ADR 결정 1·6.
  - 완료
    - DOM은 실수치 내림차순 바깥 목록(줄 라벨·윗줄 차이·배지 안쪽 목록)이다. 기준선 구분 항목은 포커스를 받지 않고, 읽기 이름은 "내 스피드 N. N과 같으면 동속, 그보다 아래는 추월"이다.
    - 기준선 띠는 프레임 위·아래 끝에 붙고(sticky), 프레임 스크롤 여백은 띠 높이다. 처음 열면 스크롤 맨 위다.
    - 로빙 탭 인덱스와 `navigate`를 적용한다.
    - 상세: 호버 250ms 지연, 포커스·탭·클릭 즉시. Esc·바깥·×로 닫고, 마우스가 떠나는 것만으로는 닫지 않는다. 상세가 다른 줄로 옮겨 갈 때 포커스한 배지의 화면 위치를 유지한다.
    - 알림 영역은 SP 확정·추가/삭제·필터 변경 뒤에만 갱신한다.
    - 거부 안내 줄(차트 머리 아래), 빈 상태, 순서 비교 불가 영역을 그린다.
    - 배지 이름 텍스트는 데스크톱 폭에서만 둔다(경계값을 결과 보고에 적는다).
    - 날씨 배지 상세에 "내 쪽 날씨 미반영"을 밝힌다(열린 질문 7 기본값. 기준선·최소 S는 날씨 없음 유지).
    - `ProductApp`의 `reasons`에서 스피드 `my-set-error` 갈래가 사라진다. 스피드 전용 거부는 차트 머리 아래 R4 안내가 유일한 표시다.
    - 400px에서 페이지 가로 스크롤이 없다.
    - 배지 모델 useMemo 키에 내 SP를 넣지 않아 드래그 중 배지 위치가 바뀌지 않는다.
- **T9 아이콘 대상 집합 계산·대조 검사** — lph:test-engineer. 의존 T3·T5(`scarfConditionOf`, `ladderBaseSet`. 둘 다 `src/cards`에서 export).
  - 파일: `src/cards/iconTargets.ts`, `src/cards/iconTargets.test.ts`, `src/ui/images.test.ts`. `src/cards/index.ts`는 고치지 않는다(T5 소유). `iconTargets`는 테스트에서 상대 경로로 import한다.
  - 요구: R14·AC19(검사).
  - 완료: 번들된 모든 메타 선택에서 R14 합집합을 앱과 같은 함수로 계산한다. 메가스톤 밖 id는 manifest·PNG가 있고, 메가스톤은 `game.data.megas` stone으로 공통 표지에 대응하며, 집합 밖 임의 도구는 `itemGlyphOf`가 `bag`을 낸다. 검사가 실패하면 빠진 id 목록과 함께 T3 재작업으로 돌린다.

웨이브 4
- **T10 e2e 갱신·신규·AC23 매핑** — lph:test-engineer. 의존 T7·T8·T9.
  - 파일: `e2e/speed-chart.spec.ts`(신규), `e2e/helpers.ts`, `e2e/product.spec.ts`, `product-toolbar.spec.ts`, `product-berry.spec.ts`, `product-images.spec.ts`, `product-layout.spec.ts`, `product-myset.spec.ts`, `offline.spec.ts`, `product-power-item.spec.ts`, 그 밖 스피드 탭이나 카드 이미지 직계 자식 셀렉터에 의존하는 spec(`product-perf.spec.ts` 제외).
  - AC: AC1~AC8(AC5b·AC7b 문서 쪽 제외)·AC10·AC11·AC13~AC20·AC22(스크린샷)·AC24·AC25·AC26.
  - 완료
    - AC4 e2e: 래더 상대 하나당 기본 배지가 하나이고 그 배분이 1위 묶음이며, 배분 표기가 "S32+"·"S20 ="·"S0 −" 형식이다.
    - `product-myset.spec.ts`: 스피드 탭 참조를 새 차트 기준으로 바꾸고, 스피드 전용 거부 세트가 내 세트 패널 경고 대신 차트 머리 안내로 보이며 공격·방어 탭은 정상임을 본다(AC5b).
    - 공격·방어 펼친 상세의 겹침·도구 이름 텍스트(열린 질문 13 기본값)를 AC17 e2e에서 함께 본다.
    - 위 "코드 제약" 18·19의 목록 전부를 갱신·삭제·이동하고, "테스트 → R번호 / 없어진 기능(핀 등) / 구조 변경(셀렉터)" 매핑을 결과 보고로 넘긴다.
    - AC10: 쓱쓱 상대(m-c 2026-10 Bo3 16위·Bo1 33위 대쓰여너 암컷)를 선택 필터로 띄운다. 없으면 고정 데이터로 돌린다.
    - AC13: 래더에 거부 특성·도구 점유율 5% 넘는 상대가 없으므로, 목록 밖 타겟 프리셋 도구를 선제공격손톱 등으로 편집해 만든다.
    - AC2: 1 차이 이웃 줄을 포함하고, 띠가 제자리인 스크롤 위치에서 400px·1280px로 검사한다.
    - AC25: 슬라이더 연속 이동 중 rAF 프레임마다 배지 좌표를 기록해 비교한다.
- **T11 접근성·성능·대비 측정** — lph:test-engineer. 의존 T8.
  - 파일: `e2e/product-perf.spec.ts`, `e2e/speed-chart-a11y.spec.ts`(신규).
  - 요구: 비기능 성능·접근성. AC17(대비 측정값)·AC20(접근성 트리·알림 영역·대비)·AC21.
  - 완료: 프로덕션 빌드·Chromium·상위 30·조건 필터 전부 켬 기준으로 처음 열기와 SP 슬라이더 놓기(+4, 상한·잔여를 넘으면 −4) 각 10회 중앙값이 첫 표시 ≤ 500ms, 완료 ≤ 3초, Long Task ≤ 100ms다. 공격·방어 탭 기존 예산을 다시 잰다. 상태·조건 태그 글자 4.5:1, 겹침 받침 3:1(라이트·다크)을 잰다. 측정값과 기준선 대비 악화 원인을 결과 보고로 넘긴다.

웨이브 5
- **T12 기록 정리** — lph:test-engineer. 의존 T2·T5·T6·T8·T10·T11.
  - 파일: `docs/raw/feature/speed-tab-revamp/notes.md`("검증" 절과 그 아래 표).
  - 요구: AC7b·AC12·AC21·AC23의 문서 쪽.
  - 완료: AC7b 고정표(T2), AC12 경계표(T5), AC23 매핑(T6 단위 + T10 e2e), 성능·대비 측정값(T11), 배지 이름 텍스트 폭 경계값·차트 프레임 높이 세부(T8)를 notes에 옮긴다. ADR 후속 작업 체크 상태와 지식 후보(INV 2건·G 1건)를 갱신한다.

웨이브 요약: W1 = T1·T2·T3·T4 → W2 = T5·T6·T7 → W3 = T8·T9 → W4 = T10·T11 → W5 = T12. 최장 경로는 T1 → T5 → T8 → T10 → T12다.

### 4. 위험 요소와 완화

- **웨이브 2 계약 경합**: T5는 T6의 `types.ts` 추가분·`spTrim.ts`를, T7은 T6의 타입·상태 삭제분을 전제한다. 삭제 타입을 쓰는 UI 파일(`Toolbar.tsx`·`text.ts`·`text.test.ts`·`RowDetail.tsx`)은 모두 T7이 가져 W2 게이트 `tsc -b`가 W3 태스크에 기대지 않는다. → T6이 `types.ts` 추가분과 `spTrim.ts` 추출을 첫 단계로 넣고 이 절 2의 이름을 그대로 쓴다. 게이트는 웨이브 끝에 한 번 건다. 이름이 바뀌면 T6이 보고하고 이 절을 고친다.
- **AC7b 고정 시점**: 기존 경로를 지우면 기존 문구 결과를 다시 낼 수 없다. → T2를 W1에 두고 T6이 T2에 의존한다. 기존 규칙은 "한 단계 위"라, 동속 목표·현재 유지 사례는 비교에서 빼고 따로 고정한다(ADR 결정 2).
- **날씨 무효 판정 주체**: `compareSpeed`와 세트 목표 `minSpToOutspeed`는 양쪽 특성으로 날씨를 지운다. → 배지는 `finalSpeed` 단독 계산, 최소 S는 수치 목표(`target: number`)로만 부르고 날씨는 없음. 무효 판정은 `buildSpeedChart`가 `myAbility`로만 한다. 대미지 날씨 경로(INV-261115)는 손대지 않는다.
- **내 세트 거부 안내 경로가 바뀜**: 지금은 스피드 계획의 `my-set-error`가 내 세트 패널 경고로 모인다(`ProductApp`의 reasons). 스피드가 실행기를 떠나면 슬로스타트·선제공격손톱 같은 스피드 전용 거부는 내 세트 패널에 오지 않는다. → R4 안내(차트 머리 아래)가 유일한 표시가 된다. 같은 세트가 공격·방어 탭에서는 정상인지 AC5b e2e에서 함께 본다.
- **순풍이 세대 입력에서 빠짐**: `set-tailwind`가 세대를 올리던 동작이 없어진다. 공격·방어는 이미 순풍 없음이라 결과가 같아야 한다. → 실행기·acceptance의 공격·방어 테스트가 그대로 통과하는지로 확인한다.
- **스카프 기준 기본값 5%**: 10%를 전제한 테스트(`acceptance.test.ts` 스카프 경계, `product-toolbar.spec.ts` 기본 표시값)가 바뀐다. → AC23 매핑에 적는다. 이 기준은 스피드 차트만 쓰므로 공격·방어 결과는 그대로다.
- **동기 배지 계산 성능**: 상위 30 × (기본 + 조건 최대 4~5)번의 `finalSpeed`와, 상세를 열 때 최소 S 2회(각 0~32 탐색)다. 수 ms로 예상하지만 측정 전이다. → T11이 잰다. 넘으면 배지 모델을 메타·기준 단위로 memo하고, 그래도 넘으면 ADR 결정 2의 분할 대안으로 돌아가 ADR을 고친다.
- **드래그 중 재렌더**: 표시 SP마다 Workspace가 다시 그려지면 공격·방어 목록까지 흔들린다. → `displaySp.ts` 구독 저장소로 스피드 차트만 갱신한다. 배지 모델 memo 키에 내 SP를 넣지 않아 AC25를 구조로 만족한다.
- **sticky 띠와 포커스·상세**: 띠가 끝에 붙은 동안 포커스한 배지가 가려질 수 있다. → 프레임 `scroll-padding-block`을 띠 높이로 두고(ResizeObserver로 측정), 띠 안 동속 배지 상세는 프레임을 스크롤해 제자리에 보인다. 동속 배지 줄바꿈으로 띠 높이가 바뀔 때마다 다시 잰다.
- **e2e 셀렉터 붕괴**: 이미지가 상자 안으로 한 단계 내려가 `.card-who > [data-testid="mon-icon"]` 같은 직계 자식 셀렉터가 깨진다(G 후보). → 자손 셀렉터로 바꾸고 "구조 변경, 기능 동일"로 매핑한다. testid·`data-species-icon`·클래스는 유지한다.
- **아이콘 출처 결손·네트워크**: 출처에 없는 도구가 있을 수 있다. → T3가 목록을 보고하고 그 도구는 가방 표지로 남는다. R14 "집합의 모든 도구는 아이콘이 보인다"와 충돌하면 사용자 확인이 필요하므로 열린 문제로 올린다. 생성은 네트워크가 필요하고, 판(sha1) 고정으로 재현성을 지킨다.
- **실데이터 의존 e2e**: 2026-10 m-c 기준 래더에 거부 특성·도구 점유율 5% 넘는 상대가 없고, 쓱쓱은 Bo1 33위·Bo3 16위다. → 선택 필터와 목록 밖 타겟 편집으로 사례를 만든다. 데이터 월이 바뀌면 깨질 수 있으므로 종 id를 `e2e/helpers.ts` 상수 한 곳에 둔다.
- **같은 줄 순서의 이름 비교**: 가나다순은 한국어 이름 기준이다. → `compareInRow`가 이름 함수를 주입받게 해 cards 층이 UI 이름 모듈에 의존하지 않게 한다.
- **메가스톤 표지 우선순위**: 메가스톤은 받지 않고 공통 표지로 덮는다. → `itemGlyphOf`가 PNG 조회보다 메가스톤 판정을 먼저 해야 출처 PNG가 섞이지 않는다.

### 5. 지식 브리핑 발췌

`knowledge.mjs brief --paths`(계획 파일들) 결과 중 이 작업과 맞닿는 항목.

- **INV-261105-app-speed-no-engine**: 스피드는 앱 공식으로만 계산한다(999 상한 없음). 코드 `src/core/speed.ts:speedOf`. → 배지·기준선·최소 S는 모두 코어 함수를 부르고, 화면·모델에서 배수를 곱하지 않는다.
- **INV-261115-attacker-field-only**: 대미지 판정의 날씨·필드는 공격측 해결 특성에서만 유도한다. 코드 `src/core/fieldAbilities.ts:withAttackerField`, `src/cards/plan.ts:damageConditions`. → 스피드 날씨 배지는 이 경로 밖(상대 단독 가정)이다. T6의 `plan.ts` 정리에서 `damageConditions`·`speedEdge`를 건드리지 않는다.
- **INV-261113-rank-active-means-only**: 랭크 수단은 자기에게 거는 능동 수단만 쓴다. 코드 `src/cards/rankMeans.ts:isActiveMeans`, `src/cards/rank.ts:TAB_MEANS_OWNERS`. → 랭크업 배지는 `ladderMeans`·`setMeansCandidates`·`applyMeans`를 그대로 쓴다. `TAB_MEANS_OWNERS.speed`는 상대만으로 바꾼다(ADR 결정 3). knowledge 출처 갱신은 후속.
- **INV-261113-attack-opp-no-item**: 공격 탭 래더 기본 카드는 도구를 지운다(메가스톤만 유지). → 공격·방어 기본 줄은 겹침이 없고 메가만 mega 표지다. 스피드 기본 배지는 가정 세트 도구 그대로다(R13 탭별 차이).
- **G-261106-node-core-ts-hook**: `scripts/`에서 `src/core`를 import하려면 ts 훅을 먼저 등록한다. → T3는 생성 스크립트에서 cards·core 로직을 부르지 않는다(ADR 결정 5: 집합 계산은 cards + 단위 검사, 스크립트는 정적 목록만).

### 6. 구현 지침 발췌

`code-review-guideline.md`에서 §0 코어 렌즈와 이 작업 표면에 맞닿는 절만 옮긴다.

- §0
  - 코드가 바뀌면 그 사실을 적은 문서·문구(README·LICENSE·고지·테스트 설명·주석)도 같은 diff에서 바꾼다.
  - 같은 사실을 두 곳에서 계산하지 않는다. 거부 목록·날씨 특성 표는 `speed.ts` 한 곳, 스카프 규칙은 `speedChart.ts` 한 곳이다.
  - 설정↔해제·추가↔삭제·열기↔닫기를 한 단위로 만든다(추가 배지, 조건 필터, 상세).
  - 극단에서 대조한다: 400px, 최장 이름, 동속 배지 다수, 배지 0개, 내 세트 거부.
- §1: 라이선스·고지 diff는 나열한 자산이 저장소에 실제로 있는지, 범위(종류·개수) 문구가 manifest와 맞는지 대조한다. 동작이 바뀐 화면 문구·테스트 설명("상대 순풍" 등)의 낡은 서술을 저장소 전체에서 찾는다.
- §2: 요약 개수·필터 칩·"차트에 있음" 비활성 같은 파생 표시값은 그 조작이 실제로 도달할 결과 기준으로 낸다. 요약은 표시 중 배지에서, "이미 있음"은 `checkSpeedAddition` 한 곳에서 낸다. 배지 id 같은 합성 키는 구분자가 있는 JSON 배열로 만들어 조합 유일성을 지킨다.
- §4: 거부 분류(계산 불가 / 행동 순서 변경 / 세트 자체 오류)의 우선순위와 가드 순서를 맞춘다. 주 결과가 무효(내 세트 거부)면 상태·요약·최소 S·알림 같은 파생 효과를 모두 억제한다.
- §6: 첫 화면에 반영될 값(필터 기본값, 기준선)을 effect에서 늦게 세팅하지 않는다. 호버 지연 타이머는 떠남·다른 배지 열림·언마운트에서 해제한다.
- §7: sticky 띠·인라인 상세·스크롤 여백은 ResizeObserver로 다시 잰다. 띠·상세 높이 변화가 포커스 배지를 가리지 않는지, 400px·최장 라벨에서 가로 넘침이 없는지 본다. 지연 이미지는 상자 크기로 자리를 잡아 둔다.
- §8: 상세를 닫거나 배지를 지울 때 포커스를 명시적으로 옮긴다(`focusAfterRemove`). Enter·Space 둘 다 연다. 반응형으로 이름 텍스트를 숨겨도 접근 이름은 남긴다. 알림 영역은 같은 텍스트를 반복하면 공지되지 않으므로 값이 바뀔 때만 갱신한다. `aria-hidden` 겹침이 도구 정보의 유일한 표현이 되지 않게 배지 이름·툴팁에 도구를 둔다.
- §9: 아이콘 받기 목록(정적)과 대상 집합(데이터 파생)의 어긋남은 대조 검사가 잡는다. 판(sha1)을 고정하고 생성물은 손으로 고치지 않는다.
- §10: 테스트를 지우거나 바꾸면 대체 요구·없어진 기능 매핑을 남긴다. 매핑 밖 테스트는 바뀌지 않은 채 통과해야 한다(AC23). `test.skip`·`.only`·스텁은 완료 근거가 아니다.

`comment-convention.md` 관문 요약
- 주석은 다음 독자에게 쓴다. 결정 근거·수치·날짜·태스크 번호·기각 이력·R/AC/결정 번호는 정본(PRD·ADR·커밋)에 두고 코드에 옮기지 않는다. 제약 자체는 남긴다.
- 이름이 이미 말하면 지운다. 애매하면 주석 대신 이름을 고치거나 함수로 뺀다. 불변식은 테스트로 봉인하고, 봉인했다는 사실은 주석에 적지 않는다.
- 남는 문장은 허용목록(외부 제약, 값의 단위·경계, 순서 의존, 공개 API 문서 주석, 테스트 봉인 1줄, 이슈 표시) 중 하나를 지목해야 한다. 내용이 5줄을 넘으면 결정 문서로 보낸다(공개 API 문서 주석만 예외).

### 7. 비평 반영 (2026-11-15, 계획 리뷰 VERDICT REVISE)

- 1 수용: W2 게이트에서 `Toolbar.tsx:253,261`의 `state.conditions`·`set-tailwind`, `text.ts:3,12,38`·`text.test.ts:48`의 `ScarfBasis`·scarf 키가 깨진다(코드 확인). Toolbar 전체(순풍 삭제·날씨 칸·스피드 탭 숨김)와 `text.ts`·`text.test.ts`를 T7로 옮겼다. Toolbar를 T6이 아닌 T7에 둔 것은 UI 파일을 ui-engineer 한 태스크가 갖게 하고 T8과 파일이 겹치지 않게 하려는 것이다.
- 2 수용: `batch.ts:9-10` `buildTabView(input, tab: Tab)`가 `planTab`을 부른다(코드 확인). T6 파일에 `batch.ts`를 넣고 좁힘 규칙을 적었다. 같은 grep에서 빠져 있던 `powerItems.test.ts`도 T6에 넣었다.
- 3 수용: `trimSp`는 `plan.ts:738` 비공개다(코드 확인). `src/cards/spTrim.ts` 추출을 T6 첫 단계로, T5가 그것에 의존한다고 적었다.
- 4 수용: R13 적용 위치는 "간단행·상세"다(PRD 확인). T7에 `RowDetail` 겹침과 상세 도구 이름 텍스트(열린 질문 13 기본값)를 넣었다.
- 5 수용: T10 AC 목록에 AC4가 빠져 있었다. AC4 e2e를 T10 완료 기준에 넣었다.
- 6 수용: `RowDetail.tsx:129-192` 스피드 분기 제거와 공격·방어 상세 회귀 확인을 T7에, speed 스냅숏 `my-set-error` 부재 단위 고정을 T6에, `product-myset.spec.ts`를 T10에 넣었다.
- 7 부분 수용: `CustomTarget`은 프리셋 3종 편집을 담는 구조라(`src/cards/types.ts:62`) 목록 밖 타겟은 모두 프리셋 배지다. `'custom'`을 더하지 않고 "preset = 목록 밖 타겟 전체, presetIndex 필수, n = presetIndex + 1"로 정의했다.
- 8 수용: 기본 배지 가정 세트 함수 `ladderBaseSet`을 계약에 적고 export 소유(T5의 `index.ts`)와 T9의 import 경로를 정했다.
- 9 수용: 날씨 배지 상세 "내 쪽 날씨 미반영"(열린 질문 7 기본값)을 T8 완료 기준에 넣었다.
- 10 부분 수용: `src/dev/*`는 코어 `BattleConditions`·`compareSpeed`·`minSpToOutspeed`·`sweepSpeed`만 쓰고 cards·app 상태 타입은 쓰지 않는다(grep 확인). 영향은 없지만 T6 완료 기준에 dev 포함 `tsc -b` 통과를 적었다.
- 열린 질문(over-budget.remaining) 해소: 코어 `OutspeedResult`가 이미 `remaining`을 가지며 `minSpToOutspeed`가 `mySet`과 스냅숏 SP 총량으로 계산한다. 잔여 예산 입력을 따로 두지 않는다고 계약에 적었다.

## 구현 결과 (2026-11-16, T12 기록)

> 위 "구현 계획"은 계획 당시 그대로 둔다. 실제와 다른 점과 남은 위험만 여기 적는다.

### 계획 대비 차이

- **T8 중단**: ui-engineer T8(SpeedTab·SpeedChart·배지·상세)은 끝나지 못했다. `SpeedTab.tsx`·`SpeedChart.tsx`(와 `SpeedBadgeDetail.tsx`·`speedChart.css`)는 리뷰 반영 단계에서 작성·마무리했다. 그 결과 웨이브 3 게이트와 웨이브 4(T10·T11)의 일부가 리뷰 반영 뒤 코드에 대해 돌았다.
- **`speedText.ts` 분리**: 배지 이름·배분 표기·조건 상세·점유율 문구를 컴포넌트에서 떼어 `src/app/components/speedText.ts` 한 곳에 모았다(계획에는 없던 파일).
- **배지 이름 텍스트 폭 경계 60rem**: `.speed-badge-name`은 `@media (min-width: 60rem)`에서만 보인다. 좁은 폭은 이미지와 접근 이름으로 구분한다. 같은 경계에서 상세를 배지 칸 시작선에 맞춰 들여 쓴다(`speedChart.css`). 30rem 이하는 줄 그리드 열을 좁힌다. 차트 프레임은 `.speed-frame`이 세로 스크롤을 맡고(`overflow-y: auto`), 컨테이너 `min-height: 14rem`이며, `scroll-padding-block`은 SpeedChart가 잰 띠 높이(`--speed-band-h`, 기본 2.4rem) + 0.25rem이다.
- **`MonWithItem`에 `game` prop 추가**: 메가스톤 판정에 스냅숏이 필요해 `game?: Snapshot`을 받는다. 있으면 `itemGlyphOf(game, id)`로 정한다(메가스톤 판정이 PNG 조회보다 먼저).
- **도구 아이콘 53종(신규 13)**: `src/assets/item-icons/` PNG가 53개이고 이번에 13개가 늘었다(구애스카프 등 R14 대상 집합). 라이선스·README·`THIRD_PARTY_NOTICES.md`를 함께 고쳤다. (빌드 중 개정 4차 뒤 정리: 판정 계산에 관여하는 도구만 표시하게 되어 최종 42종 — 신규는 choicescarf·ironball 2종만 남기고 11종 삭제)
- **공통 표지 SVG**: 메가스톤은 PNG를 쓰지 않고 공통 메가스톤 표지(`kind: 'mega'`), 집합 밖이고 받은 그림도 없는 도구는 공통 가방 표지(`kind: 'bag'`)다(`src/ui/images.ts` `ItemGlyphSpec`). 이전 "텍스트 배지 폴백"을 대체한다.

### 남은 위험

- **부하 민감 테스트 시간**: `product-perf.spec.ts` 공격 탭 시나리오가 첫 전체 실행에서 슬라이더 놓기 뒤 세대 변화 5초 대기에 걸려 한 번 실패했고, 다시 돌리면 통과했다. 동기 배지 모델·rAF 좌표 기록(AC25)·10회 반복 측정처럼 시간에 민감한 spec은 부하가 큰 기계나 다른 spec과 같이 돌 때 흔들릴 수 있다. 성능 수치는 단독 실행 값으로만 판단한다.
- **공격·방어 완료 시간 악화(예산 안)**: 방어 처음 열기 완료 1652ms 등 이전 이력보다 느리다. 원인은 확인하지 못했다(위 "AC21 성능" 원인 추정). 같은 기계에서 main 빌드와 나란히 재는 측정이 후속으로 필요하다.
- **날씨 배지 상세 "내 쪽 날씨 미반영"**: 열린 질문 7 기본값대로 `speedText.ts`가 날씨/필드 배지 상세를 "{특성} 점유율 n% · 파트너 날씨 가정 · 내 쪽 날씨 미반영"(필드는 "내 쪽 필드 미반영")으로 낸다. 이 문구를 직접 확인하는 단위·e2e 단언은 없다(AC10 e2e는 "파트너 날씨 가정"만 본다). 문구가 바뀌어도 테스트가 잡지 못한다.
- **실데이터 의존 e2e**: AC10(쓱쓱 대쓰여너)·AC13 사례는 2026-10 m-c 메타에 기댄다. 데이터 월이 바뀌면 `e2e/helpers.ts` 상수를 고쳐야 한다.
- **`e2e/speed-chart.spec.ts` 미추적**: 이 기록 시점에 git 미추적 파일이다. 커밋에서 빠지면 AC1~AC26 e2e 근거가 사라진다.

### 빌드 중 개정 요약 (1~7차, 2026-11-16~17, 사용자 확인)

- **메가 문양**: 메가스톤 공통 표지를 교체했다가 최종적으로 제거했다.
- **도구 표시 위치**: 포켓몬 이미지 위 겹침 → 이름·배분 표기 오른쪽 나란히 → 그 줄·배지의 판정 계산에 관여한 도구만 표시.
- **스피드 배지 단순화**: 배지 안 이름 텍스트·메가 태그, 차이 숫자, 개수 요약을 제거했다.
- **스피드 배지 상세**: 클릭으로 여닫고, 닫기(X) 버튼을 없앴으며, 배분·조건 점유율과 안내 문구를 빼 내용을 단순화했다(점유율은 "다른 배분 추가" 목록에만 작은 회색 글씨로 남김).
- **6차**: 상위 N 기본값 30 → 100(사실상 전 종). 성능 예산의 전체 완료 중앙값을 ≤ 3초 → ≤ 5초로 완화(첫 표시 ≤ 500ms·Long Task ≤ 100ms 유지). 집단구타 화력 계산의 도구 근거 버그를 수정했다.
- **7차**: 기본 배지는 늘 스카프 없는 세트로 계산하고, 구애스카프는 조건 배지로만 표시한다. 옛 "스카프 아닌 최다 도구" 배지 설계(`non-scarf`)는 이것으로 대체됐다.
