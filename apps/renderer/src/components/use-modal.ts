import { useEffect, type RefObject } from 'react';
/** Modal keyboard/focus ownership, including restoration after close. */
export function useModal(ref: RefObject<HTMLElement>, close: () => void) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (!panel) return;
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(e => !e.hidden);
    (focusable()[0] ?? panel).focus();
    const topmost = () => Array.from(document.querySelectorAll('[aria-modal="true"]')).at(-1) === panel;
    const key = (event: KeyboardEvent) => {
      if (!topmost()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const items = focusable(); const index = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); (items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length] ?? panel).focus();
      }
    };
    const focus = (event: FocusEvent) => { if (topmost() && !panel.contains(event.target as Node)) (focusable()[0] ?? panel).focus(); };
    document.addEventListener('keydown', key, true); document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', focus); if (previous?.isConnected) previous.focus(); };
  }, [ref, close]);
}
