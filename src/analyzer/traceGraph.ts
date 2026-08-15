import type { TraceNode, TraceOptions, TraceProject, TraceSymbol } from "./types.js";

export function traceFrom(project: TraceProject, query: string, options: TraceOptions = {}): TraceNode {
  const root = findSymbol(project.symbols, query);
  const maxDepth = options.maxDepth ?? 10;

  return buildNode(project, root, maxDepth, new Set());
}

function findSymbol(symbols: TraceSymbol[], query: string): TraceSymbol {
  const exact = symbols.find((symbol) => symbol.qualifiedName === query || symbol.name === query);
  if (exact) return exact;

  const partialMatches = symbols.filter((symbol) => symbol.qualifiedName.includes(query));
  if (partialMatches.length === 1) return partialMatches[0];

  if (partialMatches.length > 1) {
    const names = partialMatches.map((symbol) => symbol.qualifiedName).join(", ");
    throw new Error(`Multiple symbols matched "${query}": ${names}`);
  }

  throw new Error(`No symbol matched "${query}"`);
}

function buildNode(project: TraceProject, symbol: TraceSymbol, remainingDepth: number, seen: Set<string>): TraceNode {
  if (remainingDepth <= 0 || seen.has(symbol.id)) {
    return { symbol, children: [] };
  }

  const nextSeen = new Set(seen);
  nextSeen.add(symbol.id);

  const children = project.edges
    .filter((edge) => edge.from === symbol.id)
    .map((edge) => project.symbols.find((candidate) => candidate.id === edge.to))
    .filter((candidate): candidate is TraceSymbol => Boolean(candidate))
    .map((child) => buildNode(project, child, remainingDepth - 1, nextSeen));

  return { symbol, children };
}
