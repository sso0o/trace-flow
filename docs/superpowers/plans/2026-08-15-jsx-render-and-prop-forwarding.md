# JSX 컴포넌트 렌더링 + prop forwarding 추적 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `<BulkSaveToolbar onBulkOrder={handleBulkOrder} />`처럼 컴포넌트가 렌더링되며 콜백 prop이 전달되고, 그 컴포넌트 내부가 같은 prop을 (같은 이름으로든 다른 이름으로든) 자식에게 다시 넘기는 경우, `ProdPlanList -> BulkSaveToolbar -> handleBulkOrder`처럼 하나의 중첩된 트리로 나타나게 한다.

**Architecture:** 두 가지 새 에지 종류를 기존 평면 그래프에 추가한다 — (1) JSX 태그로 컴포넌트를 렌더링하면 생기는 "렌더링" 에지, (2) 컴포넌트가 자기 자신의 destructure된 prop을 그대로 자식에게 넘길 때, 그 컴포넌트의 모든 렌더링 지점을 역추적해서 최종 함수까지 연결하는 "forwarding" 에지. 둘 다 기존 `TraceEdge`(`{from, to}`) 그대로라 `traceFull`/`printTree`는 전혀 수정하지 않는다. `src/analyzer/analyzeProject.ts`가 커지는 것을 막기 위해 `scope.ts`(중첩 스코프 판정), `resolveTarget.ts`(심볼 해석), `jsxEdges.ts`(JSX 에지 전부)로 분리한다.

**Tech Stack:** TypeScript, ts-morph, vitest

## Global Constraints

- 두 새 에지 모두 `TraceEdge`에 `kind` 같은 구분 필드를 추가하지 않는다 — 기존 호출 에지와 완전히 동일한 `{from, to}` 형태.
- `src/analyzer/types.ts`, `src/analyzer/traceGraph.ts`, `src/output/printTree.ts`는 수정하지 않는다.
- forwarding은 destructure된 식별자(`{ onBulkOrder }`)만 지원한다. `props.onBulkOrder` 형태의 PropertyAccessExpression을 통한 forwarding은 이번 스펙의 비목표다.
- 여러 단계 forwarding(A → B → C → 실제 함수)을 지원해야 하며, 순환(컴포넌트가 서로를 렌더링하며 같은 prop을 되돌려주는 경우) 시 무한 루프 없이 안전하게 종료해야 한다.
- JSX 태그 이름이 소문자로 시작하면(`<div>`, `<button>` 등 HTML 기본 엘리먼트) 항상 무시한다 — React 관례상 대문자로 시작하는 태그만 사용자 컴포넌트를 가리킨다.
- 새 fixture의 `tsconfig.json`은 `"jsx": "react-jsx"`를 포함해야 한다.

---

### Task 1: `analyzeProject.ts`를 `scope.ts` / `resolveTarget.ts` / `jsxEdges.ts`로 분리 (순수 리팩터링)

**Files:**
- Create: `src/analyzer/scope.ts`
- Create: `src/analyzer/resolveTarget.ts`
- Create: `src/analyzer/jsxEdges.ts`
- Modify: `src/analyzer/analyzeProject.ts`

**Interfaces:**
- Consumes: 없음 (기존 코드 재구성)
- Produces:
  - `scope.ts`: `interface SymbolWithNode { symbol: TraceSymbol; node: Node; declarations: Node[] }`, `function isContainedIn(node: Node, container: Node): boolean`, `function computeIsNested(symbolsWithNodes: SymbolWithNode[], entry: SymbolWithNode): (candidate: Node) => boolean`
  - `resolveTarget.ts`: `interface ResolveContext { symbolsByName: Map<string, TraceSymbol[]>; symbolsByQualifiedName: Map<string, TraceSymbol>; symbolsByDeclaration: Map<string, TraceSymbol>; typeChecker?: TypeChecker }`, `function resolveExpressionTarget(expression: Node, context: ResolveContext, options?: { allowNameFallback?: boolean }): TraceSymbol | undefined`, `function getDeclarationKey(node: Node): string`
  - `jsxEdges.ts`: `function collectJsxEdges(symbolsWithNodes: SymbolWithNode[], context: ResolveContext): TraceEdge[]` — Task 1에서는 기존 JsxAttribute 직접 해석 로직만 그대로 옮긴 상태 (동작 변화 없음). Task 2, 3이 여기에 기능을 추가한다.

이 작업은 동작을 바꾸지 않는 순수 리팩터링이다. 기존 `resolveCallTarget` 래퍼는 제거하고, `analyzeProject.ts`의 `CallExpression` 루프가 `resolveExpressionTarget(call.getExpression(), context)`를 직접 호출하도록 인라인한다 (한 줄짜리 래퍼라 제거해도 동작은 동일).

- [ ] **Step 1: `src/analyzer/scope.ts` 작성**

```ts
import { Node } from "ts-morph";
import type { TraceSymbol } from "./types.js";

export interface SymbolWithNode {
  symbol: TraceSymbol;
  node: Node;
  declarations: Node[];
}

/** Whether `node` falls entirely within `container`'s span (used to attribute a call to its innermost enclosing function, not every ancestor function). */
export function isContainedIn(node: Node, container: Node): boolean {
  if (node.getSourceFile() !== container.getSourceFile()) return false;
  return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd();
}

/** Builds a predicate for `entry` that excludes any node already owned by a symbol nested inside `entry`'s own node, so a call/reference is attributed to its innermost enclosing symbol only. */
export function computeIsNested(
  symbolsWithNodes: SymbolWithNode[],
  entry: SymbolWithNode,
): (candidate: Node) => boolean {
  const nestedNodes = symbolsWithNodes
    .filter(
      (other) =>
        other.symbol.id !== entry.symbol.id &&
        other.node.getSourceFile() === entry.node.getSourceFile() &&
        isContainedIn(other.node, entry.node),
    )
    .map(({ node }) => node);

  return (candidate: Node) => nestedNodes.some((nestedNode) => isContainedIn(candidate, nestedNode));
}
```

- [ ] **Step 2: `src/analyzer/resolveTarget.ts` 작성**

```ts
import { Node, Symbol as MorphSymbol, TypeChecker } from "ts-morph";
import type { TraceSymbol } from "./types.js";

export interface ResolveContext {
  symbolsByName: Map<string, TraceSymbol[]>;
  symbolsByQualifiedName: Map<string, TraceSymbol>;
  symbolsByDeclaration: Map<string, TraceSymbol>;
  typeChecker?: TypeChecker;
}

export function resolveExpressionTarget(
  expression: Node,
  context: ResolveContext,
  options: { allowNameFallback?: boolean } = {},
): TraceSymbol | undefined {
  const symbolTarget = resolveSymbolTarget(expression.getSymbol(), context);
  if (symbolTarget) return symbolTarget;

  if (options.allowNameFallback === false) return undefined;

  if (Node.isIdentifier(expression)) {
    return context.symbolsByName.get(expression.getText())?.[0];
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const propertyName = expression.getName();
    const fullName = expression.getText();
    return context.symbolsByQualifiedName.get(fullName) ?? context.symbolsByName.get(propertyName)?.[0];
  }

  return undefined;
}

function resolveSymbolTarget(
  symbol: MorphSymbol | undefined,
  context: {
    symbolsByDeclaration: Map<string, TraceSymbol>;
    typeChecker?: TypeChecker;
  },
): TraceSymbol | undefined {
  if (!symbol) return undefined;

  const alias = context.typeChecker?.getAliasedSymbol(symbol);
  const candidates = alias ? [alias, symbol] : [symbol];

  for (const candidate of candidates) {
    for (const declaration of candidate.getDeclarations()) {
      const target = context.symbolsByDeclaration.get(getDeclarationKey(declaration));
      if (target) return target;
    }
  }

  return undefined;
}

export function getDeclarationKey(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
}
```

- [ ] **Step 3: `src/analyzer/jsxEdges.ts` 작성 (기존 JsxAttribute 로직만 이동, 신규 기능 없음)**

```ts
import { Node, SyntaxKind } from "ts-morph";
import type { TraceEdge } from "./types.js";
import type { SymbolWithNode } from "./scope.js";
import { computeIsNested } from "./scope.js";
import { resolveExpressionTarget, type ResolveContext } from "./resolveTarget.js";

export function collectJsxEdges(symbolsWithNodes: SymbolWithNode[], context: ResolveContext): TraceEdge[] {
  const edges: TraceEdge[] = [];

  for (const entry of symbolsWithNodes) {
    const { node, symbol } = entry;
    const isNested = computeIsNested(symbolsWithNodes, entry);

    for (const attribute of node.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (isNested(attribute)) continue;

      const initializer = attribute.getInitializer();
      if (!initializer || !Node.isJsxExpression(initializer)) continue;

      const expression = initializer.getExpression();
      if (!expression) continue;
      if (!Node.isIdentifier(expression) && !Node.isPropertyAccessExpression(expression)) continue;

      const allowNameFallback = expression.getType().getCallSignatures().length > 0;
      const target = resolveExpressionTarget(expression, context, { allowNameFallback });
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }
  }

  return edges;
}
```

- [ ] **Step 4: `src/analyzer/analyzeProject.ts`를 새 모듈을 쓰도록 수정**

전체 파일을 다음으로 교체한다:

```ts
import path from "node:path";
import fg from "fast-glob";
import { Node, Project, SourceFile, SyntaxKind } from "ts-morph";
import type { AnalyzeProjectOptions, TraceEdge, TraceProject, TraceSymbol, SymbolKind } from "./types.js";
import type { SymbolWithNode } from "./scope.js";
import { computeIsNested } from "./scope.js";
import { getDeclarationKey, resolveExpressionTarget, type ResolveContext } from "./resolveTarget.js";
import { collectJsxEdges } from "./jsxEdges.js";

export async function analyzeProject(options: AnalyzeProjectOptions): Promise<TraceProject> {
  const project = createProject(options);
  await addSourceFiles(project, options.cwd);

  const symbolsWithNodes = project
    .getSourceFiles()
    .flatMap((sourceFile) => collectSymbols(sourceFile, options.cwd));
  const symbols = symbolsWithNodes.map(({ symbol }) => symbol);
  const edges = collectEdges(symbolsWithNodes);

  return { symbols, edges };
}

function createProject(options: AnalyzeProjectOptions): Project {
  const tsconfigPath = options.tsconfigPath ?? path.join(options.cwd, "tsconfig.json");

  return new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: true,
  });
}

async function addSourceFiles(project: Project, cwd: string): Promise<void> {
  const files = await fg(["**/*.ts", "**/*.tsx", "!node_modules/**", "!dist/**"], {
    cwd,
    absolute: true,
  });

  project.addSourceFilesAtPaths(files);
}

function collectSymbols(sourceFile: SourceFile, cwd: string): SymbolWithNode[] {
  const symbols: SymbolWithNode[] = [];

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const name = declaration.getName();
    if (!name) continue;
    symbols.push(toSymbolWithNode(declaration, name, name, "function", sourceFile, cwd));
  }

  for (const variable of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = variable.getInitializer();
    if (!initializer) continue;

    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      const name = variable.getName();
      symbols.push(toSymbolWithNode(initializer, name, name, "arrow", sourceFile, cwd, [variable, initializer]));
      continue;
    }

    if (Node.isObjectLiteralExpression(initializer)) {
      const objectName = variable.getName();

      for (const property of initializer.getProperties()) {
        if (!Node.isPropertyAssignment(property)) continue;

        const propertyInitializer = property.getInitializer();
        if (!propertyInitializer) continue;
        if (!Node.isArrowFunction(propertyInitializer) && !Node.isFunctionExpression(propertyInitializer)) continue;

        const name = property.getName();
        symbols.push(
          toSymbolWithNode(propertyInitializer, name, `${objectName}.${name}`, "method", sourceFile, cwd, [
            property,
            propertyInitializer,
          ]),
        );
      }
    }
  }

  for (const classDeclaration of sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    const className = classDeclaration.getName();
    if (!className) continue;

    for (const method of classDeclaration.getMethods()) {
      const name = method.getName();
      symbols.push(toSymbolWithNode(method, name, `${className}.${name}`, "method", sourceFile, cwd));
    }
  }

  return symbols;
}

function toSymbolWithNode(
  node: Node,
  name: string,
  qualifiedName: string,
  kind: SymbolKind,
  sourceFile: SourceFile,
  cwd: string,
  declarations = [node],
): SymbolWithNode {
  const line = sourceFile.getLineAndColumnAtPos(node.getStart()).line;
  const filePath = path.relative(cwd, sourceFile.getFilePath());
  const id = `${filePath}:${qualifiedName}:${line}`;

  return {
    node,
    declarations,
    symbol: {
      id,
      name,
      qualifiedName,
      filePath,
      line,
      kind,
    },
  };
}

function collectEdges(symbolsWithNodes: SymbolWithNode[]): TraceEdge[] {
  const symbolsByName = new Map<string, TraceSymbol[]>();
  const symbolsByQualifiedName = new Map<string, TraceSymbol>();
  const symbolsByDeclaration = new Map<string, TraceSymbol>();
  const typeChecker = symbolsWithNodes[0]?.node.getProject().getTypeChecker();

  for (const { symbol } of symbolsWithNodes) {
    addSymbolName(symbolsByName, symbol.name, symbol);
    addSymbolName(symbolsByName, symbol.qualifiedName, symbol);
    symbolsByQualifiedName.set(symbol.qualifiedName, symbol);
  }

  for (const { declarations, symbol } of symbolsWithNodes) {
    for (const declaration of declarations) {
      symbolsByDeclaration.set(getDeclarationKey(declaration), symbol);
    }
  }

  const context: ResolveContext = { symbolsByName, symbolsByQualifiedName, symbolsByDeclaration, typeChecker };
  const edges: TraceEdge[] = [];

  for (const entry of symbolsWithNodes) {
    const { node, symbol } = entry;
    const isNested = computeIsNested(symbolsWithNodes, entry);

    for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isNested(call)) continue;

      const target = resolveExpressionTarget(call.getExpression(), context);
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }
  }

  edges.push(...collectJsxEdges(symbolsWithNodes, context));

  return dedupeEdges(edges);
}

function addSymbolName(map: Map<string, TraceSymbol[]>, name: string, symbol: TraceSymbol): void {
  const symbols = map.get(name) ?? [];
  symbols.push(symbol);
  map.set(name, symbols);
}

function dedupeEdges(edges: TraceEdge[]): TraceEdge[] {
  const seen = new Set<string>();

  return edges.filter((edge) => {
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

- [ ] **Step 5: 전체 테스트 스위트로 회귀 없는지 확인**

Run: `npm test`
Expected: 기존 11개 테스트 전부 PASS (동작 변화가 없는 순수 리팩터링이므로 결과가 그대로 유지되어야 함)

- [ ] **Step 6: 타입체크 + 빌드 확인**

Run: `npm run typecheck`
Expected: 에러 없음

Run: `npm run build`
Expected: 성공

- [ ] **Step 7: Commit**

```bash
git add src/analyzer/scope.ts src/analyzer/resolveTarget.ts src/analyzer/jsxEdges.ts src/analyzer/analyzeProject.ts
git commit -m "$(cat <<'EOF'
Split analyzeProject.ts into scope/resolveTarget/jsxEdges modules

Pure refactor — no behavior change. analyzeProject.ts was growing
past 275 lines; this separates symbol/call-graph collection from
JSX-specific edge resolution so the next two tasks (render edges,
prop-forwarding edges) land in a file scoped to JSX concerns only.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: JSX 렌더링 에지 (`<Component />` 태그 → 컴포넌트 심볼)

**Files:**
- Create: `test/fixtures/jsx-component-render/tsconfig.json`
- Create: `test/fixtures/jsx-component-render/Toolbar.tsx`
- Create: `test/fixtures/jsx-component-render/Page.tsx`
- Modify: `test/analyzer.test.ts`
- Modify: `src/analyzer/jsxEdges.ts`

**Interfaces:**
- Consumes: `resolveExpressionTarget`, `ResolveContext` (Task 1), `computeIsNested`, `SymbolWithNode` (Task 1)
- Produces: `collectJsxEdges`가 반환하는 `TraceEdge[]`에 렌더링 에지가 포함됨. Task 3이 이 태그 해석 로직(`getJsxTagElements`)을 재사용한다.

- [ ] **Step 1: fixture 작성**

`test/fixtures/jsx-component-render/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["*.tsx"]
}
```

`test/fixtures/jsx-component-render/Toolbar.tsx`:

```tsx
export function Toolbar() {
  return <div>toolbar</div>;
}
```

`test/fixtures/jsx-component-render/Page.tsx`:

```tsx
import { Toolbar } from "./Toolbar.js";

export function Page() {
  return <Toolbar />;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/analyzer.test.ts` 상단 fixture 경로 상수 옆에 추가:

```ts
const jsxComponentRenderFixturePath = path.join(import.meta.dirname, "fixtures/jsx-component-render");
```

`describe("analyzeProject", ...)` 블록의 마지막 테스트 다음에 추가:

```ts
  test("traces a component rendered as a JSX tag", async () => {
    const project = await analyzeProject({ cwd: jsxComponentRenderFixturePath });
    const trace = traceFrom(project, "Page");

    expect(trace.symbol.qualifiedName).toBe("Page");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toEqual(["Toolbar"]);
  });
```

- [ ] **Step 3: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/analyzer.test.ts -t "rendered as a JSX tag"`
Expected: FAIL — `trace.children`가 `[]`라서 `["Toolbar"]`와 불일치 (아직 렌더링 에지를 만들지 않음)

- [ ] **Step 4: `jsxEdges.ts`에 렌더링 에지 추가**

`src/analyzer/jsxEdges.ts`를 다음으로 교체한다:

```ts
import { JsxOpeningElement, JsxSelfClosingElement, Node, SyntaxKind } from "ts-morph";
import type { TraceEdge } from "./types.js";
import type { SymbolWithNode } from "./scope.js";
import { computeIsNested } from "./scope.js";
import { resolveExpressionTarget, type ResolveContext } from "./resolveTarget.js";

type JsxTagElement = JsxOpeningElement | JsxSelfClosingElement;

export function collectJsxEdges(symbolsWithNodes: SymbolWithNode[], context: ResolveContext): TraceEdge[] {
  const edges: TraceEdge[] = [];

  for (const entry of symbolsWithNodes) {
    const { node, symbol } = entry;
    const isNested = computeIsNested(symbolsWithNodes, entry);

    for (const attribute of node.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (isNested(attribute)) continue;

      const initializer = attribute.getInitializer();
      if (!initializer || !Node.isJsxExpression(initializer)) continue;

      const expression = initializer.getExpression();
      if (!expression) continue;
      if (!Node.isIdentifier(expression) && !Node.isPropertyAccessExpression(expression)) continue;

      const allowNameFallback = expression.getType().getCallSignatures().length > 0;
      const target = resolveExpressionTarget(expression, context, { allowNameFallback });
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }

    for (const element of getJsxTagElements(node)) {
      if (isNested(element)) continue;

      const tagName = element.getTagNameNode();
      if (!Node.isIdentifier(tagName) && !Node.isPropertyAccessExpression(tagName)) continue;
      if (/^[a-z]/.test(tagName.getText())) continue;

      const allowNameFallback = tagName.getType().getCallSignatures().length > 0;
      const target = resolveExpressionTarget(tagName, context, { allowNameFallback });
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }
  }

  return edges;
}

function getJsxTagElements(node: Node): JsxTagElement[] {
  return [
    ...node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
}
```

`/^[a-z]/.test(tagName.getText())`는 `<div>`, `<button>` 같은 HTML 기본 엘리먼트를 건너뛴다 — React 관례상 소문자로 시작하는 태그는 항상 host element지 사용자 컴포넌트가 아니다.

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/analyzer.test.ts`
Expected: 모든 테스트 PASS (Step 2에서 추가한 테스트 포함)

- [ ] **Step 6: 전체 검증**

Run: `npm test`
Expected: 전체 PASS

Run: `npm run typecheck`
Expected: 에러 없음

Run: `npm run build`
Expected: 성공

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/jsx-component-render src/analyzer/jsxEdges.ts test/analyzer.test.ts
git commit -m "$(cat <<'EOF'
Track JSX component rendering as edges

<Toolbar /> now creates a "renders" edge from the enclosing symbol
to Toolbar, using the same resolution already used for callback
props. This is the building block Task 3 needs to nest a forwarded
callback's trace under the component that renders it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: prop forwarding 에지 (컴포넌트 경계를 넘는 콜백 전달)

**Files:**
- Create: `test/fixtures/jsx-prop-forwarding/tsconfig.json`
- Create: `test/fixtures/jsx-prop-forwarding/productionOrderService.ts`
- Create: `test/fixtures/jsx-prop-forwarding/handleBulkOrder.ts`
- Create: `test/fixtures/jsx-prop-forwarding/Button.tsx`
- Create: `test/fixtures/jsx-prop-forwarding/BulkSaveToolbar.tsx`
- Create: `test/fixtures/jsx-prop-forwarding/ProdPlanList.tsx`
- Create: `test/fixtures/jsx-prop-forwarding-multi-level/tsconfig.json`
- Create: `test/fixtures/jsx-prop-forwarding-multi-level/Root.tsx`
- Create: `test/fixtures/jsx-prop-forwarding-multi-level/Middle.tsx`
- Create: `test/fixtures/jsx-prop-forwarding-multi-level/Leaf.tsx`
- Create: `test/fixtures/jsx-prop-forwarding-cycle/tsconfig.json`
- Create: `test/fixtures/jsx-prop-forwarding-cycle/CycleA.tsx`
- Create: `test/fixtures/jsx-prop-forwarding-cycle/CycleB.tsx`
- Modify: `test/analyzer.test.ts`
- Modify: `src/analyzer/jsxEdges.ts`

**Interfaces:**
- Consumes: `resolveExpressionTarget`, `ResolveContext`, `SymbolWithNode`, `computeIsNested`, `isContainedIn` (Task 1), `getJsxTagElements` (Task 2, becomes shared within this file)
- Produces: `collectJsxEdges`가 반환하는 `TraceEdge[]`에 forwarding 에지가 포함됨. 이 태스크로 이 기능은 완성된다 — 이후 태스크 없음.

이 알고리즘은 이미 스크래치 스크립트로 3가지 시나리오(1단계 forwarding, 2단계 forwarding, 순환) 전부 실제 ts-morph로 검증되었다 — 아래 코드는 그 검증된 로직을 그대로 옮긴 것이다.

- [ ] **Step 1: 기본 forwarding fixture 작성 (실제 보고된 버그 재현)**

`test/fixtures/jsx-prop-forwarding/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["*.ts", "*.tsx"]
}
```

`test/fixtures/jsx-prop-forwarding/productionOrderService.ts`:

```ts
export const productionOrderService = {
  bulkCreateProductionOrders: (id: string) => `saved:${id}`,
};
```

`test/fixtures/jsx-prop-forwarding/handleBulkOrder.ts`:

```ts
import { productionOrderService } from "./productionOrderService.js";

export function handleBulkOrder() {
  return productionOrderService.bulkCreateProductionOrders("1");
}
```

`test/fixtures/jsx-prop-forwarding/Button.tsx`:

```tsx
export function Button(props: { onClick: () => void }) {
  return <button onClick={props.onClick}>Go</button>;
}
```

`test/fixtures/jsx-prop-forwarding/BulkSaveToolbar.tsx`:

```tsx
import { Button } from "./Button.js";

interface Props {
  onBulkOrder: () => void;
}

export const BulkSaveToolbar = ({ onBulkOrder }: Props) => {
  return <Button onClick={onBulkOrder} />;
};
```

`test/fixtures/jsx-prop-forwarding/ProdPlanList.tsx`:

```tsx
import { BulkSaveToolbar } from "./BulkSaveToolbar.js";
import { handleBulkOrder } from "./handleBulkOrder.js";

export function ProdPlanList() {
  return <BulkSaveToolbar onBulkOrder={handleBulkOrder} />;
}
```

- [ ] **Step 2: 2단계 forwarding fixture 작성**

`test/fixtures/jsx-prop-forwarding-multi-level/tsconfig.json`: Step 1과 동일 내용 (`"include": ["*.tsx"]`로 충분).

`test/fixtures/jsx-prop-forwarding-multi-level/Leaf.tsx`:

```tsx
export const Leaf = ({ onGo }: { onGo: () => void }) => {
  return <button onClick={onGo}>Go</button>;
};
```

`test/fixtures/jsx-prop-forwarding-multi-level/Middle.tsx`:

```tsx
import { Leaf } from "./Leaf.js";

export const Middle = ({ onSave }: { onSave: () => void }) => {
  return <Leaf onGo={onSave} />;
};
```

`test/fixtures/jsx-prop-forwarding-multi-level/Root.tsx`:

```tsx
import { Middle } from "./Middle.js";

export function Root() {
  function handleSave() {}
  return <Middle onSave={handleSave} />;
}
```

- [ ] **Step 3: 순환 forwarding fixture 작성 (무한 루프 방지 확인용)**

`test/fixtures/jsx-prop-forwarding-cycle/tsconfig.json`: Step 1과 동일 내용.

`test/fixtures/jsx-prop-forwarding-cycle/CycleA.tsx`:

```tsx
import { CycleB } from "./CycleB.js";

export const CycleA = ({ onGo }: { onGo: () => void }) => {
  return <CycleB onGo={onGo} />;
};
```

`test/fixtures/jsx-prop-forwarding-cycle/CycleB.tsx`:

```tsx
import { CycleA } from "./CycleA.js";

export const CycleB = ({ onGo }: { onGo: () => void }) => {
  return <CycleA onGo={onGo} />;
};
```

- [ ] **Step 4: 실패하는 테스트 작성**

`test/analyzer.test.ts` 상단에 fixture 경로 상수 추가:

```ts
const jsxPropForwardingFixturePath = path.join(import.meta.dirname, "fixtures/jsx-prop-forwarding");
const jsxPropForwardingMultiLevelFixturePath = path.join(
  import.meta.dirname,
  "fixtures/jsx-prop-forwarding-multi-level",
);
const jsxPropForwardingCycleFixturePath = path.join(import.meta.dirname, "fixtures/jsx-prop-forwarding-cycle");
```

`describe("analyzeProject", ...)` 블록 끝에 추가:

```ts
  test("traces a callback prop forwarded through a child component under a different name", async () => {
    const project = await analyzeProject({ cwd: jsxPropForwardingFixturePath });
    const trace = traceFrom(project, "ProdPlanList");

    expect(trace.symbol.qualifiedName).toBe("ProdPlanList");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toContain("BulkSaveToolbar");

    const toolbar = trace.children.find((child) => child.symbol.qualifiedName === "BulkSaveToolbar");
    expect(toolbar?.children.map((child) => child.symbol.qualifiedName)).toContain("handleBulkOrder");
  });

  test("traces a callback prop forwarded through two levels of components", async () => {
    const project = await analyzeProject({ cwd: jsxPropForwardingMultiLevelFixturePath });
    const trace = traceFrom(project, "Root");

    const middle = trace.children.find((child) => child.symbol.qualifiedName === "Middle");
    expect(middle).toBeDefined();

    const leaf = middle?.children.find((child) => child.symbol.qualifiedName === "Leaf");
    expect(leaf).toBeDefined();

    expect(leaf?.children.map((child) => child.symbol.qualifiedName)).toContain("handleSave");
  });

  test("does not hang or produce a spurious edge on a forwarding cycle", async () => {
    const project = await analyzeProject({ cwd: jsxPropForwardingCycleFixturePath });

    const cycleA = project.symbols.find((symbol) => symbol.qualifiedName === "CycleA");
    const cycleB = project.symbols.find((symbol) => symbol.qualifiedName === "CycleB");
    expect(cycleA).toBeDefined();
    expect(cycleB).toBeDefined();

    expect(project.edges).toContainEqual({ from: cycleA!.id, to: cycleB!.id });
    expect(project.edges).toContainEqual({ from: cycleB!.id, to: cycleA!.id });
    expect(project.edges).toHaveLength(2);
  });

  test("traces a forwarded prop to the caller in the full tree", async () => {
    const project = await analyzeProject({ cwd: jsxPropForwardingFixturePath });
    const [trace, ...rest] = traceFull(project, "handleBulkOrder");

    expect(rest).toHaveLength(0);
    expect(trace.symbol.qualifiedName).toBe("ProdPlanList");
    expect(trace.children[0]?.symbol.qualifiedName).toBe("BulkSaveToolbar");
    expect(trace.children[0]?.children[0]?.symbol.qualifiedName).toBe("handleBulkOrder");
  });
```

- [ ] **Step 5: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/analyzer.test.ts -t "forward"`
Expected: 4개 테스트 모두 FAIL (forwarding 로직이 아직 없어서 `BulkSaveToolbar`/`Middle`/`Leaf` 아래에 아무것도 안 잡히고, cycle 테스트는 `project.edges`에 렌더링 에지 2개만 있어야 하는데 이건 이미 통과할 수 있음 — 나머지 3개는 확실히 FAIL)

- [ ] **Step 6: `jsxEdges.ts`에 forwarding 에지 추가**

`src/analyzer/jsxEdges.ts`를 다음으로 교체한다:

```ts
import {
  JsxAttribute,
  JsxOpeningElement,
  JsxSelfClosingElement,
  Node,
  SyntaxKind,
} from "ts-morph";
import type { TraceEdge, TraceSymbol } from "./types.js";
import type { SymbolWithNode } from "./scope.js";
import { computeIsNested, isContainedIn } from "./scope.js";
import { resolveExpressionTarget, type ResolveContext } from "./resolveTarget.js";

type JsxTagElement = JsxOpeningElement | JsxSelfClosingElement;

interface RenderSite {
  element: JsxTagElement;
  fromEntry: SymbolWithNode;
  componentId: string;
}

export function collectJsxEdges(symbolsWithNodes: SymbolWithNode[], context: ResolveContext): TraceEdge[] {
  const edges: TraceEdge[] = [];
  const renderSites = collectRenderSites(symbolsWithNodes, context);

  for (const site of renderSites) {
    if (site.componentId === site.fromEntry.symbol.id) continue;
    edges.push({ from: site.fromEntry.symbol.id, to: site.componentId });
  }

  for (const entry of symbolsWithNodes) {
    const { node, symbol } = entry;
    const isNested = computeIsNested(symbolsWithNodes, entry);

    for (const attribute of node.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (isNested(attribute)) continue;

      const expression = getAttributeValueExpression(attribute);
      if (!expression) continue;

      const allowNameFallback = expression.getType().getCallSignatures().length > 0;
      const direct = resolveExpressionTarget(expression, context, { allowNameFallback });
      if (direct) {
        if (direct.id !== symbol.id) edges.push({ from: symbol.id, to: direct.id });
        continue;
      }

      const ownProp = getOwnPropName(expression, node);
      if (!ownProp) continue;

      const forwarded = resolveForwardedProp(entry, ownProp, renderSites, context, new Set());
      if (forwarded && forwarded.id !== symbol.id) {
        edges.push({ from: symbol.id, to: forwarded.id });
      }
    }
  }

  return edges;
}

function collectRenderSites(symbolsWithNodes: SymbolWithNode[], context: ResolveContext): RenderSite[] {
  const sites: RenderSite[] = [];

  for (const entry of symbolsWithNodes) {
    const isNested = computeIsNested(symbolsWithNodes, entry);

    for (const element of getJsxTagElements(entry.node)) {
      if (isNested(element)) continue;

      const tagName = element.getTagNameNode();
      if (!Node.isIdentifier(tagName) && !Node.isPropertyAccessExpression(tagName)) continue;
      if (/^[a-z]/.test(tagName.getText())) continue;

      const allowNameFallback = tagName.getType().getCallSignatures().length > 0;
      const target = resolveExpressionTarget(tagName, context, { allowNameFallback });
      if (!target) continue;

      sites.push({ element, fromEntry: entry, componentId: target.id });
    }
  }

  return sites;
}

function getJsxTagElements(node: Node): JsxTagElement[] {
  return [
    ...node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
}

function getAttributeValueExpression(attribute: JsxAttribute): Node | undefined {
  const initializer = attribute.getInitializer();
  if (!initializer || !Node.isJsxExpression(initializer)) return undefined;

  const expression = initializer.getExpression();
  if (!expression) return undefined;
  if (!Node.isIdentifier(expression) && !Node.isPropertyAccessExpression(expression)) return undefined;

  return expression;
}

/** If `expression` is one of `enclosingNode`'s own destructured parameter properties, returns its local name (e.g. the `onBulkOrder` in `({ onBulkOrder }: Props) => ...`). */
function getOwnPropName(expression: Node, enclosingNode: Node): string | undefined {
  if (!Node.isIdentifier(expression)) return undefined;

  const declaration = expression.getSymbol()?.getDeclarations()[0];
  if (!declaration || !Node.isBindingElement(declaration)) return undefined;
  if (!isContainedIn(declaration, enclosingNode)) return undefined;

  const bindingPattern = declaration.getParent();
  if (!Node.isObjectBindingPattern(bindingPattern)) return undefined;
  if (!Node.isParameterDeclaration(bindingPattern.getParent())) return undefined;

  return declaration.getName();
}

/**
 * Resolves a prop forwarded through `componentEntry` by looking at every place `componentEntry`
 * is rendered, reading the matching attribute there, and recursing if that value is itself a
 * forwarded prop. `visited` (keyed by componentId:propName) guards against forwarding cycles.
 */
function resolveForwardedProp(
  componentEntry: SymbolWithNode,
  propName: string,
  renderSites: RenderSite[],
  context: ResolveContext,
  visited: Set<string>,
): TraceSymbol | undefined {
  const key = `${componentEntry.symbol.id}:${propName}`;
  if (visited.has(key)) return undefined;
  visited.add(key);

  for (const site of renderSites) {
    if (site.componentId !== componentEntry.symbol.id) continue;

    const attribute = site.element
      .getAttributes()
      .find((attr): attr is JsxAttribute => Node.isJsxAttribute(attr) && attr.getNameNode().getText() === propName);
    if (!attribute) continue;

    const expression = getAttributeValueExpression(attribute);
    if (!expression) continue;

    const allowNameFallback = expression.getType().getCallSignatures().length > 0;
    const direct = resolveExpressionTarget(expression, context, { allowNameFallback });
    if (direct) return direct;

    const forwardedPropName = getOwnPropName(expression, site.fromEntry.node);
    if (!forwardedPropName) continue;

    const forwarded = resolveForwardedProp(site.fromEntry, forwardedPropName, renderSites, context, visited);
    if (forwarded) return forwarded;
  }

  return undefined;
}
```

이 코드는 스크래치 검증에서 그대로 확인된 로직이다:
- `Page -> Toolbar` (렌더링), `Page -> handleBulkOrder` (직접), `Toolbar -> handleBulkOrder` (1단계 forwarding)
- `Root -> Middle -> Leaf` (렌더링 체인) + `Middle -> handleSave`, `Leaf -> handleSave` (2단계 재귀 forwarding)
- `CycleA -> CycleB`, `CycleB -> CycleA` (렌더링)만 생기고, forwarding 쪽은 `visited` 집합에 막혀 추가 에지 없이 정상 종료

- [ ] **Step 7: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/analyzer.test.ts`
Expected: 모든 테스트 PASS (Step 4에서 추가한 4개 포함)

- [ ] **Step 8: 전체 검증**

Run: `npm test`
Expected: 전체 PASS, 회귀 없음

Run: `npm run typecheck`
Expected: 에러 없음

Run: `npm run build`
Expected: 성공

- [ ] **Step 9: Commit**

```bash
git add test/fixtures/jsx-prop-forwarding test/fixtures/jsx-prop-forwarding-multi-level test/fixtures/jsx-prop-forwarding-cycle src/analyzer/jsxEdges.ts test/analyzer.test.ts
git commit -m "$(cat <<'EOF'
Trace callback props forwarded through child components

A component that receives a callback prop and re-passes it (under
the same or a different name) to a child component previously broke
the trace at that boundary: <BulkSaveToolbar onBulkOrder={handleFn} />
followed by <Button onClick={onBulkOrder} /> inside BulkSaveToolbar
had no way to connect onBulkOrder back to handleFn, since onBulkOrder
is just a parameter name, not a declared symbol.

collectJsxEdges now recognizes when a JSX attribute value is the
enclosing component's own destructured prop, and resolves it by
searching every render site of that component for the same-named
attribute, recursing through multiple levels of forwarding with a
cycle guard.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-Implementation

- 버전 bump + npm publish는 이 플랜 범위 밖이다. 세 태스크 모두 완료되고 리뷰가 끝난 뒤 별도로 처리한다.
- README에 "렌더링/forwarding 에지도 `->`로 표시된다"는 내용을 추가할지는 이 플랜에서 결정하지 않는다 (기존 콜백 prop 기능의 README 반영 여부와 함께 나중에 판단).

## Addendum: 실제 구현 중 발견된 이슈 (Task 3 코드와의 차이)

이 플랜의 Task 3에 적은 `resolveForwardedProp`/`collectJsxEdges` 코드는 스크래치 검증에서 1단계 forwarding만 테스트하고 작성되었다. 실제 구현(및 병행해서 진행된 작업)을 통합하며 2단계 이상 forwarding에서 다음 문제를 추가로 발견했다:

- 중간 컴포넌트(예: `Middle`)가 자신의 prop을 자식(`Leaf`)에게 다시 넘기기만 하는 경우에도, `Middle` 자신의 forwarding 검색이 **독립적으로** 성공해서 `Middle -> handleSave` 에지를 만들어버린다. 동시에 `Leaf`도 자신의 forwarding 검색으로 `Leaf -> handleSave`를 만든다. 둘 다 "정확한" 에지이지만, `Root -> Middle -> Leaf -> handleSave` 체인이 이미 같은 사실을 더 정확하게 표현하고 있어서 `traceFull`이 트리 2개(`Root->Middle->Leaf->handleSave`와 `Root->Middle->handleSave`)를 반환하게 된다.
- 최초 수정(직접 매칭된 attribute만 "consumed"로 표시)은 1단계 forwarding(예: `BulkSaveToolbar`)에서는 충분했지만 이 2단계 케이스는 못 잡았다.

**실제 적용된 수정**: `resolveForwardedProp`가 검색 중 "들여다본" 모든 attribute(직접 풀렸든, 더 깊이 재귀했든 상관없이)를 `visitedAsSupplier` 집합에 기록한다. forwarding 에지들은 전부 계산을 마친 뒤 한 번에 결정하는데, 이때 그 에지를 촉발한 attribute 자신이 `visitedAsSupplier`에 있으면 (= 더 깊은 컴포넌트의 검색이 그 attribute를 "공급자"로 이미 지나갔으면) 그 얕은 에지는 버린다. 같은 집합을 기존의 "직접 매칭 에지" 억제에도 재사용한다.

세 가지 fixture(`jsx-prop-forwarding` 1단계, `jsx-prop-forwarding-multi-level` 2단계, `jsx-prop-forwarding-cycle` 순환)와 `test/analyzer.test.ts`의 `traceFull` 기반 단일-루트 검증 테스트로 이 수정을 고정했다. 최종 `src/analyzer/jsxEdges.ts`가 실제 소스 오브 트루스이며, 이 문서의 Task 3 코드 블록은 최초 설계 의도를 보여주는 기록으로 남겨둔다.
