import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useFocusTrap<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const containerRef = useRef<T>(null);
  const returnTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (container === null) return undefined;

    returnTargetRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusableElements = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getAttribute("aria-hidden") !== "true" && element.offsetParent !== null,
      );

    if (!container.contains(document.activeElement)) {
      const preferred = container.querySelector<HTMLElement>("[data-initial-focus]");
      (preferred ?? focusableElements()[0] ?? container).focus();
    }

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        container.focus();
        return;
      }
      if (!container.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", keepFocusInside, true);
    return () => {
      document.removeEventListener("keydown", keepFocusInside, true);
      if (returnTargetRef.current?.isConnected === true) returnTargetRef.current.focus();
    };
  }, [active]);

  return containerRef;
}
