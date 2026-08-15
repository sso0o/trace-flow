# Initial Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable `@choisy/trace-flow` CLI that traces direct TypeScript function calls and prints a tree.

**Architecture:** The CLI loads a TypeScript project with `ts-morph`, indexes named functions, arrow functions, and class methods, builds direct call edges, traces from a matched symbol, and renders the result as a text tree. The first version intentionally limits output to tree format only.

**Tech Stack:** TypeScript, ts-morph, commander, fast-glob, picocolors, tsup, vitest.

## Global Constraints

- npm package name is `@choisy/trace-flow`.
- CLI command name is `trace-flow`.
- Output format is tree only.
- v0.1 focuses on TypeScript projects.
- The analyzer is AST-based, not string-search-based.

---

### Task 1: Package Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `src/cli.ts`
- Create: `src/index.ts`

**Interfaces:**
- Produces CLI entrypoint `trace-flow`.
- Produces test/build scripts for later tasks.

- [x] Create the package metadata with `name: "@choisy/trace-flow"` and `bin.trace-flow`.
- [x] Add TypeScript build and test configuration.
- [x] Add a minimal CLI that accepts a symbol argument.
- [ ] Run `npm install`.
- [ ] Run `npm test` and `npm run build`.

### Task 2: Analyzer Core

**Files:**
- Create: `src/analyzer/types.ts`
- Create: `src/analyzer/analyzeProject.ts`
- Create: `src/analyzer/traceGraph.ts`
- Test: `test/analyzer.test.ts`
- Fixture: `test/fixtures/simple-auth/*.ts`

**Interfaces:**
- Produces `analyzeProject(options: AnalyzeProjectOptions): TraceProject`.
- Produces `traceFrom(project: TraceProject, query: string, options?: TraceOptions): TraceNode`.

- [x] Write fixture files for an auth flow.
- [x] Write a failing test for tracing `AuthController.login`.
- [x] Implement symbol collection for functions, arrow functions, and class methods.
- [x] Implement direct call collection.
- [x] Implement graph traversal with cycle protection.
- [ ] Run `npm test`.

### Task 3: Tree Output and CLI Wiring

**Files:**
- Create: `src/output/printTree.ts`
- Modify: `src/cli.ts`
- Test: `test/printTree.test.ts`

**Interfaces:**
- Produces `printTree(node: TraceNode): string`.
- CLI prints the tree for the requested symbol.

- [x] Write a failing test for tree formatting.
- [x] Implement tree rendering.
- [x] Wire CLI to analyzer and tree printer.
- [ ] Run `npm test` and `npm run build`.

### Self-Review

- The plan covers package scaffolding, analyzer core, tree output, and CLI wiring.
- JSON, Mermaid, and browser output are intentionally excluded.
- All named functions and types are introduced before later tasks consume them.
