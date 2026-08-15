import { Node } from "ts-morph";
import type { TraceSymbol } from "./types.js";

export interface SymbolWithNode {
    symbol: TraceSymbol;
    node: Node;
    declarations: Node[];
}

/** Whether `node` falls entirely within `container`'s span (used to attribute a call to its innermost enclosing function, not every ancestor function). */
export function isContainedIn(node: Node, container: Node): boolean {
    if (node.getSourceFile() !== container.getSourceFile()) return false;
    return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd();
}

/** Builds a predicate for `entry` that excludes any node already owned by a symbol nested inside `entry`'s own node, so a call/reference is attributed to its innermost enclosing symbol only. */
export function computeIsNested(
    symbolsWithNodes: SymbolWithNode[],
    entry: SymbolWithNode,
): (candidate: Node) => boolean {
    const nestedNodes = symbolsWithNodes
        .filter(
            (other) =>
                other.symbol.id !== entry.symbol.id &&
                other.node.getSourceFile() === entry.node.getSourceFile() &&
                isContainedIn(other.node, entry.node),
        )
        .map(({ node }) => node);

    return (candidate: Node) => nestedNodes.some((nestedNode) => isContainedIn(candidate, nestedNode));
}