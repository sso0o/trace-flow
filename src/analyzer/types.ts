export type SymbolKind = "function" | "method" | "arrow";

export interface TraceSymbol {
  id: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  line: number;
  kind: SymbolKind;
}

export interface TraceProject {
  symbols: TraceSymbol[];
  edges: TraceEdge[];
}

export interface TraceEdge {
  from: string;
  to: string;
}

export interface AnalyzeProjectOptions {
  cwd: string;
  tsconfigPath?: string;
}

export interface TraceOptions {
  maxDepth?: number;
}

export interface TraceNode {
  symbol: TraceSymbol;
  children: TraceNode[];
}
