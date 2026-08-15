# README Update Design

**Date:** 2026-08-15
**Topic:** Friendlier README for npm package users

## Goal

Update the README to be more welcoming and informative for npm package users, while keeping it concise.

## Target Audience

npm package users who run the tool via `npx` or global install. Not targeting contributors.

## Approach

Two separate files with language toggle links at the top:
- `README.md` — English (primary, shown on npm and GitHub by default)
- `README.ko.md` — Korean

Each file links to the other at the very top.

## README.md Structure & Content

```
[한국어](README.ko.md)

# trace-flow

> Trace TypeScript code execution flow and print it as a tree.

## Installation

No installation needed — run directly with npx:

    npx @choisy/trace-flow <symbol>

Or install globally:

    npm install -g @choisy/trace-flow

## Usage

    trace-flow <symbol> [options]

| Option                 | Default       | Description                                          |
|------------------------|---------------|------------------------------------------------------|
| `-p, --project <path>` | current dir   | Project root to analyze                              |
| `-d, --depth <number>` | `10`          | Maximum trace depth                                  |
| `--calls-only`         | —             | Show only what the symbol calls (no callers)         |

## Examples

### Full trace (default)

Shows the full call chain — top-most caller down through everything the symbol calls:

    npx @choisy/trace-flow AuthController.login

Output:

    handleLoginRequest (src/router.ts:3)
      -> AuthController.login (src/authController.ts:4)
        -> AuthService.login (src/authService.ts:5)
          -> findUserByEmail (src/userRepository.ts:1)
          -> issueToken (src/tokenService.ts:1)

### Calls only

    npx @choisy/trace-flow AuthController.login --calls-only
```

## README.ko.md Structure & Content

```
[English](README.md)

# trace-flow

> TypeScript 코드의 실행 흐름을 추적해서 트리로 출력합니다.

## 설치

별도 설치 없이 npx로 바로 실행할 수 있어요:

    npx @choisy/trace-flow <심볼>

전역 설치:

    npm install -g @choisy/trace-flow

## 사용법

    trace-flow <심볼> [옵션]

| 옵션                    | 기본값           | 설명                                      |
|-------------------------|------------------|-------------------------------------------|
| `-p, --project <경로>`  | 현재 디렉터리    | 분석할 프로젝트 루트                      |
| `-d, --depth <숫자>`    | `10`             | 최대 추적 깊이                            |
| `--calls-only`          | —                | 호출하는 쪽 없이, 이 심볼이 호출하는 것만 표시 |

## 예시

### 전체 추적 (기본)

최상위 호출자부터 심볼이 호출하는 모든 것까지 전체 체인을 보여줍니다:

    npx @choisy/trace-flow AuthController.login

출력:

    handleLoginRequest (src/router.ts:3)
      -> AuthController.login (src/authController.ts:4)
        -> AuthService.login (src/authService.ts:5)
          -> findUserByEmail (src/userRepository.ts:1)
          -> issueToken (src/tokenService.ts:1)

### 호출만 보기

    npx @choisy/trace-flow AuthController.login --calls-only
```

## Out of Scope

- Screenshots or GIFs
- FAQ section
- Contributing guide
- Comparison with other tools
