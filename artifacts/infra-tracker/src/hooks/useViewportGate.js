import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keep media unloaded until its placeholder is close to the viewport.
 * Consumers can call load when a user explicitly asks to see a preview.
 */
export function useViewportGate(forceLoad = false) {
  const targetRef = useRef(null);
  const [visible, setVisible] = useState(forceLoad);

  useEffect(() => {
    if (forceLoad) {
      setVisible(true);
      return undefined;
    }
    if (typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
      return undefined;
    }

    const observer = new window.IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px 0px' });

    if (targetRef.current) observer.observe(targetRef.current);
    return () => observer.disconnect();
  }, [forceLoad]);

  return { targetRef, visible, load: useCallback(() => setVisible(true), []) };
}

export default useViewportGate;