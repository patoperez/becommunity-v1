"use client";

/**
 * WHO IS READING THIS BLOCK, and what may therefore be said inside it.
 *
 * WHY THIS EXISTS. `BlockView` and `Charts.tsx` are honest for an INTERNAL
 * reader in the way an internal screen must be. A block with no explanatory
 * text says "Este bloque todavía no tiene texto. Escríbelo en la ficha del
 * bloque." A semáforo with no authored standard shows "Falta configurar el
 * rango". The complete-inventory block says "El cliente los ve plegados, para
 * revisarlos si quiere." Every one of those sentences is correct, useful, and
 * addressed to the person composing.
 *
 * THE FIRST PUBLISHED CLIENT SCREEN PRINTED ALL THREE. `client-visibility.ts`
 * decides which BLOCKS reach a client and it did its job; what it cannot do is
 * reach inside a block that legitimately renders and silence an instruction
 * meant for its author. That needed a second, smaller mechanism, and this is
 * it — found by looking at the screenshot rather than by reasoning about the
 * code, which is why the screenshot is part of the gate.
 *
 * WHY A CONTEXT RATHER THAN A PROP. The sentences live in about a dozen leaf
 * renderers inside `Charts.tsx`, several of them three or four levels below
 * `BlockView`. Threading a prop through every one of them is a dozen places to
 * forget, and forgetting one puts an internal instruction on a client's screen
 * — which is precisely the failure being fixed. A context is read where it
 * matters and cannot be dropped in between.
 *
 * THE DEFAULT IS `internal`, deliberately. Everything that renders a block
 * today — the builder canvas, the draft preview, the revision preview's
 * internal chrome — keeps exactly the behaviour it has. Only a subtree
 * explicitly wrapped for a client changes, and the client renderer is the one
 * place that wraps it.
 *
 * WHAT IT IS NOT. It is not authorization and it is not a data boundary. What a
 * client may READ is decided by RLS, by the authorized loader and by the
 * published revision; this decides only whether a sentence addressed to an
 * author is drawn. A component that used it to gate DATA would be putting a
 * security decision in a React context, which is the wrong place for one.
 */

import { createContext, useContext, type ReactNode } from "react";

export type BlockAudience = "internal" | "client";

const AudienceContext = createContext<BlockAudience>("internal");

export function useAudience(): BlockAudience {
  return useContext(AudienceContext);
}

/** True when the subtree is being drawn for somebody outside Be Community. */
export function useIsClient(): boolean {
  return useContext(AudienceContext) === "client";
}

export function AudienceProvider({
  audience,
  children,
}: {
  audience: BlockAudience;
  children: ReactNode;
}) {
  return <AudienceContext.Provider value={audience}>{children}</AudienceContext.Provider>;
}
