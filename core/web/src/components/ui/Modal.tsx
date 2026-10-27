import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Selector for elements that should be reachable via Tab inside the
// dialog. Matches any element that can receive focus by default or via
// tabindex, and any form control that supports keyboard input. Skips
// disabled / hidden / tabindex="-1" elements.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex^="-"])',
].join(',');

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Remember the element that had focus when the modal opened so we
  // can put the user back there on close — modal interactions should
  // not silently lose the user's place on the page behind the dialog.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Escape closes; Tab cycles within the dialog; first focusable lands
  // on open. We rely on this single keydown handler instead of mixing
  // per-element focus listeners so the trap stays consistent regardless
  // of how the dialog body is structured.
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    // Stash the element that had focus BEFORE the modal stole it.
    // document.activeElement can be <body> when nothing is focused;
    // typeof check guards against that edge case.
    const active = document.activeElement;
    previouslyFocusedRef.current =
      active instanceof HTMLElement ? active : null;

    const focusables = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
      );

    // Move focus inside the modal. Prefer the first focusable child;
    // fall back to the dialog container itself so screen readers still
    // announce it via aria-modal.
    const first = focusables()[0] ?? dialog;
    first.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) {
        // Nothing tabbable inside — swallow Tab so the browser does
        // not jump focus out to the page behind the dialog.
        e.preventDefault();
        dialog.focus();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab on the first element wraps to the last.
        if (activeEl === firstEl || !dialog.contains(activeEl)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        // Tab on the last element wraps to the first.
        if (activeEl === lastEl || !dialog.contains(activeEl)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Restore focus to the element that opened the modal. Guard
      // against the ref going stale (the opener may have been
      // unmounted while the modal was open — e.g. a row that got
      // deleted from the list).
      const target = previouslyFocusedRef.current;
      if (target && document.contains(target)) {
        target.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthClass =
    size === 'sm'
      ? 'max-w-sm'
      : size === 'md'
        ? 'max-w-md'
        : size === 'lg'
          ? 'max-w-2xl'
          : 'max-w-4xl';

  return createPortal(
    // The outer overlay intentionally does NOT close the modal on click.
    // Closing on backdrop click has been a source of accidental data
    // loss in the edit / import / confirm modals — users dismiss
    // imprecisely. Close is only triggered by Escape, the ✕ button, or
    // the footer buttons (which call onClose explicitly).
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg bg-surface shadow-lift outline-none dark:bg-[#262019] ${widthClass}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-ink dark:text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted hover:text-ink dark:text-slate-400 dark:hover:text-slate-100"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
