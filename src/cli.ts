import { Command } from "commander";
import pc from "picocolors";
import { analyzeProject, findSymbol, printTree, traceFrom, traceFull } from "./index.js";

const program = new Command();

program
  .name("trace-flow")
  .description("Trace TypeScript code execution flow and print it as a tree.")
  .argument("<symbol>", "Function, method, or symbol name to trace")
  .option("-p, --project <path>", "Project directory", process.cwd())
  .option("-d, --depth <number>", "Maximum trace depth", parseDepth, 10)
  .option("--calls-only", "Show only what the symbol calls, without its callers")
  .action(async (symbol: string, options: { project: string; depth: number; callsOnly?: boolean }) => {
    try {
      const project = await analyzeProject({ cwd: options.project });

      if (options.callsOnly) {
        const trace = traceFrom(project, symbol, { maxDepth: options.depth });
        console.log(printTree(trace));
        return;
      }

      const traces = traceFull(project, symbol, { maxDepth: options.depth });
      const matched = findSymbol(project.symbols, symbol);
      console.log(traces.map((trace) => printTree(trace, matched.id)).join("\n\n"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(message));
      process.exitCode = 1;
    }
  });

program.parseAsync();

function parseDepth(value: string): number {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error("--depth must be a positive integer");
  }
  return depth;
}
