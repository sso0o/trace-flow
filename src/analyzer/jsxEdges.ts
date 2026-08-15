import {
    JsxAttribute,
    JsxOpeningElement,
    JsxSelfClosingElement,
    Node,
    SyntaxKind,
} from "ts-morph";
import type { TraceEdge, TraceSymbol } from "./types.js";
import type { SymbolWithNode } from "./scope.js";
import { computeIsNested, isContainedIn } from "./scope.js";
import { resolveExpressionTarget, type ResolveContext } from "./resolveTarget.js";

type JsxTagElement = JsxOpeningElement | JsxSelfClosingElement;

interface RenderSite {
    element: JsxTagElement;
    fromEntry: SymbolWithNode;
    componentId: string;
}

interface ForwardingResult {
    fromSymbolId: string;
    triggerAttribute: JsxAttribute;
    target: TraceSymbol;
}

export function collectJsxEdges(symbolsWithNodes: SymbolWithNode[], context: ResolveContext): TraceEdge[] {
    const edges: TraceEdge[] = [];
    const renderSites = collectRenderSites(symbolsWithNodes, context);

    for (const site of renderSites) {
        if (site.componentId === site.fromEntry.symbol.id) continue;
        edges.push({ from: site.fromEntry.symbol.id, to: site.componentId });
    }

    // Every attribute examined while resolving *any* forwarded prop, whether it resolved
    // directly there or the search recursed through it. A component whose own forwarding
    // attribute shows up here is just relaying the prop to a deeper component that already
    // resolves it more precisely — its own edge is redundant with that longer chain and is
    // dropped below, so traceFull returns one nested tree instead of several overlapping ones.
    const visitedAsSupplier = new Set<JsxAttribute>();
    const forwardingResults: ForwardingResult[] = [];

    for (const entry of symbolsWithNodes) {
        const { node, symbol } = entry;
        const isNested = computeIsNested(symbolsWithNodes, entry);

        for (const attribute of node.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
            if (isNested(attribute)) continue;

            const expression = getAttributeValueExpression(attribute);
            if (!expression) continue;

            const ownProp = getOwnPropName(expression, node);
            if (!ownProp) continue;

            const forwarded = resolveForwardedProp(entry, ownProp, renderSites, context, new Set(), visitedAsSupplier);
            if (forwarded && forwarded.id !== symbol.id) {
                forwardingResults.push({ fromSymbolId: symbol.id, triggerAttribute: attribute, target: forwarded });
            }
        }
    }

    for (const { fromSymbolId, triggerAttribute, target } of forwardingResults) {
        if (visitedAsSupplier.has(triggerAttribute)) continue;
        edges.push({ from: fromSymbolId, to: target.id });
    }

    for (const entry of symbolsWithNodes) {
        const { node, symbol } = entry;
        const isNested = computeIsNested(symbolsWithNodes, entry);

        for (const attribute of node.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
            if (isNested(attribute)) continue;
            if (visitedAsSupplier.has(attribute)) continue;

            const expression = getAttributeValueExpression(attribute);
            if (!expression) continue;

            const allowNameFallback = expression.getType().getCallSignatures().length > 0;
            const direct = resolveExpressionTarget(expression, context, { allowNameFallback });
            if (!direct || direct.id === symbol.id) continue;

            edges.push({ from: symbol.id, to: direct.id });
        }
    }

    return edges;
}

function collectRenderSites(symbolsWithNodes: SymbolWithNode[], context: ResolveContext): RenderSite[] {
    const sites: RenderSite[] = [];

    for (const entry of symbolsWithNodes) {
        const isNested = computeIsNested(symbolsWithNodes, entry);

        for (const element of getJsxTagElements(entry.node)) {
            if (isNested(element)) continue;

            const tagName = element.getTagNameNode();
            if (!Node.isIdentifier(tagName) && !Node.isPropertyAccessExpression(tagName)) continue;
            if (/^[a-z]/.test(tagName.getText())) continue;

            const allowNameFallback = tagName.getType().getCallSignatures().length > 0;
            const target = resolveExpressionTarget(tagName, context, { allowNameFallback });
            if (!target) continue;

            sites.push({ element, fromEntry: entry, componentId: target.id });
        }
    }

    return sites;
}

function getJsxTagElements(node: Node): JsxTagElement[] {
    return [
        ...node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];
}

function getAttributeValueExpression(attribute: JsxAttribute): Node | undefined {
    const initializer = attribute.getInitializer();
    if (!initializer || !Node.isJsxExpression(initializer)) return undefined;

    const expression = initializer.getExpression();
    if (!expression) return undefined;
    if (!Node.isIdentifier(expression) && !Node.isPropertyAccessExpression(expression)) return undefined;

    return expression;
}

/** If `expression` is one of `enclosingNode`'s own destructured parameter properties, returns its local name (e.g. the `onBulkOrder` in `({ onBulkOrder }: Props) => ...`). */
function getOwnPropName(expression: Node, enclosingNode: Node): string | undefined {
    if (!Node.isIdentifier(expression)) return undefined;

    const declaration = expression.getSymbol()?.getDeclarations()[0];
    if (!declaration || !Node.isBindingElement(declaration)) return undefined;
    if (!isContainedIn(declaration, enclosingNode)) return undefined;

    const bindingPattern = declaration.getParent();
    if (!Node.isObjectBindingPattern(bindingPattern)) return undefined;
    if (!Node.isParameterDeclaration(bindingPattern.getParent())) return undefined;

    return declaration.getName();
}

/**
 * Resolves a prop forwarded through `componentEntry` by looking at every place `componentEntry`
 * is rendered, reading the matching attribute there, and recursing if that value is itself a
 * forwarded prop. `visited` (keyed by componentId:propName) guards against forwarding cycles.
 */
function resolveForwardedProp(
    componentEntry: SymbolWithNode,
    propName: string,
    renderSites: RenderSite[],
    context: ResolveContext,
    visited: Set<string>,
    visitedAsSupplier: Set<JsxAttribute>,
): TraceSymbol | undefined {
    const key = `${componentEntry.symbol.id}:${propName}`;
    if (visited.has(key)) return undefined;
    visited.add(key);

    for (const site of renderSites) {
        if (site.componentId !== componentEntry.symbol.id) continue;

        const attribute = site.element
            .getAttributes()
            .find((attr): attr is JsxAttribute => Node.isJsxAttribute(attr) && attr.getNameNode().getText() === propName);
        if (!attribute) continue;

        visitedAsSupplier.add(attribute);

        const expression = getAttributeValueExpression(attribute);
        if (!expression) continue;

        const allowNameFallback = expression.getType().getCallSignatures().length > 0;
        const direct = resolveExpressionTarget(expression, context, { allowNameFallback });
        if (direct) return direct;

        const forwardedPropName = getOwnPropName(expression, site.fromEntry.node);
        if (!forwardedPropName) continue;

        const forwarded = resolveForwardedProp(
            site.fromEntry,
            forwardedPropName,
            renderSites,
            context,
            visited,
            visitedAsSupplier,
        );
        if (forwarded) return forwarded;
    }

    return undefined;
}