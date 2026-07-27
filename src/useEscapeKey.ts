import { useEffect } from "react";

/**
 * Close-on-Escape for dialogs. Pass `undefined` to opt a dialog out - used for
 * steps that must not be abandoned halfway.
 */
export function useEscapeKey(onEscape: (() => void) | undefined) {
  useEffect(() => {
    if (!onEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onEscape]);
}
