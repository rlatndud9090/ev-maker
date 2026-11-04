# Project Agent Guide

This project adopts the shared LLM Project Harness as a Claude Code plugin
(enabled in `.claude/settings.json`; the `.harness.json` flag marks adoption).
Answer in Korean by default unless the user asks otherwise.

## Project Intent

'포켓몬 챔피언스' 대전 기준으로, 대회 등에서 사용된 파티 정보(포켓몬 6마리의 도구·기술 4개·성격)를
입력받아 각 포켓몬의 최적 노력치 분배를 제안하는 AI 웹앱이다.

- 사전 데이터: 현재 메타의 포켓몬 사용률과 포켓몬별 도구/기술/성격/노력치 통계, 고사용률 파티 조합.
- 핵심 차별점: 개별 포켓몬 간 내구/스피드 조정에 그치지 않고, 고사용률 '파티 조합'들과의 매치업 상성을
  분석해 특정 노력치 세팅이 매치업 상성을 유의미하게 바꾸는 케이스를 탐색하고, 그 근거로 추천한다.
- 통계 데이터 출처와 대미지 계산 도구는 아직 미정이며 조사 대상이다.

## Harness Entry Points

1. Read `docs/wiki/index.md` first when starting project work.
2. The harness plugin injects the shared session-start protocol at session start.
3. Follow only raw links relevant to the task.
4. Use `/lph:next-feature` for open-ended product work.
5. Keep product-specific decisions in this project's `docs/raw/` and `docs/wiki/`.
6. Before editing code, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/harness/knowledge.mjs" brief --paths <files…>` to see the project knowledge (gotchas/invariants) for those files.

The shared harness workflow (PRD/ADR, raw/wiki, approval gate, commit protocol) is
provided entirely by the plugin — there is no local engine copy to maintain.
