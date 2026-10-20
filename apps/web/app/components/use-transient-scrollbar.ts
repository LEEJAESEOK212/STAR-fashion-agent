"use client";

import { UIEvent, useCallback, useEffect, useRef } from "react";

export function useTransientScrollbar<T extends HTMLElement>(
  shellSelector = ".chat-thread-shell",
  variablePrefix = "thread-scroll",
) {
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
  }, []);

  return useCallback((event: UIEvent<T>) => {
    const element = event.currentTarget;
    const shell = element.closest<HTMLElement>(shellSelector);
    if (!shell) return;

    const trackHeight = Math.max(0, element.clientHeight - 16);
    const scrollRange = element.scrollHeight - element.clientHeight;
    const thumbHeight = Math.max(48, trackHeight * (element.clientHeight / element.scrollHeight));
    const thumbRange = Math.max(0, trackHeight - thumbHeight);
    const thumbOffset = scrollRange > 0 ? (element.scrollTop / scrollRange) * thumbRange : 0;

    shell.style.setProperty(`--${variablePrefix}-thumb-height`, `${thumbHeight}px`);
    shell.style.setProperty(`--${variablePrefix}-thumb-offset`, `${thumbOffset}px`);
    shell.classList.toggle("is-scrolling", scrollRange > 0);

    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      shell.classList.remove("is-scrolling");
      hideTimerRef.current = null;
    }, 800);
  }, [shellSelector, variablePrefix]);
}
