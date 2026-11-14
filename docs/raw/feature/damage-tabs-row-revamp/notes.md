# Notes: 공격·방어 탭 판정 행 기능 확장과 상세 화면 가시성 개편(상대 기술 표시·설정, 화력 도구 행)

> 사람은 중립 역할어(`사용자`/`개발자`/`검증자`)로 지칭한다 — 개인 호칭·별명은 넣지 않는다
> (운영자 설정이 그렇게 부르라 해도). 상세: `harness/templates/examples/README.md` §5.

Date: 2026-11-13 Asia/Seoul
Unit type: feature
Status: draft

## 맥락

- 상위 단위 `sp-sweep-table`의 "카드·조건당 가장 센 기술 하나 + 랭크 행 + 선공기 행" 모델 위에서, 사용자가 행의 기술을 직접 고르게 하는 1단계와 상세 화면 가시성·화력 도구 행의 2단계로 나눈다(사용자 결정 2026-11-13: 한 단위 안에서 순차 진행, 2단계 요구는 1단계 결과를 본 뒤 PRD 개정으로 추가).
- 현재 구현 사실(조사 2026-11-13, 코드 읽기):
  - 가장 센 기술 고르기는 계획 시점 SP·성격의 단건 판정으로 1타 확률 → 최대 대미지 비율 → 후보 순서를 비교하고(`src/cards/schedule.ts` `stronger`/`candidateStates`), 양 끝·스윕·변형·극단·쌍 작업은 고른 후보와 선공기 후보에만 생긴다(`isKept`).
  - 조건 묶음은 기본 `['base']` + 랭크 수단마다 `['rank', owner, kind, id]`(`src/cards/plan.ts`, `types.ts`). 랭크 수단 자격은 `src/cards/rank.ts`(`TAB_MEANS_OWNERS`, `rankMoveAllowed`, 동시채용 하한).
  - 카드는 (탭, 출처, 상대, 분류, 묶음키|프리셋[, 열매]) 단위이고 다른 분류 기술은 행 없는 비교 전용 후보다. 화면 그룹은 분류가 다른 카드도 같은 배분 목록에 섞는다(`src/cards/groups.ts`).
  - 대표 행은 "변동 행 중 경계까지 SP 차가 가장 작은 행"(`src/cards/assemble.ts` `headlineOf`), 카드 `variable`은 아무 행이나 변동이면 참(`isVariable`) — 상위 ADR 53 문구("대표 행이 변화 있는 행")와 코드가 이미 다르다.
  - 배분 선택은 결과 패널 국소 상태, 배분 고정은 앱 상태(`pinnedBundles`, 계산 입력 아님·세대 불변).
  - 분산기는 코어 기본 2체 분산 보정이 이미 적용되며 UI 표기는 없다.
- 관련 불변식(`knowledge.mjs brief --area "SP 구간 표"`): INV-261113-attack-opp-no-item, INV-261113-rank-active-means-only, INV-261113-engine-boost-not-means — PRD R2의 수단 자격 규칙이 이 셋을 그대로 따른다.

## 결정

- 2026-11-13 사용자 결정(구조화 질문):
  - 랭크 행은 별도 행이 아니라 기술 선택 목록 항목으로 통합.
  - 기본값이 랭크 전·후 표로 정해지지 않으면(둘 다 변동, 미결 고정) 언제나 랭크업 전.
  - 직접 고른 기술은 SP·성격을 바꿔도 유지, 기본값 되돌리기 제공.
  - 다른 분류 기술을 고르면 그 분류 배분으로 전환.
  - 선공기도 목록으로 통합. 방어 탭에서 "상대가 S32·상승 성격(스카프 제외)이어도 내 현재 스피드를 추월할 수 없고 그 선공기가 변동"이면 선공기를 기본으로 우선(예: 대도각참 기습, 대쓰여너 아쿠아제트를 메가마폭시가 버티는가). 변동이 없으면 우선하지 않는다.
  - 목록 항목은 현재 판정 배지만(변동 표시 없음).
  - 내 방어 랭크업·위협 등은 이번 목록에서 빼고 후속에 별도 UI로.

## 레퍼런스

- Showdown 공식 데미지 계산기(Champions 포함): 기술은 4슬롯 목록에 대미지 %를 나란히 보이고 고르면 상세 결과가 나온다. 랭크는 능력치별 별도 선택기(+6…−6)로 기술과 분리된 입력이다. 기술+랭크를 한 목록에 합친 관례는 없다. https://calc.pokemonshowdown.com/champions.html , https://calc.pokemonshowdown.com/
- Pikalytics·vgccalc: 기술별 대미지 범위·1타 확률을 나란히 보이는 목록이 관례. https://www.pikalytics.com/damage-calculator , https://vgccalc.com/
- MunchStats: 고른 기술 하나를 상대 실사용 배분 전부에 사용률 가중으로 돌린다(배분 선택과 유사 개념). https://www.munchstats.com/calc/
- "+2 기술명" 단일 라벨은 커뮤니티 표기 관례(예: "+2 Sacred Sword")이고 계산기 UI 관례는 아니다. https://pokedexgenerator.com/guides/damage-calculator-tutorial
- 결론(→ PRD R2·R3): "현재 판정을 나란히 둔 기술 목록 + 고르면 반영"은 계산기 공통 관례라 그대로 따르고, 랭크를 항목에 접은 "+1 문포스" 목록은 이 앱 고유 표현이지만 커뮤니티 표기와 맞는다.

## 지식 후보

> 다음 작업자가 반복하면 안 될 함정(G)이나 지켜야 할 불변식(INV) 후보를 한 줄씩 적는다. 없으면 비워 둔다.

-

## 구현(1단계, 2026-11-13)

- 도메인: `src/cards/items.ts`(항목 키·단건 판정·변동 판정·정렬·기본 항목 결정 `resolveDefault`), `schedule.cardPending`(후보 단건 판정 → 기본 항목 결정에 필요한 변동 판정을 1·2단계로 → 보이는 항목만 전체 작업), `assemble.buildCard`(보이는 항목 행만, `items`/`shownItem`/`defaultItem`/`selected`), 같은 상대의 먼저 계산할 카드가 준비될 때까지 그 상대를 숨김(분류·기본 항목 깜박임 방지).
- 계획: 비교 전용 후보(`ProbeSpec`·`crossProbe`) 제거, 후보 `priority` = 우선도 > 0, 랭크 후 항목은 판정 능력치에 랭크가 들 때만, 계산 불가 행(하양허브 연속기·스냅샷에 없는 상대 기술)도 후보, 방어 카드 `speedEdge`(`outspeedsAtMax`), 방어 탭 랭크 수단 주인 = 상대만. `priority.ts`(선공기 행 조건) 삭제.
- 앱: `AppState.moveChoices`(계산 입력 아님) + `choose-move`/`reset-move`, 실행기 `setSelections`(선택 카드 = 수요 층 0, 세대 불변), `groups.defaultOption`(분류 기본 배분의 기본 항목을 견줘 처음 분류 결정)·`groupItems`, `MoveMenu`(간단행·상세 공용 드롭다운), "외 k행"·선공기 행 표지 제거.
- 이 단위에서 잡은 결함: 후보 없는 카드(손 계획) 경로에서 극단 필터·쌍 작업 누락, `buildCard` dangling else(필터 후보에 고정 판정 경로 호출) — 둘 다 수정.

## 테스트 대체 매핑(AC24)

| 바꾼/지운 테스트 | 대체한 PRD R7 "이전:" 항목 |
| --- | --- |
| `strongest.test.ts` 삭제 → `items.test.ts` 신설 | 카드·조건당 가장 센 기술 + 선공기 행(keptAsPriority), 분류를 가로지른 비교 전용 후보 |
| `priority.test.ts` 삭제(`priority.ts` 삭제) | 선공기 행 조건(약점·자속) → 방어 탭 선공기 우선(스피드·변동) |
| `assemble.test.ts` `moreRows` 검사 제거, 대표 행 테스트 재작성, 상대 단위 표시 게이트 | 외 k행, 랭크 행·선공기 행 별도 행, 대표 행이 카드 전 조건 행 기준 |
| `berries.test.ts` berryEngaged·berryIdle 테스트 → 보이는 항목 기준 열매 노출(직접 선택 포함) | 열매 노출 = 기본 조건 가장 센 기술 기준 |
| `plan.test.ts` 방어 탭 내 랭크업 2건, `rank.test.ts` 수단 주인 | 방어 탭 내 B·D 랭크업 행 |
| `acceptance.test.ts` 오라클 `corePicks`/`expectMatchesCore` 재작성(R4 독립 재구현), AC4·AC5·AC11·AC12×2 재작성 | 위 전부(분류 가로지름으로 카드가 빠짐, 랭크 행·오류 행이 카드 행에 있음) |
| `groups.test.ts`·`resultSort.test.ts` 픽스처 `moreRows` → `items`/`selected` | 외 k행 |
| `plan.test.ts` "상위 5 경계" → 기본 후보 규칙(5% 미만 제외·개수 무제한·상성/내 특성 반감·무효 제외·틀깨기·스킨·후보 없음 1위·스냅샷에 없는 기술) + 실데이터 리자몽메가Y·포푸니크 + 사용자 추가 기술, `defenseMoveIds` 호출 4건에 내 세트·상대 특성 인자 | R2 방어 탭 후보 "이전: 사용률 상위 5개"(`DEFENSE_MOVES` 폐기) |
| `plan.test.ts`·`acceptance.test.ts` AC11a 상대 셸암즈 2건: "상위 5 자리를 차지하지 않음" → 항목이 되지 않음, 내 세트를 독 1배 이상(풀 타입)으로 | R2 상위 5 자리 개념(개수 제한 폐기, 예시 세트 한카리아스는 독 반감이라 셸암즈가 후보가 아님) |
| `acceptance.test.ts` 오라클 `topAttackMoves` → `defenseCandidates`(R2 기본 후보 독립 재구현, 내 특성 보정 표 별도), AC5 "상위 5 안" → "기본 후보 안이고 기본 후보 전부가 항목" | R2 방어 탭 후보 "이전: 사용률 상위 5개" |
| e2e `product.spec.ts` "펼친 상세: 행·0~32 띠·예산 밖 칸 구분…(AC9·AC19)" → "공격 탭 행 0~32 띠(빗금 없음), 방어 탭 내구 합계 띠 0~64 하나(AC19·AC27~AC30)": 상세 기술 선택 버튼·방어 H 행 33칸·빗금·"다른 능력치에서 n 필요" 범례 검사 삭제, 공격 행 띠·AC27~AC30(400/1280 가로 스크롤 포함) 검사로 | PRD R9(상세 기술 선택·빗금·n 필요 문구 제거), R10(H·B/D 띠 → 합계 띠) |
| e2e `product.spec.ts` "내 포켓몬 종 변경 → 기술 사용률 상위 4개 미리 채우기" 2건: 기대 기술을 `moves.shares` 상위 4개 → 그 항목 `representative.set.moves`(메가 폼 항목 없으면 원종 항목) | PRD R11(처음 고른 종 = 대표 세트, AC31) |
| e2e `product.spec.ts` 기술 추가(AC26) 상세 `detail-move-pick` 이름 검사 → 상세 판정 행 `data-move` | PRD R9(상세 기술 선택 버튼 제거) |
| e2e `product.spec.ts` "랭크 행은 수단·점유율 근거를 보인다(AC8)" → 랭크 후 항목 행 제목이 "+n 기술" 라벨뿐(근거·종류 배지·% 없음, AC28) | PRD R7 취소선(랭크 근거 표시) → R9 |
| e2e `product.spec.ts` "펼친 상세: 왼쪽 배분 목록…" → 스피드 탭에서 같은 검사(상세 목록이 남은 유일한 탭) | PRD R9(공격·방어 상세 배분 목록 제거, 스피드 탭은 바꾸지 않음) |
| e2e `product.spec.ts` "직접 추가 폼 한 줄 — 드롭다운·상세 왼쪽 목록" → 드롭다운만(상세 폼 없음 확인), 상세 목록 3능력치 폭 검사 삭제(드롭다운 3능력치 검사는 유지) | PRD R9(직접 추가 폼은 간단행 배지에서만) |
| e2e `product.spec.ts` "묶음 기준 100% … 상세 왼쪽 목록도 항목 하나 + 추가 폼" → 상세에 배분 목록 없음 | PRD R9 |
| e2e `product.spec.ts` 직접 추가 고정 테스트의 "상세 왼쪽 목록도 같은 면 색·맨 앞·핀" 블록 삭제(같은 내용을 드롭다운에서 이미 검사) | PRD R9 |
| e2e `product.spec.ts` "관측 배분 핀 … 상세 목록 핀·Delete도 같다" → 핀 해제(원래 자리·비중·선택 유지·재계산 없음)를 드롭다운 핀으로 옮기고 상세 목록 Tab·Delete 키 검사 삭제 | PRD R9(상세 목록·Delete 키 단축 제거; 스피드 탭 목록은 그대로) |
| e2e `product.spec.ts` "상세 왼쪽 목록: 직접 추가 배분 radio에서 Delete 키, 또는 핀 클릭으로 고정 해제 = 삭제" 삭제(드롭다운 핀으로 직접 추가 배분 삭제는 직접 추가 고정 테스트가 검사) | PRD R9 |
| e2e `product-berry.spec.ts` 열매 행 고정: 상세 목록 핀 → 배지 메뉴 핀 | PRD R9 |
| e2e `product-layout.spec.ts` 방어 탭 띠 33칸 → 내구 합계 띠 65칸, "배분 메뉴·상세 배분 목록이 화면 안" → 스피드 탭에서 | PRD R10, R9 |
| e2e `product.spec.ts` AC15 "방어 H행·B/D행 쌍(상세 행 ≤ 2)" → 상세 판정 1개(쌍은 `data-pair` 합계 판정) | PRD R10(H·B/D 띠 → 합계 띠 하나) |
| e2e `product.spec.ts` 간단행 테스트의 방어 탭 상세 `row-target`("최소 H… B… / …+") 검사 → 합계 띠 범례의 "최소 H… B… / …" | PRD R10(범례 = 단계별 최소 분배, 상승 대안 형식 유지) |
| e2e `product.spec.ts` 지웠던 상세 왼쪽 목록 검사(직접 추가 radio Delete·핀 클릭 삭제, 관측 radio Delete 무시, 선택 항목 핀만 Tab 순서·Enter 고정·Delete 해제, 맨 위 직접 추가 폼) → 스피드 탭 상세 목록 테스트 2건으로 되살림 | PRD R9(스피드 탭 상세 목록은 그대로) |
| e2e `product-layout.spec.ts` "배분 메뉴가 화면 안"의 방어 탭 400px 검사 → 스피드 탭 이동과 별개로 방어 탭 400px 드롭다운 1건 되살림 | PRD R9(간단행 배지 드롭다운은 그대로) |
| `setDraft.test.ts` `speciesMoveFill` 테스트 삭제, e2e `product.spec.ts` 메가 폼을 떠날 때 도구 기대값 `''` → 기억 복원 값 | PRD R11(종 교체 = 대표 세트·종별 기억, `speciesDraft.test.ts`가 스톤 비우기를 대체) |
| `plan.test.ts` 실데이터 리자몽메가Y 기본 후보 `['weatherball', 'solarbeam', 'dragonpulse', 'hurricane']` → `['solarbeam', 'dragonpulse', 'hurricane']`(자기 가뭄으로 웨더볼이 불꽃 → 드래곤/땅 반감), `acceptance.test.ts` 오라클 `defenseCandidates`에 공격측 특성 웨더볼·대지의파동 타입 독립 구현(`oracleMoveType`) | PRD R12(이전: 대미지 판정·후보 배율에 날씨·필드 없음) |
| `plan.test.ts` "조건: 방어 탭도 순풍 없음" 행 조건 전체 일치 → 순풍(attacker/defender)만 비교(공격측 특성 날씨·필드가 합쳐질 수 있음) | PRD R12 |
| e2e `product.spec.ts` "메가는 종 검색에서 메가 폼으로…" `getByText('메가 폼 고정')` → 도구 칸 안내(`[id$="-mega-item"]`)만(메가 특성 고정 커밋 eb09c7b로 특성 칸에도 같은 안내가 생겨 strict 위반) | PRD R11 후속(메가 폼 특성 고정 표시) |
| `berries.test.ts` "방어·스피드 탭은 대표 도구를 그대로 쓰고 열매 변형이 없다" → 스피드 탭만 대표 도구, 방어 탭 기본 카드는 도구 없음, 두 탭 모두 반감열매 변형 없음 | PRD R14(이전: 방어 탭 래더 상대는 대표 세트·배분 가정의 도구 그대로) |
| `acceptance.test.ts` AC12 "상대 하양허브 + 껍질깨기(합성)" → 래더 상대는 기본 줄 도구 없음이라 계산 불가 항목 0, `WHITE_HERB_MULTIHIT` 검사는 하양허브 프리셋 목록 밖 타겟(같은 종·기술)으로 옮김 | PRD R14(이전: 래더 기본 줄에 대표 도구 하양허브 유지) |
| `state.test.ts` 표시 기준 키 목록·범위 밖 값 목록에 `powerItemShareMin` 추가 | PRD R14(화력 도구 최소(%) 신설) |
| `images.test.ts` 도구 아이콘 대상 = 반감열매 18종 → 반감열매 18종 + 화력 도구 22종(`ITEM_ICON_IDS`·매니페스트·LICENSE·고지 문구 갱신) | PRD R14(줄 표지에 도구 아이콘) |
| e2e `product-berry.spec.ts` "통계 설정 줄" 컨트롤 6 → 7, 폭 검사에 화력 도구 칸 추가 · `product-toolbar.spec.ts` "설정 영역 3줄" 통계 설정 컨트롤 순서·기본값·설명에 "화력 도구 최소(%)" 추가 | PRD R14(통계 설정에 화력 도구 최소(%)) |
| e2e `product.spec.ts` `ladderCards`가 도구 변형 행(`[data-berry]`)을 제외 · "같은 포켓몬은 탭마다 한 행만" 키에 변형 도구 포함 | PRD R14(방어 탭 화력 도구 줄 = 같은 상대의 별도 행) |
| e2e `product.spec.ts` `ladderCards` 제외 대상 `[data-berry]` → 방어 탭 화력 도구 행만(`[data-power-item]`), 공격 탭 반감열매 행은 이전 범위대로 포함 | PRD R14(화력 도구 줄만 새 별도 행) |
| `acceptance.test.ts` 오라클 `defenseCandidates`에서 내던지기 제외(포푸니크 AC5 기대 집합에서 `fling` 빠짐, 2026-11-13 결과 기록 "포푸니크 후보 = …내던지기"를 대체) | PRD R14(기본 줄 도구 없음 → 내던지기 실패라 후보·기술 추가 대상 아님) |
| e2e `product-power-item.spec.ts` 화력 도구 줄 표지 `/^생명의구슬 34\.\d%$/` → `/^생명의구슬$/`, 접근 가능한 이름 "… 생명의구슬 지닌 경우 (사용률 34.n%)" → "… 생명의구슬 지닌 경우"(%·"사용률" 없음) | PRD R14(이전: 줄 표지에 도구 이름·점유율), AC36 |
| `items.test.ts`·`executor.test.ts` 메뉴 항목 변동 판정(`cardExplore`·`setMenuCards`) 신설, e2e `product-move-variable.spec.ts` 신설(항목별 변동 표시 없음을 검사하던 기존 테스트는 없음) | PRD R3(이전: 항목별 변동 표시 없음, 2026-11-13), AC36 |

## 결정(빌드 중)

- 2026-11-13 사용자 결정: 분류 기본 배분 = 고정 배분 우선(PRD 용어 정의 그대로, 직접 추가 포함 고정 순 첫째). 이전 결정("기본 선택은 고정과 무관하게 관측 최고 점유율")을 대체한다 — `groups.categoryDefault`, `groups.test` 2건·`plan.test` 1건을 새 결정으로 갱신.

- 2026-11-13 사용자 화면 피드백: 기술 옆 ▾가 칩 테두리 밖에 떠 보이고 작다 → 칩 안 끝 SVG 화살표(배분 배지와 공용 `Caret`, 12px). 기본·선공·분산·직접 표지는 거추장스러워 제거(직접 고름은 되돌리기 항목과 접근 가능한 이름으로만). 기술 배지 호버의 보라 면·테두리가 칩보다 크게 깔림 → 버튼은 칩 크기 그대로 투명, 호버·펼침은 칩 타입 색을 진하게. 화살표가 칩 안에 들어가 기술 열이 0.4px 모자라 기술명이 말줄임됨 → 죽은 "외 k행" 열 최소폭(2.8rem)을 0으로, 기술 열 최대 12rem(1280·400px 공격·방어 30카드 잘림 0 확인).
- 2026-11-13 사용자 화면 피드백 2: 스크롤바가 카드를 침범 → 결과 목록 좌우 여백 0.6rem → 1.1rem(스크롤바 폭만큼, 좌우 대칭). 줄이 펼쳐진다는 표시로 줄 오른쪽 끝(빈 more 열)에 펼침 화살표(펼치면 위로). 같은 확인에서 1단계 결함 발견·수정: 기술 버튼(`.move-pick`)에 grid-area가 없어 자동 배치돼 400px에서 좁은 칸에 들어가 기술명이 잘림 → `grid-area: move`.
- 2026-11-13 1단계 개정 구현(PRD R2·R5·R8, ADR 결정 5): 코어 `effectivenessAgainst`(공격측 특성 타입 변화·기술 특례 × 내 특성 보정, 고정 대미지 기술은 무효만 0), `defenseMoveIds`(사용률 5%·나에게 1배 이상, 없으면 1위), `AppState.addedMoves`·`add-move`/`remove-move`(계산 입력), `set-draft` SP·성격 외 변경 시 직접 선택 해제, 기술 메뉴 아래 "기술 추가" 검색(`addableMoves`: 습득표 공격기 − 셸암즈 등 분류 가변 − 현재 후보)과 추가 항목 × 삭제. 적대 리뷰 반영: 포커스 되돌림 호출 순서, 기본 후보이기도 한 추가 기술의 추가 표시 제거, 고정 대미지 기술 배율, 픽스처 주석.
- 결과(2026-11-13): 단위 1029, 기능 e2e 92 통과. 예시 세트 한카리아스 기준 포푸니크 후보 = 인파이트·지옥찌르기·속이다·내던지기(독·바위 반감 기술 제외).
- 2026-11-14 2단계 구현(PRD R9·R10·R11, ADR 결정 6): `sumBand.ts`(쌍 최소 조합 → 합계 띠 칸·구간·최소 분배), 상세 `PairDetail`·`SumBand`, 상세 배분 목록·기술 버튼 제거(스피드 탭은 유지), `speciesDraft.ts`(대표 세트 → 초안), `switch-species`·`draftCache`·`speciesGeneration`, `ResultBox` 높이 붙잡기(재계산으로 카드가 숨는 동안만: 이전 세대 뷰 또는 새 세대 기본 항목 미확정)와 스크롤 앵커링 끄기.
- 리뷰 예외(기록): 현재 성격이 B/D 하락이거나 스냅샷에 없는 성격이면 내구 합계 띠를 무보정 변형 쌍 결과로 칠하고 안내만 붙인다(현재 성격 쌍은 추가 계산하지 않음). 두 행이 모두 변화 없음으로 정해졌는데 변형 오류가 있으면 상세는 "계산 불가", 간단행 배지는 그대로(후속). 종 교체 시 상태이상·랭크는 초안이 늘 none·0이라 넘어올 값이 없다.
- 2026-11-14 `speciesMoveFill`(종 교체 시 기술만 채우기) 삭제 — `representativeDraft`가 대체. 메가 폼에서 기억 없는 종으로 떠날 때 스톤 비우기는 `speciesDraft.test.ts` 단위 테스트로 덮는다(e2e `product.spec.ts` 메가 도구 기대값은 기억 복원으로 바뀜).
- 2026-11-14 R12 구현(ADR 결정 7): `src/core/fieldAbilities.ts`(`abilityWeather`·`abilityTerrain`·`withAttackerField`), 모든 대미지 판정 조건은 `PlanBuilder.damageConditions(공격측 해결 특성)` 경유(스피드 탭 제외), 웨더볼·대지의파동 타입(메가솔라 포함)을 `attackMoveType`·후보 배율·반감열매 판정에 반영. 캐시 키는 조건 전체라 자동. 예외: 델타스트림·강한 날씨는 엔진(champions) 미지원으로 각각 무시·쾌청/비 근사(현재 스냅샷에 해당 특성 없음). 대지의파동 타입은 공격측 접지를 보지 않는다(필드 설정 포켓몬이 모두 접지).
- 2026-11-14 R12 보강·R13: `fieldPriority`(그래스필드 그래스슬라이더 +1, 공격측 접지)·`psychicTerrainBlocks`(사이코필드 선공기 → 접지 대상 무효, 후보 배율 0)·`isGrounded`(엔진 규칙, 중력 제외), 방어 탭 `outspeedsAtMax`에 공격측 날씨·필드 조건. 표시 타입 `judgedMoveType`(판정 spec의 공격측 계산 특성·조건) → `RowView.moveType`·`ItemView.moveType`, 내 기술 칸은 `ui/moveType.ts`. 성능(2026-11-14): 공격 첫 카드 76ms·완료 624ms, 방어 18·587ms, 스피드 19·305ms, Long Task 0ms.
- 후속(리뷰 MEDIUM): acceptance 오라클이 `card.speedEdge`를 제품 값 그대로 써서 날씨 반영 스피드 비교를 독립 검증하지 않는다. 사이코필드 선공기 무효는 실데이터 해당 상대(벽기리F 속이다 0.75%)가 기준 미만이라 합성 단위 테스트로만 검증된다.
- 2026-11-14 R14 구현(ADR 결정 8): `powerItems.ts`(22종·보정 판정, 애크러뱃 제외), 방어 탭 기본 카드 도구 제거(메가 스톤 유지), 변형 카드는 반감열매 `berry` 필드 재사용, 툴바 "화력 도구 최소(%)"(`criteria.powerItemShareMin` 0.05), 화력 도구 아이콘 22개(Bulbagarden, 기존 열매 아이콘과 같은 출처·라이선스 문서 갱신). 배분 선택은 리뷰 지적으로 한때 기본·변형 줄 공유로 바꿨다가 사용자 결정(2026-11-14: "도구를 가정하고 배분을 다르게 가져가는 경우가 많다")으로 줄마다 따로(`[탭, 그룹 키]`)로 되돌림 — `selectionKey`·`variantCardId`·`sharedChoiceMissing` 삭제. 내던지기는 후보·추가 검색 제외(`HELD_ITEM_POWER_MOVES`). 성능(2026-11-14): 방어 처음 열기 첫 카드 35ms·완료 1104ms(이전 587ms, 카드 88 → 137), SP 놓기 32·451ms, Long Task 0ms.
- 후속(리뷰 LOW): 보이지 않을 분류의 변형 카드(예: 힘의머리띠 특수 분류)도 계획·계산한다 — 성능 여유가 줄면 계획 단계에서 거른다. 변형 줄 고정은 줄마다 따로(선택 전 기본값이 기본 줄과 다를 수 있음). 분류 가변 기술(셸암즈)의 힘의머리띠·박식안경 판정은 고정 분류 기준.

- 2026-11-14 기술 선택 목록 항목 "변동" 배지(R3 개정): `ItemView.variable`(itemVariability 노출), 실행기 메뉴 층(`setMenuCards`, 선택 다음·기본 카드 앞, 완료 판정 밖 — 진행률 숫자는 늘 수 있음). 메뉴 열기 → 배지 7~18ms. 화력 도구 줄 표지 점유율 제거. 성능: 공격 첫 카드 77ms·완료 777ms, 방어 35·1103ms, 스피드 20·465ms, Long Task 0ms.
- 후속(리뷰 LOW): 스윕 정보 없는 행은 변동 배지가 붙지 않을 수 있다(배지 없음으로 남음). 메뉴 카드 id 서명 직렬화 정리.

## 검증

- `npx tsc -b` 통과, `npm run lint` 통과, `npx vitest run` 1006/1006 통과(2026-11-13).
- 성능(AC21, `e2e/product-perf.spec.ts`, Chromium 156, 프로덕션 빌드, 상위 30, 10회): 공격 처음 열기 첫 카드 76ms·완료 619ms, 공격 SP 놓기 25·230ms, 방어 처음 열기 17·561ms, 방어 SP 놓기 25·251ms, 스피드 처음 열기 18·300ms, 스피드 SP 놓기 27·146ms, 계산 구간 Long Task 최대 0ms(전 시나리오). 계산 중 클릭 입력 지연 중앙값 9ms·최대 14ms, rAF 회차 중앙값 17ms. 이전 실측(공격 완료 약 880ms)보다 빨라졌다 — 고르지 않은 랭크 조건의 전체 작업이 빠졌기 때문.
- e2e: 기술 메뉴(기본 +2 도각참·선공 표시·↓/Esc·직접 고름·SP 변경 후 유지·되돌리기·배지 클릭이 펼침을 일으키지 않음), 상세 행 = 보이는 항목 하나, 랭크 후 항목(만나자마자·명상 파멸의빛 제외), 목록 밖 타겟 6장·특수 기본, 400/1280px 겹침 0.
- e2e 헬퍼 `findOverlaps`: 스크롤 박스 위 변에 붙은 sticky 줄 밑으로 가려진 부분도 보이지 않는 것으로 친다(창 맨 위 sticky만 보던 것을 넓힘 — 새 기술 버튼이 400px에서 진행 줄 밑으로 스크롤될 때의 오탐).
- 측정하지 않은 것: 선택 반응 시간(비기능 "선택 반응 ≤ 500ms") 전용 측정, 깜박임 e2e(AC22)·드래그 중 기본값 불변 e2e(AC10)·400/1280px 메뉴 스크린샷(AC23). 깜박임은 구조(기본 항목 확정 전 카드 미표시·상대 단위 게이트)와 단위 테스트(assemble 게이트)로만 봉인돼 있다.

## 후속 작업

- 2단계(같은 단위): 상세 화면 가시성 개편, 방어 탭 상대 화력 도구 있음/없음 행.
- 후속 단위: 방어 탭 내 방어 랭크업·위협 등 상대가 거는 하락의 별도 UI, 성묘 위력 조건, 등장 시 자기 강화 특성, 스피드 탭 개편.
