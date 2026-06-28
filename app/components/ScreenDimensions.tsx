'use client';

import { useEffect, useState } from 'react';

const HMR_STAMP = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function ScreenDimensions() {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    function update() {
      setDims({ w: window.innerWidth, h: window.innerHeight });
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (!dims) return null;

  return (
    <div className="fixed bottom-2 right-2 z-50 px-2 py-1 rounded bg-black/70 text-zinc-300 font-mono text-xs tabular-nums pointer-events-none">
      {dims.w} × {dims.h} · {HMR_STAMP}
    </div>
  );
}
