import path from "node:path";
import fg from "fast-glob";
import {
  CallExpression,
  ClassDeclaration,
  MethodDeclaration,
  Node,
  Project,
  SourceFile,
  Symbol as MorphSymbol,
  SyntaxKind,
  TypeChecker,
} from "ts-morph";
import type { AnalyzeProjectOptions, TraceEdge, TraceProject, TraceSymbol, SymbolKind } from "./types.js";

interface SymbolWithNode {
  symbol: TraceSymbol;
  node: Node;
  declarations: Node[];
}

export async function analyzeProject(options: AnalyzeProjectOptions): Promise<TraceProject> {
  const project = createProject(options);
  await addSourceFiles(project, options.cwd);

  const symbolsWithNodes = project
    .getSourceFiles()
    .flatMap((sourceFile) => collectSymbols(sourceFile, options.cwd));
  const symbols = symbolsWithNodes.map(({ symbol }) => symbol);
  const edges = collectEdges(symbolsWithNodes);

  return { symbols, edges };
}

function createProject(options: AnalyzeProjectOptions): Project {
  const tsconfigPath = options.tsconfigPath ?? path.join(options.cwd, "tsconfig.json");

  return new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: true,
  });
}

async function addSourceFiles(project: Project, cwd: string): Promise<void> {
  const files = await fg(["**/*.ts", "**/*.tsx", "!node_modules/**", "!dist/**"], {
    cwd,
    absolute: true,
  });

  project.addSourceFilesAtPaths(files);
}

function collectSymbols(sourceFile: SourceFile, cwd: string): SymbolWithNode[] {
  const symbols: SymbolWithNode[] = [];

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const name = declaration.getName();
    if (!name) continue;
    symbols.push(toSymbolWithNode(declaration, name, name, "function", sourceFile, cwd));
  }

  for (const variable of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = variable.getInitializer();
    if (!initializer) continue;
    if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;

    const name = variable.getName();
    symbols.push(toSymbolWithNode(initializer, name, name, "arrow", sourceFile, cwd, [variable, initializer]));
  }

  for (const classDeclaration of sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    const className = classDeclaration.getName();
    if (!className) continue;

    for (const method of classDeclaration.getMethods()) {
      const name = method.getName();
      symbols.push(toSymbolWithNode(method, name, `${className}.${name}`, "method", sourceFile, cwd));
    }
  }

  return symbols;
}

function toSymbolWithNode(
  node: Node,
  name: string,
  qualifiedName: string,
  kind: SymbolKind,
  sourceFile: SourceFile,
  cwd: string,
  declarations = [node],
): SymbolWithNode {
  const line = sourceFile.getLineAndColumnAtPos(node.getStart()).line;
  const filePath = path.relative(cwd, sourceFile.getFilePath());
  const id = `${filePath}:${qualifiedName}:${line}`;

  return {
    node,
    declarations,
    symbol: {
      id,
      name,
      qualifiedName,
      filePath,
      line,
      kind,
    },
  };
}

function collectEdges(symbolsWithNodes: SymbolWithNode[]): TraceEdge[] {
  const symbolsByName = new Map<string, TraceSymbol[]>();
  const symbolsByQualifiedName = new Map<string, TraceSymbol>();
  const symbolsByDeclaration = new Map<string, TraceSymbol>();
  const typeChecker = symbolsWithNodes[0]?.node.getProject().getTypeChecker();

  for (const { symbol } of symbolsWithNodes) {
    addSymbolName(symbolsByName, symbol.name, symbol);
    addSymbolName(symbolsByName, symbol.qualifiedName, symbol);
    symbolsByQualifiedName.set(symbol.qualifiedName, symbol);
  }

  for (const { declarations, symbol } of symbolsWithNodes) {
    for (const declaration of declarations) {
      symbolsByDeclaration.set(getDeclarationKey(declaration), symbol);
    }
  }

  const edges: TraceEdge[] = [];

  for (const { node, symbol } of symbolsWithNodes) {
    for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const target = resolveCallTarget(call, {
        symbolsByName,
        symbolsByQualifiedName,
        symbolsByDeclaration,
        typeChecker,
      });
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }
  }

  return dedupeEdges(edges);
}

function addSymbolName(map: Map<string, TraceSymbol[]>, name: string, symbol: TraceSymbol): void {
  const symbols = map.get(name) ?? [];
  symbols.push(symbol);
  map.set(name, symbols);
}

function resolveCallTarget(
  call: CallExpression,
  context: {
    symbolsByName: Map<string, TraceSymbol[]>;
    symbolsByQualifiedName: Map<string, TraceSymbol>;
    symbolsByDeclaration: Map<string, TraceSymbol>;
    typeChecker?: TypeChecker;
  },
): TraceSymbol | undefined {
  const expression = call.getExpression();
  const symbolTarget = resolveSymbolTarget(expression.getSymbol(), context);
  if (symbolTarget) return symbolTarget;

  if (Node.isIdentifier(expression)) {
    return context.symbolsByName.get(expression.getText())?.[0];
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const propertyName = expression.getName();
    const fullName = expression.getText();
    return context.symbolsByQualifiedName.get(fullName) ?? context.symbolsByName.get(propertyName)?.[0];
  }

  return undefined;
}

function resolveSymbolTarget(
  symbol: MorphSymbol | undefined,
  context: {
    symbolsByDeclaration: Map<string, TraceSymbol>;
    typeChecker?: TypeChecker;
  },
): TraceSymbol | undefined {
  if (!symbol) return undefined;

  const alias = context.typeChecker?.getAliasedSymbol(symbol);
  const candidates = alias ? [alias, symbol] : [symbol];

  for (const candidate of candidates) {
    for (const declaration of candidate.getDeclarations()) {
      const target = context.symbolsByDeclaration.get(getDeclarationKey(declaration));
      if (target) return target;
    }
  }

  return undefined;
}

function getDeclarationKey(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
}

function dedupeEdges(edges: TraceEdge[]): TraceEdge[] {
  const seen = new Set<string>();

  return edges.filter((edge) => {
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
