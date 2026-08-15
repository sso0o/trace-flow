import path from "node:path";
import fg from "fast-glob";
import { Node, Project, SourceFile, SyntaxKind } from "ts-morph";
import type { AnalyzeProjectOptions, TraceEdge, TraceProject, TraceSymbol, SymbolKind } from "./types.js";
import type { SymbolWithNode } from "./scope.js";
import { computeIsNested } from "./scope.js";
import { getDeclarationKey, resolveExpressionTarget, type ResolveContext } from "./resolveTarget.js";
import { collectJsxEdges } from "./jsxEdges.js";

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

    for (const entry of symbolsWithNodes) {
        const { node, symbol } = entry;
        const isNested = computeIsNested(symbolsWithNodes, entry);

        for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            if (isNested(call)) continue;

            const target = resolveExpressionTarget(call.getExpression(), context);
            if (!target || target.id === symbol.id) continue;
            edges.push({ from: symbol.id, to: target.id });
        }
    }

    edges.push(...collectJsxEdges(symbolsWithNodes, context));

    return dedupeEdges(edges);
}

function addSymbolName(map: Map<string, TraceSymbol[]>, name: string, symbol: TraceSymbol): void {
    const symbols = map.get(name) ?? [];
    symbols.push(symbol);
    map.set(name, symbols);
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