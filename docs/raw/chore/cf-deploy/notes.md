---
title: "Cloudflare Workers 정적 배포 설정"
date: "2026-11-20"
unit_type: chore
---

# Chore: Cloudflare Workers 정적 배포 설정

## 맥락

PokePaste 연동·요약 탭 작업에 앞서 앱을 공개 주소로 먼저 띄운다. 앱은 Vite 정적 빌드(서버 없음)라 Cloudflare Workers 정적 자산으로 그대로 올라간다.

## 범위

- 범위에 포함: `wrangler.jsonc`(Worker 이름 `ev-maker`, 자산 `./dist`, SPA 폴백), `wrangler` devDependency 고정(4.165.0), `npm run deploy` 스크립트, `.wrangler/` 무시
- 범위에서 제외: 사용자 정의 도메인, PokePaste CORS 프록시(필요해지면 같은 Worker에 스크립트를 붙인다), 프리뷰 배포 정책

## 결정

- 배포 경로는 CF 대시보드 Git 연동(Workers Builds)으로 한다. main에 들어간 커밋을 CF가 빌드·배포한다. 사용자가 대시보드에서 레포를 연결한다.
- 빌드 명령 `npm run build`, 배포 명령 `npx wrangler deploy`. 설정은 레포의 `wrangler.jsonc`가 정본이다.
- Pages 대신 Workers 정적 자산을 쓴다. 나중에 PokePaste처럼 CORS가 없는 외부 원천을 읽을 때 같은 Worker에 프록시를 붙일 수 있다.

## 검증

- `npm run build` 성공, dist 8.8M(5MB 넘는 단일 파일 없음 — Workers 자산 파일당 25MiB 한도 안)
- `npx wrangler deploy --dry-run`: 자산 402개 인식, 바인딩 없음
