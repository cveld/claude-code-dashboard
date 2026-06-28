'use client';

import { useEffect, useRef, useState } from 'react';

const PAGES = [
  { label: 'Projects', url: '/' },
  { label: 'Sessions', url: '/sessions' },
  { label: 'Settings', url: '/settings' },
  { label: 'Components', url: '/gallery/components' },
];

const WIDTHS = [375, 768, 1024, 1400] as const;

const CLIP_PRESETS: Partial<Record<number, { label: string; height: number }>> = {
  375: { label: 'portrait', height: 667 },
  768: { label: 'landscape', height: 432 },
};

type DevicePreset = {
  label: string;
  width: number;
  height: number;
};

const DEVICE_PRESETS: DevicePreset[] = [
  { label: 'portrait', width: 360, height: 639 },
  { label: 'landscape', width: 695, height: 274 },
];

const CHROME_BAR_H = 56;

function ChromeBar({ url }: { url: string }) {
  const display = `localhost:3000${url === '/' ? '' : url}`;
  return (
    <div style={{
      height: CHROME_BAR_H,
      background: '#202124',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 8,
      flexShrink: 0,
    }}>
      {/* back button */}
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ opacity: 0.5 }}>
        <path d="M12 5l-5 5 5 5" stroke="#e8eaed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* address pill */}
      <div style={{
        flex: 1,
        height: 36,
        background: '#3c3c3c',
        borderRadius: 18,
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        gap: 6,
        overflow: 'hidden',
      }}>
        {/* lock */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="#bdc1c6" style={{ flexShrink: 0 }}>
          <rect x="2" y="5" width="8" height="6" rx="1" />
          <path d="M4 5V3.5a2 2 0 0 1 4 0V5" stroke="#bdc1c6" strokeWidth="1.2" fill="none" />
        </svg>
        <span style={{ color: '#e8eaed', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {display}
        </span>
      </div>

      {/* tab count */}
      <div style={{
        width: 24,
        height: 24,
        border: '1.5px solid #bdc1c6',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#bdc1c6',
        fontSize: 11,
        fontWeight: 600,
        flexShrink: 0,
      }}>
        1
      </div>

      {/* kebab */}
      <svg width="20" height="20" viewBox="0 0 20 20" fill="#bdc1c6">
        <circle cx="10" cy="4" r="1.5" />
        <circle cx="10" cy="10" r="1.5" />
        <circle cx="10" cy="16" r="1.5" />
      </svg>
    </div>
  );
}

export function ResponsiveViewer() {
  const [pageIdx, setPageIdx] = useState(0);
  const [width, setWidth] = useState<number>(1400);
  const [clipActive, setClipActive] = useState(false);
  const [activeDevice, setActiveDevice] = useState<DevicePreset | null>(null);
  const [showAddressBar, setShowAddressBar] = useState(false);
  const [barScrollOffset, setBarScrollOffset] = useState(0);
  const [showDimensions, setShowDimensions] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [containerW, setContainerW] = useState(1000);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll listener on same-origin iframe drives chrome bar hide-on-scroll.
  // iframeFullH is constant so no resize occurs mid-scroll — only the wrapper
  // translates up, sliding the bar behind the overflow:hidden clip edge.
  useEffect(() => {
    setBarScrollOffset(0);
    if (!showAddressBar) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let removeScroll: (() => void) | undefined;
    const attach = () => {
      const win = iframe.contentWindow;
      if (!win) return;
      removeScroll?.();
      const onScroll = () => setBarScrollOffset(Math.min(win.scrollY, CHROME_BAR_H));
      win.addEventListener('scroll', onScroll, { passive: true });
      removeScroll = () => win.removeEventListener('scroll', onScroll);
    };
    iframe.addEventListener('load', attach);
    if (iframe.contentDocument?.readyState === 'complete') attach();
    return () => {
      iframe.removeEventListener('load', attach);
      removeScroll?.();
    };
  }, [showAddressBar, frameKey]);

  function switchWidth(w: number) {
    setWidth(w);
    setActiveDevice(null);
    setBarScrollOffset(0);
    if (!CLIP_PRESETS[w]) setClipActive(false);
  }

  function activateDevice(device: DevicePreset) {
    setWidth(device.width);
    setActiveDevice(device);
    setClipActive(true);
    setShowAddressBar(true);
    setBarScrollOffset(0);
    setFrameKey((k) => k + 1);
  }

  function switchPage(i: number) {
    setPageIdx(i);
    setBarScrollOffset(0);
    setFrameKey((k) => k + 1);
  }

  const viewerW = Math.min(containerW, width);
  const scale = viewerW / width;

  // Device preset takes priority over generic CLIP_PRESETS
  const genericPreset = !activeDevice ? CLIP_PRESETS[width] : undefined;
  const clipHeight = activeDevice?.height ?? genericPreset?.height ?? null;
  const renderedH = clipActive && clipHeight ? clipHeight : 1200;

  // renderedH = content viewport height (window.innerHeight with bar visible, e.g. 639px).
  // Chrome bar sits ON TOP — total viewer height = renderedH + CHROME_BAR_H (constant).
  // iframeFullH is always renderedH + CHROME_BAR_H so the iframe never resizes mid-scroll.
  // The inner wrapper translates up by barScrollOffset, bar slides behind the clip edge,
  // and the extra iframe height fills in at the bottom — matching Android Chrome's behaviour.
  const iframeFullH = renderedH + (showAddressBar ? CHROME_BAR_H : 0);
  const barOffset = barScrollOffset;
  const containerH = Math.ceil(iframeFullH * scale);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {PAGES.map((p, i) => (
          <button
            key={p.url}
            onClick={() => switchPage(i)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              i === pageIdx
                ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Phone device presets */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs text-zinc-600">phone:</span>
        {DEVICE_PRESETS.map((device) => (
          <button
            key={device.label}
            onClick={() => activateDevice(device)}
            className={`text-xs px-3 py-1.5 rounded border font-mono transition-colors ${
              activeDevice?.label === device.label
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
            }`}
          >
            {device.label} {device.width}×{device.height}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {WIDTHS.map((w) => (
          <button
            key={w}
            onClick={() => switchWidth(w)}
            className={`text-xs px-3 py-1.5 rounded border font-mono transition-colors ${
              w === width && !activeDevice
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
            }`}
          >
            {w}px
          </button>
        ))}
        {genericPreset && (
          <button
            onClick={() => setClipActive((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              clipActive
                ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
            }`}
          >
            {genericPreset.label} ×{genericPreset.height}px
          </button>
        )}
        <button
          onClick={() => { setShowAddressBar((v) => !v); setBarScrollOffset(0); }}
          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
            showAddressBar
              ? 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300'
              : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
          }`}
        >
          chrome bar
        </button>
        <button
          onClick={() => setShowDimensions((v) => !v)}
          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
            showDimensions
              ? 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300'
              : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
          }`}
        >
          dimensions
        </button>
        <span className="text-xs text-zinc-600 ml-1">{Math.round(scale * 100)}%</span>
      </div>

      <div ref={containerRef} className="w-full">
        <div className="relative" style={{ width: viewerW }}>
          <div
            className="rounded-lg overflow-hidden border border-zinc-800"
            style={{ height: containerH }}
          >
            {/*
              Two-state model: bar visible (barOffset=0) or bar hidden (barOffset=CHROME_BAR_H).
              The inner div slides up by barOffset so the bar disappears behind the clip edge.
              The iframe always has iframeFullH height so content fills in as the bar hides.
            */}
            <div style={{
              width,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}>
              <div style={{
                transform: `translateY(-${barOffset}px)`,
                transition: 'transform 0.3s ease',
              }}>
                {showAddressBar && <ChromeBar url={PAGES[pageIdx].url} />}
                <iframe
                  ref={iframeRef}
                  key={`${frameKey}-${width}-${showAddressBar}`}
                  src={PAGES[pageIdx].url}
                  width={width}
                  height={iframeFullH}
                  style={{ display: 'block', border: 'none' }}
                />
              </div>
            </div>
          </div>
          {showDimensions && (
            <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-black/70 text-zinc-300 font-mono text-xs tabular-nums pointer-events-none">
              {width} × {renderedH}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
