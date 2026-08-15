import { describe, expect, test } from "vitest";
import { printTree } from "../src/index.js";
import type { TraceNode, TraceSymbol } from "../src/index.js";

describe("printTree", () => {
  test("prints a nested trace as an indented tree", () => {
    const trace: TraceNode = {
      symbol: symbol("AuthController.login"),
      children: [
        {
          symbol: symbol("AuthService.login"),
          children: [{ symbol: symbol("issueToken"), children: [] }],
        },
      ],
    };

    expect(printTree(trace)).toBe(["AuthController.login", "  -> AuthService.login", "    -> issueToken"].join("\n"));
  });
});

function symbol(qualifiedName: string): TraceSymbol {
  return {
    id: qualifiedName,
    name: qualifiedName.split(".").at(-1) ?? qualifiedName,
    qualifiedName,
    filePath: "fixture.ts",
    line: 1,
    kind: qualifiedName.includes(".") ? "method" : "function",
  };
}
