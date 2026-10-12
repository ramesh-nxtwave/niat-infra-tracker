import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// Capture at response commit, not request start: scrolling during an in-flight
// request must never be undone. No deferred scroll correction or focus change.
export default function useReportRefreshAnchor(rootRef, scope) {
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const snapshotRef = useRef(null);
  const interactionRef = useRef(0);

  useEffect(() => {
    const interacted = () => { interactionRef.current += 1; };
    const keys = event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interacted();
    };
    window.addEventListener('wheel', interacted, { passive: true });
    window.addEventListener('touchstart', interacted, { passive: true });
    window.addEventListener('pointerdown', interacted, { passive: true });
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('wheel', interacted);
      window.removeEventListener('touchstart', interacted);
      window.removeEventListener('pointerdown', interacted);
      window.removeEventListener('keydown', keys);
    };
  }, []);

  const capture = useCallback(() => {
    const root = rootRef.current;
    if (!root || window.scrollY === 0) return;
    const candidates = [...root.querySelectorAll('[data-report-anchor]')]
      .map(element => ({ element, top: element.getBoundingClientRect().top,
        bottom: element.getBoundingClientRect().bottom }))
      .filter(entry => entry.bottom > 0 && entry.top < window.innerHeight);
    if (!candidates.length) return;
    snapshotRef.current = {
      scope: scopeRef.current, interaction: interactionRef.current,
      candidates: candidates.map(({ element, top }) => ({
        key: element.getAttribute('data-report-anchor'), top,
      })),
    };
  }, [rootRef]);

  useLayoutEffect(() => {
    const snapshot = snapshotRef.current;
    snapshotRef.current = null;
    if (!snapshot || snapshot.scope !== scope || snapshot.interaction !== interactionRef.current) return;
    const elements = [...(rootRef.current?.querySelectorAll('[data-report-anchor]') || [])];
    // If the first visible row was removed, use another surviving visible row.
    // If all disappeared, leave the browser's naturally clamped position alone.
    for (const candidate of snapshot.candidates) {
      const element = elements.find(el => el.getAttribute('data-report-anchor') === candidate.key);
      if (!element) continue;
      const delta = element.getBoundingClientRect().top - candidate.top;
      if (Math.abs(delta) > 1) {
        window.scrollTo({ left: window.scrollX, top: Math.max(0, window.scrollY + delta), behavior: 'instant' });
      }
      break;
    }
  });
  return capture;
}
