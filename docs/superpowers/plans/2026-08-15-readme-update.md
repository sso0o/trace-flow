# README Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal README.md with a friendlier English version and add a new Korean README.ko.md, both linked to each other at the top.

**Architecture:** Two standalone markdown files — `README.md` (English, primary) and `README.ko.md` (Korean) — each with a language toggle link at the very top. No shared infrastructure; both files are self-contained.

**Tech Stack:** Markdown only. No build step needed.

## Global Constraints

- Keep content concise — no GIFs, screenshots, FAQ, or contributing guide
- Options table must reflect actual CLI flags from `src/cli.ts`: `-p/--project`, `-d/--depth`, `--calls-only`
- Example output must match the existing example in the old README exactly

---

### Task 1: Update README.md (English)

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: `README.md` with language toggle + Installation + Usage + Examples sections

- [ ] **Step 1: Replace README.md with the following content**

```markdown
[한국어](README.ko.md)

# trace-flow

> Trace TypeScript code execution flow and print it as a tree.

## Installation

No installation needed — run directly with npx:

```bash
npx @choisy/trace-flow <symbol>
```

Or install globally:

```bash
npm install -g @choisy/trace-flow
```

## Usage

```bash
trace-flow <symbol> [options]
```

| Option | Default | Description |
|---|---|---|
| `-p, --project <path>` | current dir | Project root to analyze |
| `-d, --depth <number>` | `10` | Maximum trace depth |
| `--calls-only` | — | Show only what the symbol calls (no callers) |

## Examples

### Full trace (default)

Shows the full call chain — top-most caller down through everything the symbol calls:

```bash
npx @choisy/trace-flow AuthController.login
```

```
handleLoginRequest (src/router.ts:3)
  -> AuthController.login (src/authController.ts:4)
    -> AuthService.login (src/authService.ts:5)
      -> findUserByEmail (src/userRepository.ts:1)
      -> issueToken (src/tokenService.ts:1)
```

### Calls only

```bash
npx @choisy/trace-flow AuthController.login --calls-only
```
```

- [ ] **Step 2: Verify the file looks correct**

```bash
cat README.md
```

Expected: file starts with `[한국어](README.ko.md)` and ends with the `--calls-only` example.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README.md with friendlier English content"
```

---

### Task 2: Create README.ko.md (Korean)

**Files:**
- Create: `README.ko.md`

**Interfaces:**
- Consumes: nothing (mirrors Task 1 structure in Korean)
- Produces: `README.ko.md` with language toggle + 설치 + 사용법 + 예시 sections

- [ ] **Step 1: Create README.ko.md with the following content**

```markdown
[English](README.md)

# trace-flow

> TypeScript 코드의 실행 흐름을 추적해서 트리로 출력합니다.

## 설치

별도 설치 없이 npx로 바로 실행할 수 있어요:

```bash
npx @choisy/trace-flow <심볼>
```

전역 설치:

```bash
npm install -g @choisy/trace-flow
```

## 사용법

```bash
trace-flow <심볼> [옵션]
```

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `-p, --project <경로>` | 현재 디렉터리 | 분석할 프로젝트 루트 |
| `-d, --depth <숫자>` | `10` | 최대 추적 깊이 |
| `--calls-only` | — | 호출하는 쪽 없이, 이 심볼이 호출하는 것만 표시 |

## 예시

### 전체 추적 (기본)

최상위 호출자부터 심볼이 호출하는 모든 것까지 전체 체인을 보여줍니다:

```bash
npx @choisy/trace-flow AuthController.login
```

```
handleLoginRequest (src/router.ts:3)
  -> AuthController.login (src/authController.ts:4)
    -> AuthService.login (src/authService.ts:5)
      -> findUserByEmail (src/userRepository.ts:1)
      -> issueToken (src/tokenService.ts:1)
```

### 호출만 보기

```bash
npx @choisy/trace-flow AuthController.login --calls-only
```
```

- [ ] **Step 2: Verify the file looks correct**

```bash
cat README.ko.md
```

Expected: file starts with `[English](README.md)` and ends with the `--calls-only` example.

- [ ] **Step 3: Commit**

```bash
git add README.ko.md
git commit -m "docs: add Korean README (README.ko.md)"
```
