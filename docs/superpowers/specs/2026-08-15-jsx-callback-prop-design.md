# JSX 콜백 prop 호출 추적 — 설계

## 배경

trace-flow의 `collectEdges`는 현재 `CallExpression` 노드만 순회해서 호출 관계 에지를 만든다. 그런데 React 패턴에서는 함수가 실제로 호출되지 않고 참조만 넘겨지는 경우가 흔하다.

```tsx
<Button onClick={handleBulkOrder} />
```

여기서 `handleBulkOrder`는 `CallExpression`으로 나타나지 않기 때문에, 이 코드를 감싸는 컴포넌트(예: `OrderPage`)에서 `handleBulkOrder`로 가는 에지가 생기지 않는다. 그 결과 `trace-flow handleBulkOrder`로 caller 트리를 조회해도 `OrderPage`가 나타나지 않는다.

이 이슈는 실사용 프로젝트(frontend, SHMT-MES)에서 발견되었으며, Notion 로드맵에 "콜백 prop으로 전달된 함수 호출 추적"으로 등록되어 있다. import/export 해석 개선과는 별개의 문제다.

## 목표

JSX 속성값으로 bare 함수 참조(`Identifier` 또는 `PropertyAccessExpression`, `CallExpression`이 아닌 것)가 넘어가고 그 참조가 trace-flow가 알고 있는 심볼로 resolve되면, 이를 일반 호출 에지와 동일하게 취급한다.

## 비목표

- JSX 외의 위치(일반 함수 인자로 넘겨지는 콜백 등, 예: `setTimeout(fn, 1000)`, `array.map(fn)`)는 포함하지 않는다. 오탐 위험이 크고 Notion 문서의 "80% 실용적 정확도" 방향과 맞지 않는다.
- 에지 종류를 구분하는 타입(`kind: "call" | "reference"`)은 추가하지 않는다. 출력 트리에서 일반 호출과 시각적으로 구분하지 않고 동일한 `->`로 표시한다.
- prop이 자식 컴포넌트 내부에서 실제로 호출되는지(`onClick()` 등)는 추적하지 않는다. "누가 이 함수를 참조로 넘겼는가"만 잡는다.

## 설계

### 변경 위치

[src/analyzer/analyzeProject.ts](../../../src/analyzer/analyzeProject.ts)의 `collectEdges` 함수.

### 동작

각 심볼의 노드를 순회하는 기존 루프 안에서, `CallExpression` 탐색과 나란히 `SyntaxKind.JsxAttribute` 디스크립턴트도 탐색한다. 중첩된 심볼 스코프에 속한 속성은 기존 `nestedNodes` 제외 로직을 그대로 재사용해 건너뛴다(호출 귀속 로직과 동일한 원칙 — 가장 안쪽 심볼에 귀속).

각 `JsxAttribute`에 대해:

1. `initializer`가 `JsxExpression`인지 확인한다. 아니면(문자열 리터럴 속성 등) 건너뛴다.
2. 내부 `expression`을 가져온다. `Identifier` 또는 `PropertyAccessExpression`이 아니면 건너뛴다 — 이렇게 하면 인라인 화살표 함수(`onClick={() => ...}`)나 다른 표현식은 자동으로 제외된다.
3. 그 expression을 알려진 심볼로 resolve를 시도한다. 실패하거나 자기 자신을 가리키면 건너뛴다.
4. 성공하면 `{ from: symbol.id, to: target.id }` 에지를 추가한다 — 일반 호출 에지와 완전히 동일한 형태.

### 리팩터링

기존 `resolveCallTarget(call, context)`는 `call.getExpression()`을 얻은 뒤 심볼 해석 로직을 수행한다. 이 심볼 해석 로직을 `resolveExpressionTarget(expression, context)`로 추출해서 `CallExpression`과 `JsxAttribute` 양쪽에서 재사용한다.

```
resolveCallTarget(call, context) = resolveExpressionTarget(call.getExpression(), context)
```

동작은 동일하게 유지되며 순수 리팩터링이다.

### 타입/출력 변경

없음. `TraceEdge`, `traceGraph.ts`, `printTree.ts`는 수정하지 않는다. JSX prop으로 넘겨진 참조도 일반 호출 에지와 구분 없이 트리에 `->`로 표시된다.

### 엣지 케이스

| 케이스 | 처리 |
|---|---|
| `value={count}` (함수가 아닌 값) | `symbolsByName`에 없으므로 자동으로 에지 안 생김, 에러 없음 |
| `onClick={() => handleClick()}` (인라인 화살표 안의 실제 호출) | 기존 `CallExpression` 탐색이 이미 처리 중 — 이번 변경과 무관하게 계속 동작 |
| `{...props}` 스프레드 | `JsxSpreadAttribute`이지 `JsxAttribute`가 아니므로 자연히 제외 |
| `onClick={this.handleClick}` / `onClick={obj.method}` | `PropertyAccessExpression` 경로로 기존 호출과 동일하게 resolve 시도 |
| 문자열 리터럴 속성 (`className="foo"`) | `initializer`가 `JsxExpression`이 아니므로 스킵 |

## 테스트 계획

`test/fixtures/jsx-callback-prop/` 신규 fixture 추가:

- `tsconfig.json`: `"jsx": "react-jsx"` 포함
- `Button.tsx`: `onClick` prop을 받는 단순 컴포넌트 (내부에서 호출 여부는 무관)
- `OrderPage.tsx`: `handleBulkOrder` 함수 선언 + `<Button onClick={handleBulkOrder} />`로 넘기는 컴포넌트

`test/analyzer.test.ts`에 추가:

- `analyzeProject` 결과에 `OrderPage -> handleBulkOrder` 에지가 존재하는지 검증
- `traceFull(project, "handleBulkOrder")`로 caller 트리를 만들었을 때 `OrderPage`가 최상위 caller로 나타나는지 검증 (리포트된 실제 버그의 재현 테스트)

## 리스크

- ts-morph가 `.tsx` 파일의 JSX 문법을 올바르게 파싱하려면 해당 fixture의 `tsconfig.json`에 `jsx` 컴파일러 옵션이 필요하다. 기존 fixture들에는 없었으므로 새 fixture에서 처음 추가한다.
- `PropertyAccessExpression` 케이스(`onClick={obj.method}`)는 기존 호출 리졸버와 동일한 한계(별칭, 동적 바인딩 등)를 그대로 물려받는다. 새로운 리스크는 아니다.
