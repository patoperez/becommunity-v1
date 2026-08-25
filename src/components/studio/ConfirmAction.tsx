"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * The destructive-action dialog (P8 contract C6).
 *
 * It replaces `window.confirm()`, which could not say what an action would
 * destroy, could not be styled to distinguish "you can undo this" from "this is
 * gone", could not carry a typed confirmation, and looked identical whether the
 * next click reverted one import or deleted a school's entire history.
 *
 * EVERY dialog answers the same four questions, in this order, because they are
 * the questions an operator actually has:
 *
 *   1. WHAT object — named, never "this item";
 *   2. WHAT happens — the consequence, in ordinary words;
 *   3. CAN IT BE UNDONE — one of three honest severities, never softened;
 *   4. HOW TO RECOVER — the real path back, or the plain statement that
 *      there is not one.
 *
 * SEVERITY IS NOT DECORATION. `reversible` is an ordinary action with an
 * ordinary button: styling a revert like an execution teaches an operator to
 * click through red, which is how the genuinely permanent one gets clicked.
 * `permanent` is the only severity that can require typing, and it is the only
 * one that reads as danger.
 *
 * IT IS NOT AUTHORIZATION. Every action behind one of these dialogs revalidates
 * identity, role, ownership and preconditions on the server. This dialog exists
 * so a person does not do the wrong thing by accident; it does nothing whatever
 * to an attacker, who simply never opens it.
 */

export type ConfirmSeverity = "reversible" | "recoverable" | "permanent";

const SEVERITY_NOTE: Record<ConfirmSeverity, string> = {
  reversible: "Se puede deshacer.",
  recoverable: "No se deshace con un botón, pero nada se destruye.",
  permanent: "No se puede deshacer.",
};

const SEVERITY_BOX: Record<ConfirmSeverity, string> = {
  reversible: "border-line bg-surface-sunken text-body",
  recoverable: "border-caution-line bg-caution-surface text-caution",
  permanent: "border-danger-line bg-danger-surface text-danger",
};

const SEVERITY_CONFIRM: Record<ConfirmSeverity, string> = {
  reversible:
    "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c] disabled:cursor-not-allowed disabled:opacity-50",
  recoverable:
    "inline-flex min-h-11 items-center justify-center rounded-lg border border-caution-line bg-caution-surface px-4 py-2.5 text-sm font-semibold text-caution hover:brightness-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
  permanent:
    "inline-flex min-h-11 items-center justify-center rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-paper hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
};

const CANCEL_CLASS =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The confirm control. It is a real submit button so the dialog works with the
 * form's own Server Action, and it disables itself while that action is in
 * flight, which is what stops a second click from dispatching the mutation
 * twice.
 */
function ConfirmSubmit({
  severity,
  label,
  pendingLabel,
  blocked,
}: {
  severity: ConfirmSeverity;
  label: string;
  pendingLabel: string;
  blocked: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={SEVERITY_CONFIRM[severity]} disabled={pending || blocked}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export type ConfirmActionProps = {
  /** The visible control that opens the dialog. */
  trigger: string;
  triggerClassName?: string;
  /** The dialog's heading — a verb and the object, e.g. "Eliminar cliente". */
  title: string;
  /** The object itself, named exactly as it appears elsewhere in Studio. */
  objectName: string;
  /** What the action will do. Shown before anything happens. */
  consequence: ReactNode;
  severity: ConfirmSeverity;
  /** The real way back, or the plain statement that there is none. */
  recovery: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  /**
   * When set, the operator must type this exact text. Reserved for permanent
   * actions whose blast radius justifies the friction.
   */
  requireExactText?: string;
  requireExactHint?: string;
  /** An explicit acknowledgement, for permanent actions with no typed name. */
  acknowledgement?: string;
  /** The Server Action the confirmation dispatches, with its hidden fields. */
  action: (formData: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  /** The exact-text field name, so the SERVER can revalidate what was typed. */
  exactTextFieldName?: string;
  /** Anything else the dialog should show — an impact summary, for instance. */
  children?: ReactNode;
  /** A server error from a previous attempt, shown inside the dialog. */
  error?: string | null;
};

export function ConfirmAction({
  trigger,
  triggerClassName,
  title,
  objectName,
  consequence,
  severity,
  recovery,
  confirmLabel,
  pendingLabel = "Aplicando…",
  requireExactText,
  requireExactHint,
  acknowledgement,
  action,
  fields = {},
  exactTextFieldName = "confirmation_name",
  children,
  error = null,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;

  /**
   * Opening resets the confirmation. It happens in the event handler rather
   * than in an effect, so a reopened dialog never renders once carrying the
   * previous attempt's typed name before clearing it.
   */
  function openDialog() {
    setTyped("");
    setAcknowledged(false);
    setOpen(true);
  }

  // Focus enters the dialog when it opens and returns to the control that
  // opened it when it closes, so a keyboard user is never dropped at the top of
  // the document after cancelling.
  useEffect(() => {
    if (!open) return;
    // Captured now: by cleanup time the ref may already point elsewhere.
    const triggerNode = triggerRef.current;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => triggerNode?.focus();
  }, [open]);

  // Escape cancels, and Tab cycles inside the dialog rather than wandering into
  // the page behind it.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const textSatisfied =
    !requireExactText || typed.normalize("NFC").replace(/\s+/gu, " ").trim() ===
      requireExactText.normalize("NFC").replace(/\s+/gu, " ").trim();
  const acknowledgeSatisfied = !acknowledgement || acknowledged;
  const blocked = !textSatisfied || !acknowledgeSatisfied;

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/45 p-0 sm:items-center sm:p-6">
      {/* Clicking outside cancels. Cancelling is always the safe outcome, so it
          never needs its own confirmation. */}
      <button
        type="button"
        aria-label="Cancelar"
        tabIndex={-1}
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={() => setOpen(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-t-2xl border border-line bg-surface p-5 shadow-lifted sm:rounded-2xl sm:p-6"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold text-strong">
          {title}
        </h2>
        <p className="mt-1 break-words text-sm font-medium text-body">{objectName}</p>

        <div id={bodyId} className="mt-4 space-y-3 text-sm text-body">
          <div>{consequence}</div>
          <div className={`rounded-lg border px-3 py-2.5 ${SEVERITY_BOX[severity]}`}>
            <p className="font-semibold">{SEVERITY_NOTE[severity]}</p>
            <div className="mt-1">{recovery}</div>
          </div>
          {children}
        </div>

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {/*
          The dialog closes only once the action has actually settled. A Server
          Action that redirects never gets here, because the navigation replaces
          the page; one that resolves in place — the import revert — leaves the
          operator back on the page with its own result message visible.
        */}
        <form
          action={async (formData: FormData) => {
            await action(formData);
            setOpen(false);
          }}
          className="mt-5"
        >
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          {requireExactText ? (
            <label className="block text-sm font-medium text-strong">
              {requireExactHint ?? `Escribe “${requireExactText}” para confirmar`}
              <input
                className="mt-1.5 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-normal text-strong"
                name={exactTextFieldName}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${baseId}-typed`}
              />
              <span id={`${baseId}-typed`} className="mt-1 block text-xs text-muted">
                {textSatisfied
                  ? "Coincide."
                  : "Tiene que coincidir exactamente, con mayúsculas y acentos."}
              </span>
            </label>
          ) : null}

          {acknowledgement ? (
            <label className="mt-3 flex items-start gap-2.5 text-sm text-body">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                name="acknowledged"
                value="on"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>{acknowledgement}</span>
            </label>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-end gap-2.5">
            <button type="button" className={CANCEL_CLASS} onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <ConfirmSubmit
              severity={severity}
              label={confirmLabel}
              pendingLabel={pendingLabel}
              blocked={blocked}
            />
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={
          triggerClassName ??
          (severity === "permanent"
            ? "inline-flex min-h-11 items-center justify-center rounded-lg border border-danger-line px-3 py-2 text-sm font-semibold text-danger hover:bg-danger-surface"
            : "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken")
        }
        onClick={openDialog}
      >
        {trigger}
      </button>
      {/*
        Rendered into the document body so the dialog is never a `<form>` nested
        inside the form it sits beside — invalid markup that silently breaks the
        outer submission. It exists only while `open`, and `open` can only
        become true from a real click, so there is never a server render of it.
      */}
      {open && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}
