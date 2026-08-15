import { Node, Symbol as MorphSymbol, TypeChecker } from "ts-morph";
import type { TraceSymbol } from "./types.js";

export interface ResolveContext {
    symbolsByName: Map<string, TraceSymbol[]>;
    symbolsByQualifiedName: Map<string, TraceSymbol>;
    symbolsByDeclaration: Map<string, TraceSymbol>;
    typeChecker?: TypeChecker;
}

export function resolveExpressionTarget(
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

export function getDeclarationKey(node: Node): string {
    return `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
}