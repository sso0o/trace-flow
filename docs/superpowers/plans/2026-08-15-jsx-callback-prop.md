# JSX 콜백 prop 호출 추적 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `<Button onClick={handleBulkOrder} />`처럼 `CallExpression` 없이 JSX 속성값으로 넘겨진 bare 함수 참조를, 일반 호출 에지와 동일한 `TraceEdge`로 인식시킨다.

**Architecture:** `src/analyzer/analyzeProject.ts`의 `collectEdges`에서 기존 `CallExpression` 순회와 나란히 `SyntaxKind.JsxAttribute` 순회를 추가한다. 대상 심볼 해석 로직(`resolveCallTarget` 내부 구현)을 `resolveExpressionTarget`으로 추출해 두 순회에서 공유한다. 타입이나 출력 포맷은 변경하지 않는다 — prop 참조도 일반 호출 에지와 동일하게 `->`로 표시된다.

**Tech Stack:** TypeScript, ts-morph, vitest

## Global Constraints

- 범위는 JSX 속성(`JsxAttribute`)에 한정한다. 일반 함수 인자로 넘겨지는 콜백(`setTimeout(fn, ...)`, `array.map(fn)` 등)은 이번 스펙에 포함하지 않는다.
- `TraceEdge` 타입에 `kind` 같은 구분 필드를 추가하지 않는다. JSX prop 참조 에지는 일반 호출 에지와 구조적으로 완전히 동일해야 한다.
- `traceGraph.ts`, `printTree.ts`, `TraceEdge`/`TraceSymbol` 등 `src/analyzer/types.ts`는 수정하지 않는다.
- 새 fixture의 `tsconfig.json`에는 반드시 `"jsx": "react-jsx"`를 포함한다 (`.tsx` 파일을 ts-morph가 JSX 구문으로 파싱하기 위해 필요).

---

### Task 1: `resolveCallTarget`에서 `resolveExpressionTarget` 추출 (순수 리팩터링)

**Files:**
- Modify: `src/analyzer/analyzeProject.ts:192-238`

**Interfaces:**
- Consumes: 없음 (기존 코드 재구성)
- Produces: `resolveExpressionTarget(expression: Node, context: ResolveContext): TraceSymbol | undefined` — Task 2가 JSX 속성값 해석에 사용
- Produces: `ResolveContext` 타입 (기존에 인라인 객체 타입으로 3번 반복되던 `{ symbolsByName, symbolsByQualifiedName, symbolsByDeclaration, typeChecker }` 형태를 이름 붙임)

이 작업은 동작을 바꾸지 않는다. `resolveCallTarget`이 `call.getExpression()`으로 얻은 표현식을 넘겨서 하던 심볼 해석 로직을, 표현식을 직접 받는 별도 함수로 뽑아낸다. 이렇게 하면 Task 2에서 `CallExpression`이 아닌 JSX 속성값에도 동일한 해석 로직을 재사용할 수 있다.

- [ ] **Step 1: `resolveCallTarget`을 `resolveExpressionTarget` 위임 형태로 리팩터링**

`src/analyzer/analyzeProject.ts`에서 아래 블록을 찾는다:

```ts
function resolveCallTarget(
  call: CallExpression,
  context: {
    symbolsByName: Map<string, TraceSymbol[]>;
    symbolsByQualifiedName: Map<string, TraceSymbol>;
    symbolsByDeclaration: Map<string, TraceSymbol>;
    typeChecker?: TypeChecker;
  },
): TraceSymbol | undefined {
  const expression = call.getExpression();
  const symbolTarget = resolveSymbolTarget(expression.getSymbol(), context);
  if (symbolTarget) return symbolTarget;

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
```

다음으로 교체한다:

```ts
interface ResolveContext {
  symbolsByName: Map<string, TraceSymbol[]>;
  symbolsByQualifiedName: Map<string, TraceSymbol>;
  symbolsByDeclaration: Map<string, TraceSymbol>;
  typeChecker?: TypeChecker;
}

function resolveCallTarget(call: CallExpression, context: ResolveContext): TraceSymbol | undefined {
  return resolveExpressionTarget(call.getExpression(), context);
}

function resolveExpressionTarget(expression: Node, context: ResolveContext): TraceSymbol | undefined {
  const symbolTarget = resolveSymbolTarget(expression.getSymbol(), context);
  if (symbolTarget) return symbolTarget;

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
```

`resolveSymbolTarget`과 `getDeclarationKey`는 그대로 둔다 (변경 없음).

- [ ] **Step 2: 전체 테스트 스위트로 회귀 없는지 확인**

Run: `npm test`
Expected: 기존 테스트 전부 PASS (동작 변화가 없는 순수 리팩터링이므로 기존 테스트 결과가 그대로 유지되어야 함)

- [ ] **Step 3: 타입체크 확인**

Run: `npm run typecheck`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/analyzer/analyzeProject.ts
git commit -m "$(cat <<'EOF'
Extract resolveExpressionTarget from resolveCallTarget

Pure refactor — no behavior change. Prepares call-target resolution
to be reused for JSX attribute values in addition to CallExpressions.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: JSX 속성값으로 넘겨진 함수 참조를 호출 에지로 수집

**Files:**
- Create: `test/fixtures/jsx-callback-prop/tsconfig.json`
- Create: `test/fixtures/jsx-callback-prop/Button.tsx`
- Create: `test/fixtures/jsx-callback-prop/OrderPage.tsx`
- Modify: `tsconfig.json:14` (루트 프로젝트 자체 typecheck에서 fixture 제외)
- Modify: `test/analyzer.test.ts`
- Modify: `src/analyzer/analyzeProject.ts` (`collectEdges` 함수, Task 1 이후 상태)

**Interfaces:**
- Consumes: `resolveExpressionTarget(expression: Node, context: ResolveContext)`, `ResolveContext` (Task 1에서 생성)
- Produces: `collectEdges`가 반환하는 `TraceEdge[]`에 JSX 속성값 참조로 인한 에지가 포함됨 (이후 태스크 없음 — 이 작업이 기능의 끝)

- [ ] **Step 1: fixture용 tsconfig.json 작성**

`test/fixtures/jsx-callback-prop/tsconfig.json`:

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

- [ ] **Step 2: Button 컴포넌트 fixture 작성**

`test/fixtures/jsx-callback-prop/Button.tsx`:

```tsx
export function Button(props: { onClick: () => void; label: string }) {
  return <button onClick={props.onClick}>{props.label}</button>;
}
```

- [ ] **Step 3: OrderPage 컴포넌트 fixture 작성**

`test/fixtures/jsx-callback-prop/OrderPage.tsx`:

```tsx
import { Button } from "./Button.js";

export function handleBulkOrder(): void {
  console.log("bulk order submitted");
}

export function OrderPage() {
  return <Button onClick={handleBulkOrder} label="Submit bulk order" />;
}
```

- [ ] **Step 4: 루트 tsconfig에서 fixture 디렉터리 제외**

루트 `tsconfig.json`은 `"include": ["src", "test", ...]`로 `test/` 전체를 이 프로젝트 자체의 `tsc --noEmit`(`npm run typecheck`) 대상에 포함시키고 있다. `test/fixtures/**`는 트레이스 대상 예제 코드일 뿐 이 도구가 타입 안전성을 보장해야 하는 코드가 아니며, 각 fixture는 `analyzeProject`가 사용하는 자기 자신의 `tsconfig.json`(방금 만든 `"jsx": "react-jsx"` 포함)으로 별도 파싱된다. 루트 프로젝트에는 `jsx` 컴파일러 옵션이 없으므로, 제외하지 않으면 새 `.tsx` fixture 때문에 `npm run typecheck`이 "Cannot use JSX unless the '--jsx' flag is provided" 에러로 깨진다.

`tsconfig.json`을 다음과 같이 수정한다 (기존 `include`는 그대로 두고 `exclude`만 추가):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["test/fixtures"]
}
```

vitest는 `vitest.config.ts`의 `include: ["test/**/*.test.ts"]`로 테스트 파일을 찾기 때문에 이 exclude는 테스트 실행에 영향을 주지 않는다.

- [ ] **Step 5: 실패하는 테스트 작성**

`test/analyzer.test.ts` 상단의 fixture 경로 상수들 옆에 추가:

```ts
const jsxCallbackPropFixturePath = path.join(import.meta.dirname, "fixtures/jsx-callback-prop");
```

`describe("analyzeProject", ...)` 블록 안, 기존 마지막 테스트("traces a call to an arrow function assigned as an object literal property") 다음에 추가:

```ts
  test("traces a function passed as a JSX callback prop reference", async () => {
    const project = await analyzeProject({ cwd: jsxCallbackPropFixturePath });
    const trace = traceFrom(project, "OrderPage");

    expect(trace.symbol.qualifiedName).toBe("OrderPage");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toEqual(["handleBulkOrder"]);
  });
```

`describe("traceFull", ...)` 블록 안, 기존 마지막 테스트("behaves like traceFrom when the symbol has no callers") 다음에 추가:

```ts
  test("finds a caller that only passes the symbol as a JSX callback prop", async () => {
    const project = await analyzeProject({ cwd: jsxCallbackPropFixturePath });
    const [trace, ...rest] = traceFull(project, "handleBulkOrder");

    expect(rest).toHaveLength(0);
    expect(trace.symbol.qualifiedName).toBe("OrderPage");
    expect(trace.children[0]?.symbol.qualifiedName).toBe("handleBulkOrder");
  });
```

- [ ] **Step 6: 테스트 실행해서 실패 확인**

Run: `npx vitest run test/analyzer.test.ts`
Expected: 새로 추가한 두 테스트가 FAIL. `traces a function passed as a JSX callback prop reference`는 `trace.children`가 `[]`라서 `["handleBulkOrder"]`와 불일치. `finds a caller that only passes the symbol as a JSX callback prop`는 `handleBulkOrder`에 caller가 없어서 `trace.symbol.qualifiedName`이 `"OrderPage"`가 아니라 `"handleBulkOrder"`로 나옴 (caller 체인이 비어서 `traceFull`이 `traceFrom`과 동일하게 동작).

- [ ] **Step 7: `collectEdges`에 JSX 속성값 순회 추가**

`src/analyzer/analyzeProject.ts`의 `collectEdges` 함수를 찾는다. 현재(Task 1 이후) 구조는 다음과 같다:

```ts
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

  const edges: TraceEdge[] = [];

  for (const { node, symbol } of symbolsWithNodes) {
    const nestedNodes = symbolsWithNodes
      .filter(
        (other) =>
          other.symbol.id !== symbol.id &&
          other.node.getSourceFile() === node.getSourceFile() &&
          isContainedIn(other.node, node),
      )
      .map(({ node: nestedNode }) => nestedNode);

    for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (nestedNodes.some((nestedNode) => isContainedIn(call, nestedNode))) continue;

      const target = resolveCallTarget(call, {
        symbolsByName,
        symbolsByQualifiedName,
        symbolsByDeclaration,
        typeChecker,
      });
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }
  }

  return dedupeEdges(edges);
}
```

다음으로 교체한다 (컨텍스트 객체를 루프 밖으로 한 번만 만들고, 중첩 여부 체크를 헬퍼로 공유하고, JSX 속성 순회를 추가):

```ts
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

  for (const { node, symbol } of symbolsWithNodes) {
    const nestedNodes = symbolsWithNodes
      .filter(
        (other) =>
          other.symbol.id !== symbol.id &&
          other.node.getSourceFile() === node.getSourceFile() &&
          isContainedIn(other.node, node),
      )
      .map(({ node: nestedNode }) => nestedNode);

    const isNested = (candidate: Node) => nestedNodes.some((nestedNode) => isContainedIn(candidate, nestedNode));

    for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isNested(call)) continue;

      const target = resolveCallTarget(call, context);
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }

    for (const attribute of node.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (isNested(attribute)) continue;

      const initializer = attribute.getInitializer();
      if (!initializer || !Node.isJsxExpression(initializer)) continue;

      const expression = initializer.getExpression();
      if (!expression) continue;
      if (!Node.isIdentifier(expression) && !Node.isPropertyAccessExpression(expression)) continue;

      const target = resolveExpressionTarget(expression, context);
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }
  }

  return dedupeEdges(edges);
}
```

`SyntaxKind`, `Node`는 이미 파일 상단에서 import되어 있으므로 추가 import는 필요 없다.

- [ ] **Step 8: 테스트 실행해서 통과 확인**

Run: `npx vitest run test/analyzer.test.ts`
Expected: 모든 테스트 PASS (Task 2 Step 5에서 추가한 두 테스트 포함)

- [ ] **Step 9: 전체 검증 (테스트 전체 + 빌드 + 타입체크)**

Run: `npm test`
Expected: 전체 PASS, 회귀 없음

Run: `npm run typecheck`
Expected: 에러 없음 (Step 4에서 `test/fixtures`를 exclude했으므로 새 `.tsx` fixture로 인한 jsx 플래그 에러 없음)

Run: `npm run build`
Expected: 성공 (tsup으로 ESM + d.ts 생성)

- [ ] **Step 10: Commit**

```bash
git add test/fixtures/jsx-callback-prop tsconfig.json src/analyzer/analyzeProject.ts test/analyzer.test.ts
git commit -m "$(cat <<'EOF'
Track function references passed as JSX callback props

<Button onClick={handleFn} /> has no CallExpression, so
handleFn never showed up in the caller tree even though it's
wired up via the prop. collectEdges now also walks JsxAttribute
values and resolves bare identifier/property-access references
to known symbols the same way it resolves call targets.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-Implementation

- `README.md`와 Notion 로드맵의 "이후" 섹션 업데이트는 이 플랜의 범위 밖이다 — 구현 완료 후 별도로 처리한다.
