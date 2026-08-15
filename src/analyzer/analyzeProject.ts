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

    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      const name = variable.getName();
      symbols.push(toSymbolWithNode(initializer, name, name, "arrow", sourceFile, cwd, [variable, initializer]));
      continue;
    }

    if (Node.isObjectLiteralExpression(initializer)) {
      const objectName = variable.getName();

      for (const property of initializer.getProperties()) {
        if (!Node.isPropertyAssignment(property)) continue;

        const propertyInitializer = property.getInitializer();
        if (!propertyInitializer) continue;
        if (!Node.isArrowFunction(propertyInitializer) && !Node.isFunctionExpression(propertyInitializer)) continue;

        const name = property.getName();
        symbols.push(
          toSymbolWithNode(propertyInitializer, name, `${objectName}.${name}`, "method", sourceFile, cwd, [
            property,
            propertyInitializer,
          ]),
        );
      }
    }
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

  const context: ResolveContext = { symbolsByName, symbolsByQualifiedName, symbolsByDeclaration, typeChecker };
  const edges: TraceEdge[] = [];

  for (const { node, symbol } of symbolsWithNodes) {
    const nestedNodes = symbolsWithNodes
      .filter(
        (other) =>
          other.symbol.id !== symbol.id &&
          other.node.getSourceFile() === node.getSourceFile() &&
          isContainedIn(other.node, node),
      )
      .map(({ node: nestedNode }) => nestedNode);

    const isNested = (candidate: Node) => nestedNodes.some((nestedNode) => isContainedIn(candidate, nestedNode));

    for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isNested(call)) continue;

      const target = resolveCallTarget(call, context);
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }

    for (const attribute of node.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (isNested(attribute)) continue;

      const initializer = attribute.getInitializer();
      if (!initializer || !Node.isJsxExpression(initializer)) continue;

      const expression = initializer.getExpression();
      if (!expression) continue;
      if (!Node.isIdentifier(expression) && !Node.isPropertyAccessExpression(expression)) continue;

      const target = resolveExpressionTarget(expression, context, { allowNameFallback: false });
      if (!target || target.id === symbol.id) continue;
      edges.push({ from: symbol.id, to: target.id });
    }
  }

  return dedupeEdges(edges);
}

/** Whether `node` falls entirely within `container`'s span (used to attribute a call to its innermost enclosing function, not every ancestor function). */
function isContainedIn(node: Node, container: Node): boolean {
  if (node.getSourceFile() !== container.getSourceFile()) return false;
  return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd();
}

function addSymbolName(map: Map<string, TraceSymbol[]>, name: string, symbol: TraceSymbol): void {
  const symbols = map.get(name) ?? [];
  symbols.push(symbol);
  map.set(name, symbols);
}

interface ResolveContext {
  symbolsByName: Map<string, TraceSymbol[]>;
  symbolsByQualifiedName: Map<string, TraceSymbol>;
  symbolsByDeclaration: Map<string, TraceSymbol>;
  typeChecker?: TypeChecker;
}

function resolveCallTarget(call: CallExpression, context: ResolveContext): TraceSymbol | undefined {
  return resolveExpressionTarget(call.getExpression(), context);
}

function resolveExpressionTarget(
  expression: Node,
  context: ResolveContext,
  options: { allowNameFallback?: boolean } = {},
): TraceSymbol | undefined {
  const symbolTarget = resolveSymbolTarget(expression.getSymbol(), context);
  if (symbolTarget) return symbolTarget;

  if (options.allowNameFallback === false) return undefined;

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
