"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Tracks an element's content width (for SVG charts that size to their container).
 * Uses a callback ref, so an element that mounts after the first render (for example
 * once a loading skeleton is replaced) is still measured.
 */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  const ref = useCallback((node: T | null) => setElement(node), []);
  useEffect(() => {
    if (!element) return;
    const update = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, width };
}
