export { analyzeProject } from "./analyzer/analyzeProject.js";
export { findSymbol, traceFrom, traceFull } from "./analyzer/traceGraph.js";
export { printTree } from "./output/printTree.js";
export type {
  AnalyzeProjectOptions,
  TraceEdge,
  TraceNode,
  TraceOptions,
  TraceProject,
  TraceSymbol,
} from "./analyzer/types.js";
