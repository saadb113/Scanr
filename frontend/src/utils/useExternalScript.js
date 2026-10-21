import { useEffect, useState } from 'react';

const loaded = new Set();

// Loads a <script src> once per page and reports when it's ready, so multiple
// components mounting/unmounting (e.g. React StrictMode, route re-entry) don't
// inject the same external widget script twice.
export function useExternalScript(src) {
  const [ready, setReady] = useState(loaded.has(src));

  useEffect(() => {
    if (loaded.has(src)) {
      setReady(true);
      return;
    }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => { loaded.add(src); setReady(true); });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => { loaded.add(src); setReady(true); };
    document.body.appendChild(script);
  }, [src]);

  return ready;
}
