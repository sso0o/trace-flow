import pc from "picocolors";
import type { TraceNode } from "../analyzer/types.js";

export function printTree(node: TraceNode, highlightId?: string): string {
  return printNode(node, 0, highlightId).join("\n");
}

function printNode(node: TraceNode, depth: number, highlightId?: string): string[] {
  const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}-> `;
  const location = pc.dim(`(${node.symbol.filePath}:${node.symbol.line})`);
  const name = node.symbol.id === highlightId ? pc.bold(node.symbol.qualifiedName) : node.symbol.qualifiedName;
  const lines = [`${prefix}${name} ${location}`];

  for (const child of node.children) {
    lines.push(...printNode(child, depth + 1, highlightId));
  }

  return lines;
}
