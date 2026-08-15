import type { TraceNode } from "../analyzer/types.js";

export function printTree(node: TraceNode): string {
  return printNode(node, 0).join("\n");
}

function printNode(node: TraceNode, depth: number): string[] {
  const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}-> `;
  const lines = [`${prefix}${node.symbol.qualifiedName}`];

  for (const child of node.children) {
    lines.push(...printNode(child, depth + 1));
  }

  return lines;
}
