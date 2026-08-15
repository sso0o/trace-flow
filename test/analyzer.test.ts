import path from "node:path";
import { describe, expect, test } from "vitest";
import { analyzeProject, traceFrom, traceFull } from "../src/index.js";

const fixturePath = path.join(import.meta.dirname, "fixtures/simple-auth");
const nestedFixturePath = path.join(import.meta.dirname, "fixtures/nested-function");
const objectLiteralFixturePath = path.join(import.meta.dirname, "fixtures/object-literal-service");
const jsxCallbackPropFixturePath = path.join(import.meta.dirname, "fixtures/jsx-callback-prop");
const jsxAttributeNameCollisionFixturePath = path.join(import.meta.dirname, "fixtures/jsx-attribute-name-collision");
const jsxCallbackPropViaHookFixturePath = path.join(import.meta.dirname, "fixtures/jsx-callback-prop-via-hook");
const jsxComponentRenderFixturePath = path.join(import.meta.dirname, "fixtures/jsx-component-render");
const jsxPropForwardingFixturePath = path.join(import.meta.dirname, "fixtures/jsx-prop-forwarding");
const jsxPropForwardingMultiLevelFixturePath = path.join(
  import.meta.dirname,
  "fixtures/jsx-prop-forwarding-multi-level",
);
const jsxPropForwardingCycleFixturePath = path.join(import.meta.dirname, "fixtures/jsx-prop-forwarding-cycle");

describe("analyzeProject", () => {
  test("traces direct TypeScript calls from a class method", async () => {
    const project = await analyzeProject({ cwd: fixturePath });
    const trace = traceFrom(project, "AuthController.login");

    expect(trace.symbol.qualifiedName).toBe("AuthController.login");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toEqual(["AuthService.login"]);
    expect(trace.children[0]?.children.map((child) => child.symbol.qualifiedName)).toEqual([
      "findUserByEmail",
      "issueToken",
    ]);
  });

  test("traces a function declared inside another function", async () => {
    const project = await analyzeProject({ cwd: nestedFixturePath });
    const trace = traceFrom(project, "executeUpdateRole");

    expect(trace.symbol.qualifiedName).toBe("executeUpdateRole");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toEqual(["updateAdminRole"]);
  });

  test("does not attribute a nested function's calls to its enclosing function", async () => {
    const project = await analyzeProject({ cwd: nestedFixturePath });
    const trace = traceFrom(project, "useAdminRole");

    expect(trace.symbol.qualifiedName).toBe("useAdminRole");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toEqual([]);
  });

  test("traces a call to an arrow function assigned as an object literal property", async () => {
    const project = await analyzeProject({ cwd: objectLiteralFixturePath });
    const trace = traceFrom(project, "handleBulkOrder");

    expect(trace.symbol.qualifiedName).toBe("handleBulkOrder");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toEqual([
      "productionOrderService.bulkCreateProductionOrders",
    ]);
    expect(trace.children[0]?.children.map((child) => child.symbol.qualifiedName)).toEqual(["save"]);
  });

  test("traces a function passed as a JSX callback prop reference", async () => {
    const project = await analyzeProject({ cwd: jsxCallbackPropFixturePath });
    const trace = traceFrom(project, "OrderPage");

    expect(trace.symbol.qualifiedName).toBe("OrderPage");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toEqual(["Button", "handleBulkOrder"]);
  });

  test("does not create a false edge when a JSX attribute value shares a name with an unrelated function", async () => {
    const project = await analyzeProject({ cwd: jsxAttributeNameCollisionFixturePath });
    const trace = traceFrom(project, "Page");

    expect(trace.symbol.qualifiedName).toBe("Page");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).not.toContain("count");
  });

  test("traces a JSX callback prop reference destructured from a hook's return value", async () => {
    const project = await analyzeProject({ cwd: jsxCallbackPropViaHookFixturePath });
    const trace = traceFrom(project, "ProdOrderPage");

    expect(trace.symbol.qualifiedName).toBe("ProdOrderPage");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toContain("handleBulkOrder");
  });

  test("traces a component rendered as a JSX tag", async () => {
    const project = await analyzeProject({ cwd: jsxComponentRenderFixturePath });
    const trace = traceFrom(project, "Page");

    expect(trace.symbol.qualifiedName).toBe("Page");
    expect(trace.children.map((child) => child.symbol.qualifiedName)).toEqual(["Toolbar"]);
  });

  test("traces a callback prop forwarded through a child component", async () => {
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
});

describe("traceFull", () => {
  test("traces callers above and calls below a symbol in the middle of the chain", async () => {
    const project = await analyzeProject({ cwd: fixturePath });
    const [trace, ...rest] = traceFull(project, "AuthService.login");

    expect(rest).toHaveLength(0);
    expect(trace.symbol.qualifiedName).toBe("handleLoginRequest");
    expect(trace.children[0]?.symbol.qualifiedName).toBe("AuthController.login");

    const target = trace.children[0]?.children[0];
    expect(target?.symbol.qualifiedName).toBe("AuthService.login");
    expect(target?.children.map((child) => child.symbol.qualifiedName)).toEqual(["findUserByEmail", "issueToken"]);
  });

  test("behaves like traceFrom when the symbol has no callers", async () => {
    const project = await analyzeProject({ cwd: fixturePath });
    const [trace, ...rest] = traceFull(project, "handleLoginRequest");

    expect(rest).toHaveLength(0);
    expect(trace.symbol.qualifiedName).toBe("handleLoginRequest");
    expect(trace.children[0]?.symbol.qualifiedName).toBe("AuthController.login");
  });

  test("finds a caller that only passes the symbol as a JSX callback prop", async () => {
    const project = await analyzeProject({ cwd: jsxCallbackPropFixturePath });
    const [trace, ...rest] = traceFull(project, "handleBulkOrder");

    expect(rest).toHaveLength(0);
    expect(trace.symbol.qualifiedName).toBe("OrderPage");
    expect(trace.children[0]?.symbol.qualifiedName).toBe("handleBulkOrder");
  });

  test("traces a forwarded prop to its caller as a single nested tree", async () => {
    const project = await analyzeProject({ cwd: jsxPropForwardingFixturePath });
    const [trace, ...rest] = traceFull(project, "handleBulkOrder");

    expect(rest).toHaveLength(0);
    expect(trace.symbol.qualifiedName).toBe("ProdPlanList");
    expect(trace.children[0]?.symbol.qualifiedName).toBe("BulkSaveToolbar");
    expect(trace.children[0]?.children[0]?.symbol.qualifiedName).toBe("handleBulkOrder");
  });

  test("traces a prop forwarded through two levels as a single nested tree, not a duplicate shortcut", async () => {
    const project = await analyzeProject({ cwd: jsxPropForwardingMultiLevelFixturePath });
    const [trace, ...rest] = traceFull(project, "handleSave");

    expect(rest).toHaveLength(0);
    expect(trace.symbol.qualifiedName).toBe("Root");
    expect(trace.children[0]?.symbol.qualifiedName).toBe("Middle");
    expect(trace.children[0]?.children[0]?.symbol.qualifiedName).toBe("Leaf");
    expect(trace.children[0]?.children[0]?.children[0]?.symbol.qualifiedName).toBe("handleSave");
  });
});
