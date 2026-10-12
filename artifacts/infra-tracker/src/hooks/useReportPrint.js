import { useCallback, useEffect, useState } from 'react';

const nextPaint = () => new Promise(resolve => {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  } else {
    window.setTimeout(resolve, 0);
  }
});

export default function useReportPrint(appendixRef, readinessRef) {
  const [printStatus, setPrintStatus] = useState({ state: 'idle', loaded: 0, total: 0, message: '' });

  useEffect(() => {
    const handleBeforePrint = () => appendixRef.current?.mountForPrint();
    window.addEventListener('beforeprint', handleBeforePrint);
    return () => window.removeEventListener('beforeprint', handleBeforePrint);
  }, [appendixRef]);

  const printReport = useCallback(async () => {
    const appendix = appendixRef.current;
    setPrintStatus({ state: 'preparing', loaded: 0, total: appendix?.printImageCount || 0, message: '' });
    try {
      if (readinessRef && !readinessRef.current) {
        throw new Error('Daily Updates is not ready. Wait for it to load or retry the history before printing.');
      }
      await appendix?.prepareForPrint(({ loaded, total }) => {
        setPrintStatus({ state: 'preparing', loaded, total, message: '' });
      });
      await nextPaint();
      if (appendixRef.current !== appendix) {
        throw new Error('The report changed while preparing attachments. Please print the current report again.');
      }
      if (readinessRef && !readinessRef.current) {
        throw new Error('Daily Updates changed while preparing the report. Wait for it to finish loading and print again.');
      }
      setPrintStatus({ state: 'idle', loaded: 0, total: 0, message: '' });
      window.print();
    } catch (error) {
      setPrintStatus({
        state: 'error',
        loaded: 0,
        total: appendix?.printImageCount || 0,
        message: `${error.message || 'One or more attachments could not be loaded.'} Print was cancelled so the report does not omit image evidence.`,
      });
    }
  }, [appendixRef, readinessRef]);

  return { printStatus, printReport };
}