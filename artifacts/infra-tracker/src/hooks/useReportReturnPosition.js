import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const storageKey = 'infra-report-return-positions';
const positions = new Map();
const hrefOf = element => element?.getAttribute('href');

function remember(key, position) {
  positions.delete(key);
  positions.set(key, position);
  if (positions.size > 20) positions.delete(positions.keys().next().value);
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify([...positions]));
  } catch {
    // In-memory restoration still works when browser storage is unavailable.
  }
}

function recall(key) {
  if (positions.has(key)) return positions.get(key);
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey) || '[]');
    const position = stored.find(([entryKey]) => entryKey === key)?.[1];
    return position && Number.isFinite(position.x) && Number.isFinite(position.y)
      && Number.isFinite(position.linkTop) && Array.isArray(position.openChoices)
      && Array.isArray(position.tableScrolls) ? position : null;
  } catch {
    return null;
  }
}

export default function useReportReturnPosition(ready) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const rootRef = useRef(null);
  const restoredKey = useRef(null);
  const key = `${location.key}:${location.pathname}${location.search}`;

  const capturePosition = event => {
    const link = event.target.closest?.('a.daily-checklist-link');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const root = rootRef.current;
    remember(key, {
      x: window.scrollX,
      y: window.scrollY,
      link: hrefOf(link),
      linkTop: link.getBoundingClientRect().top,
      openChoices: [...root.querySelectorAll('.daily-checklist-chooser[open]')]
        .map(chooser => hrefOf(chooser.querySelector('a'))),
      tableScrolls: [...root.querySelectorAll('.daily-table-wrap')].map(table => table.scrollLeft),
    });
  };

  useLayoutEffect(() => {
    if (!ready || !rootRef.current || navigationType !== 'POP' || restoredKey.current === key) return;
    restoredKey.current = key;
    const position = recall(key);
    if (!position) return;
    const root = rootRef.current;
    // Restore the report's layout before measuring the originating link.
    root.querySelectorAll('.daily-checklist-chooser').forEach(chooser => {
      chooser.open = position.openChoices.includes(hrefOf(chooser.querySelector('a')));
    });
    root.querySelectorAll('.daily-table-wrap').forEach((table, index) => {
      table.scrollLeft = position.tableScrolls[index] || 0;
    });
    const link = [...root.querySelectorAll('a.daily-checklist-link')]
      .find(element => hrefOf(element) === position.link);
    const top = link
      ? window.scrollY + link.getBoundingClientRect().top - position.linkTop
      : position.y;
    link?.focus({ preventScroll: true });
    window.scrollTo({ left: position.x, top: Math.max(0, top), behavior: 'instant' });
  }, [key, navigationType, ready]);

  return { rootRef, capturePosition };
}