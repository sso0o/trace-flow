import type { TraceNode, TraceOptions, TraceProject, TraceSymbol } from "./types.js";

export function traceFrom(project: TraceProject, query: string, options: TraceOptions = {}): TraceNode {
  const root = findSymbol(project.symbols, query);
  const maxDepth = options.maxDepth ?? 10;

  return buildNode(project, root, maxDepth, new Set());
}

/**
 * Traces both directions from the matched symbol: upward through its callers
 * (top-most caller first) and downward through everything it calls. Returns
 * one root TraceNode per distinct top-most caller chain; a symbol with no
 * callers returns a single root equivalent to traceFrom's result.
 */
export function traceFull(project: TraceProject, query: string, options: TraceOptions = {}): TraceNode[] {
  const root = findSymbol(project.symbols, query);
  const maxDepth = options.maxDepth ?? 10;

  const ancestorChains = ancestorChainsFor(project, root, maxDepth, new Set([root.id]));

  if (ancestorChains.length === 0) {
    return [buildNode(project, root, maxDepth, new Set())];
  }

  return ancestorChains.map((chain) => {
    const descendantSeen = new Set(chain.map((symbol) => symbol.id));
    const rootNode = buildNode(project, root, maxDepth, descendantSeen);
    return wrapWithCallers(chain, rootNode);
  });
}

/** Ordered [topmost caller, ..., direct caller] chains leading to `symbol`, excluding `symbol` itself. */
function ancestorChainsFor(
  project: TraceProject,
  symbol: TraceSymbol,
  remainingDepth: number,
  seen: Set<string>,
): TraceSymbol[][] {
  if (remainingDepth <= 0) return [];

  const callers = project.edges
    .filter((edge) => edge.to === symbol.id)
    .map((edge) => project.symbols.find((candidate) => candidate.id === edge.from))
    .filter((candidate): candidate is TraceSymbol => {
      if (!candidate) return false;
      return !seen.has(candidate.id);
    });

  const chains: TraceSymbol[][] = [];

  for (const caller of callers) {
    const nextSeen = new Set(seen);
    nextSeen.add(caller.id);
    const higherChains = ancestorChainsFor(project, caller, remainingDepth - 1, nextSeen);

    if (higherChains.length === 0) {
      chains.push([caller]);
    } else {
      for (const higher of higherChains) {
        chains.push([...higher, caller]);
      }
    }
  }

  return chains;
}

function wrapWithCallers(chain: TraceSymbol[], innerNode: TraceNode): TraceNode {
  return chain.reduceRight<TraceNode>((child, symbol) => ({ symbol, children: [child] }), innerNode);
}

export function findSymbol(symbols: TraceSymbol[], query: string): TraceSymbol {
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
