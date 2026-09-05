import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Marks a scroll container as overflowing so CSS can fade its bottom edge.
 *
 * macOS hides scrollbars until you touch the trackpad, so a list clipped
 * mid-row reads as "that's everything". The fade is the only hint there is more,
 * and it must not appear on lists that fit - hence the measurement.
 */
export function useOverflowFade<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
    setOverflowing(node.scrollHeight > node.clientHeight + 1 && !atBottom);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    const mutations = new MutationObserver(() => {
      for (const child of node.children) observer.observe(child);
      measure();
    });
    mutations.observe(node, { childList: true });
    node.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      node.removeEventListener("scroll", measure);
    };
  }, [measure]);

  return { ref, overflowing };
}
