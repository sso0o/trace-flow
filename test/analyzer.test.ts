import path from "node:path";
import { describe, expect, test } from "vitest";
import { analyzeProject, traceFrom } from "../src/index.js";

const fixturePath = path.join(import.meta.dirname, "fixtures/simple-auth");
const nestedFixturePath = path.join(import.meta.dirname, "fixtures/nested-function");

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
});
