# JSX 컴포넌트 렌더링 + prop forwarding 추적 — 설계

## 배경

0.1.6에서 "콜백 prop으로 전달된 함수 호출 추적" 기능을 추가했다(`<Button onClick={handleFn} />`처럼 `CallExpression` 없이 함수 참조만 넘겨지는 JSX 속성값을 호출 에지로 인식). 이 기능은 0.1.7, 0.1.8을 거치며 두 번의 실사용 버그를 고쳤다:

- 0.1.7: JSX 속성값이 프로젝트 내 동명의 무관한 심볼과 이름만으로 잘못 매칭되는 가짜 에지 문제 수정
- 0.1.8: 그 수정이 과도해서, 훅에서 구조분해로 꺼낸 핸들러(`const { handleBulkOrder } = useBulkProdOrder()`)처럼 실제로는 함수인데도 fallback이 막혀 못 찾던 회귀를 수정 (타입이 실제로 함수인지로 판단하도록 변경)

0.1.8 배포 후 세 번째 실사용 케이스가 발견되었다. `frontend` 프로젝트의 `ProdPlanList`가 `handleBulkOrder`를 `<BulkSaveToolbar onBulkOrder={handleBulkOrder} />`로 자식 컴포넌트에 prop으로 넘기고, `BulkSaveToolbar` 내부에서는 그 prop을 `onClick={onBulkOrder}`로 다시 자기 자식(`Button`)에 넘긴다. 이 경우:

- `ProdPlanList -> handleBulkOrder` 에지는 이미 잘 잡힌다 (0.1.6 기능이 직접 해결).
- 하지만 `BulkSaveToolbar` 내부의 `onClick={onBulkOrder}`는 `onBulkOrder`가 프로젝트에 실제로 선언된 심볼이 아니라 `BulkSaveToolbar` 자신의 prop 파라미터 이름일 뿐이라서, 어떤 방법으로도 `handleBulkOrder`와 연결되지 않는다.
- 사용자는 `BulkSaveToolbar`가 실행 흐름의 중간 단계로서 트리에 나타나기를 기대했다 (`ProdPlanList -> BulkSaveToolbar -> handleBulkOrder`).

이건 지금까지의 "이름이 같은데 연결이 끊기는" 종류의 버그가 아니라, prop이 컴포넌트 경계를 넘어 다른 이름으로 다시 전달되는(prop forwarding/threading) 근본적으로 다른 패턴이라 새 기능으로 다룬다.

## 목표

1. JSX 태그로 프로젝트 내 알려진 컴포넌트를 렌더링하면 "렌더링" 에지를 추가한다 (`ProdPlanList -> BulkSaveToolbar`).
2. 컴포넌트가 자신의 prop 파라미터를 그대로(또는 다른 이름으로) 자식에게 다시 넘기는 경우, 그 컴포넌트를 실제로 렌더링하는 모든 위치를 역추적해서 최종적으로 연결되는 실제 함수까지 에지를 만든다 (`BulkSaveToolbar -> handleBulkOrder`).
3. 여러 단계의 forwarding(A → B → C → 실제 함수)도 지원한다.
4. 두 에지 모두 기존 `TraceEdge`(`{from, to}`)와 완전히 동일한 형태로, 타입 구분 필드를 추가하지 않는다. 그 결과 `traceFull`/`printTree`를 전혀 수정하지 않고도 `ProdPlanList -> BulkSaveToolbar -> handleBulkOrder`가 하나의 중첩된 트리로 자연스럽게 나타난다.

## 비목표

- 컴포넌트가 여러 곳에서 서로 다른 콜백으로 재사용될 때 호출 지점(instantiation)별로 그래프를 분리하는 것. 기존 그래프 모델 자체가 "누가 호출했는지"별로 분리하지 않는 평면 그래프이므로, 이 기능도 같은 한계를 그대로 물려받는다 — 새로운 문제가 아니라 기존 설계의 연장선이다.
- third-party 컴포넌트(MUI 등)에 대한 특별 처리. 프로젝트 심볼로 등록되지 않으므로 태그 이름 해석이 자연히 실패하고 무시된다 — 추가 로직 불필요.
- 순환 참조가 실제로 발생하는 것을 막는 것(그런 컴포넌트 설계 자체가 사실상 없음). 다만 무한 재귀를 막기 위한 방문 집합은 구현에 포함한다.

## 파일 구조

`src/analyzer/analyzeProject.ts`가 이미 275줄로 커진 상태에서 이번 기능(렌더링 에지 + forwarding 에지)을 더 얹으면 파일이 지나치게 커진다. JSX 관련 에지 해석 로직 전체(기존 attribute-value 직접 해석 포함, 신규 renders/forwarding 포함)를 `src/analyzer/jsxEdges.ts`로 분리한다.

- `analyzeProject.ts`: 심볼 수집(`collectSymbols`) + 일반 `CallExpression` 기반 호출 그래프(`collectEdges`의 핵심)만 담당. 기존 JSX 속성값 직접 해석 코드(현재 `collectEdges` 안의 `JsxAttribute` 순회 블록, `resolveExpressionTarget`, `ResolveContext` 등)를 `jsxEdges.ts`로 옮긴다.
- `jsxEdges.ts`: JSX 관련 에지 전부 — 기존 attribute-value 직접 해석, 신규 렌더링 에지, 신규 forwarding 에지. `analyzeProject.ts`가 심볼/노드 정보를 넘겨주면 JSX 관련 `TraceEdge[]`를 반환하는 형태로 인터페이스를 정리한다.

## 알고리즘

### 1) 렌더링 에지

각 심볼 노드 안에서 JSX 여는 태그(`JsxOpeningElement`/`JsxSelfClosingElement`)를 순회한다 (기존 `CallExpression`/`JsxAttribute` 순회와 같은 중첩 스코프 제외 규칙 재사용). 태그 이름(`getTagNameNode()`)을 기존 `resolveExpressionTarget`으로 해석 시도한다. 알려진 컴포넌트 심볼로 풀리면 `{from: enclosing.id, to: component.id}` 에지를 추가한다.

### 2) forwarding 에지

기존 JsxAttribute 속성값 해석(직접 매칭도 실패, 타입 기반 fallback도 실패)이 실패했을 때, 그 식별자가 **이 컴포넌트 자신의 destructure된 prop 파라미터**인지 확인한다 (컴포넌트 함수/화살표 함수의 파라미터가 `ObjectBindingPattern`이면, 그 안의 `BindingElement` 이름들과 실패한 식별자의 심볼 선언이 일치하는지 비교).

일치하면:
1. 이 컴포넌트를 실제로 렌더링하는 모든 JSX 사용처를 프로젝트 전체에서 찾는다 (렌더링 에지를 만들 때 이미 계산한 "태그 이름 → 컴포넌트 심볼" 해석 결과를 재사용).
2. 각 사용처에서 같은 이름의 속성을 찾아 그 값을 재귀적으로 해석한다 — 그 값 자체가 또 다른 컴포넌트의 forwarding일 수 있으므로, 같은 해석 함수를 재귀 호출한다. 방문 중인 (컴포넌트, prop 이름) 쌍을 방문 집합에 넣어 순환을 방지한다.
3. 최종적으로 실제 함수 심볼까지 풀리면 `{from: enclosing.id, to: finalTarget.id}` 에지를 추가한다.

## 테스트 계획

`test/fixtures/jsx-prop-forwarding/` 신규 fixture: 정확히 보고된 실제 버그를 재현한다.

- `handleBulkOrder`를 정의하는 파일 (또는 훅)
- `BulkSaveToolbar.tsx`: `{ onBulkOrder }: Props`로 받아서 내부 `<Button onClick={onBulkOrder} />`로 다시 넘기는 컴포넌트
- `ProdPlanList.tsx`: `<BulkSaveToolbar onBulkOrder={handleBulkOrder} />`로 렌더링하는 컴포넌트

`test/analyzer.test.ts`에 추가:
- `analyzeProject` 결과에 `ProdPlanList -> BulkSaveToolbar`, `BulkSaveToolbar -> handleBulkOrder` 두 에지가 모두 존재하는지 검증
- `traceFull(project, "handleBulkOrder")`로 caller 트리를 만들었을 때 `ProdPlanList -> BulkSaveToolbar -> handleBulkOrder`가 하나의 중첩된 트리로 나타나는지 검증
- 2단계 이상 forwarding(A → B → C → 실제 함수)을 검증하는 별도 fixture/테스트 하나 추가
- 순환 방지: 컴포넌트가 자기 자신을 다시 렌더링하며 같은 prop을 그대로 전달하는 극단적 fixture로 무한 루프 없이 안전하게 처리되는지 확인

## 리스크

- 한 컴포넌트가 여러 곳에서 다른 콜백으로 재사용되면, 그 컴포넌트에서 여러 개의 "가능한" 타겟으로 에지가 다 생긴다. 실제로는 인스턴스별로 다른데 그래프에는 다 섞여 보인다 — 기존 그래프 모델 자체의 한계이며 새로운 문제는 아니다.
- 프로젝트 전체에서 "이 컴포넌트를 렌더링하는 모든 위치"를 찾는 역탐색은 심볼 수가 많은 프로젝트에서 성능에 영향을 줄 수 있다. 태그 이름 해석 결과를 캐싱해서 렌더링 에지 계산과 forwarding 계산이 같은 탐색을 중복하지 않도록 한다.
- 순환 forwarding을 막는 방문 집합 로직이 버그가 있으면 무한 루프로 이어질 수 있다 — 테스트로 반드시 커버한다.
