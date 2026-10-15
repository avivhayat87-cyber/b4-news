'use client';

import { useEffect, useRef, useState } from 'react';
import { CHART_SYMBOLS, MARKET_GROUPS, TICKER_SYMBOLS } from '@/lib/markets';
import { NEW_WINDOW } from './ui';

type Kind = 'ticker-tape' | 'market-overview' | 'market-quotes' | 'stock-heatmap' | 'screener' | 'advanced-chart' | 'events';

const UP = '#11743A';
const DOWN = '#D9121F';

/**
 * One TradingView embed. Their script swaps its own markup for an iframe, so the box is
 * filled by hand and React never renders inside it. The attribution link under each widget
 * is the condition for using the widgets for free: keep it visible.
 */
export function TradingViewWidget({
  kind,
  config,
  title,
  lazy = true,
  className = '',
}: {
  kind: Kind;
  config: Record<string, unknown>;
  /** Accessible name of the widget's iframe. */
  title: string;
  /** Load only when scrolled near, so third-party code stays off the first paint. */
  lazy?: boolean;
  /** Sizes the box; the widget fills it. */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(!lazy);
  const [loaded, setLoaded] = useState(false);
  const settings = JSON.stringify({ locale: 'he_IL', colorTheme: 'light', isTransparent: true, ...config });

  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    const el = ref.current;
    if (!near || !el) return;
    setLoaded(false);
    // `load` doesn't bubble, but a capturing listener still sees the iframe's.
    const onLoad = (e: Event) => {
      if (!(e.target instanceof HTMLIFrameElement)) return;
      e.target.title = title;
      setLoaded(true);
    };
    el.addEventListener('load', onLoad, true);
    // Deferred so React's development double-mount doesn't inject the script twice.
    const timer = setTimeout(() => {
      const widget = document.createElement('div');
      widget.className = 'tradingview-widget-container__widget';
      const credit = document.createElement('div');
      credit.className = 'tradingview-widget-copyright';
      const link = document.createElement('a');
      link.href = 'https://www.tradingview.com/';
      link.target = '_blank';
      link.rel = 'noopener nofollow';
      const label = document.createElement('span');
      label.className = 'tv-credit-label';
      label.textContent = 'נתוני שוק: ';
      const text = document.createElement('span');
      text.className = 'blue-text';
      text.append(label, 'TradingView');
      const hint = document.createElement('span');
      hint.className = 'sr-only';
      hint.textContent = NEW_WINDOW;
      link.append(text, hint);
      credit.append(link);
      const script = document.createElement('script');
      script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${kind}.js`;
      script.async = true;
      script.text = settings;
      el.replaceChildren(widget, credit, script);
    }, 0);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('load', onLoad, true);
      el.replaceChildren();
    };
  }, [near, kind, settings, title]);

  return (
    <div className={`relative ${className}`}>
      <div ref={ref} className="tradingview-widget-container h-full w-full" />
      {loaded ? null : (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white text-sm text-muted">טוען נתונים…</p>
      )}
    </div>
  );
}

const lineColors = {
  plotLineColorGrowing: UP,
  plotLineColorFalling: DOWN,
  belowLineFillColorGrowing: 'rgba(17, 116, 58, 0.12)',
  belowLineFillColorFalling: 'rgba(217, 18, 31, 0.12)',
  belowLineFillColorGrowingBottom: 'rgba(17, 116, 58, 0)',
  belowLineFillColorFallingBottom: 'rgba(217, 18, 31, 0)',
  gridLineColor: 'rgba(0, 0, 0, 0)',
  scaleFontColor: '#6B6B73',
  symbolActiveColor: 'rgba(217, 18, 31, 0.08)',
};

/**
 * The headline numbers, scrolling across the top of the homepage: one line on wider screens;
 * on phones the compact layout stacks name, price and change (76px, measured).
 */
export function MarketTicker() {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  // Wait for the screen size so the widget loads once, in the right layout.
  if (wide === null) return <div className="h-[76px] md:h-[46px]" />;
  return (
    <TradingViewWidget
      kind="ticker-tape"
      lazy={false}
      title="מדדים מובילים"
      className="tv-inline-credit h-[76px] md:h-[46px]"
      config={{
        symbols: TICKER_SYMBOLS.map((s) => ({ proName: s.symbol, title: s.label })),
        showSymbolLogo: true,
        displayMode: wide ? 'adaptive' : 'compact',
      }}
    />
  );
}

/** Tabs per market with a chart of the selected symbol. Sized for a sidebar: four symbols per market. */
export function MarketOverview({ className = 'h-[560px]' }: { className?: string }) {
  return (
    <TradingViewWidget
      kind="market-overview"
      title="סקירת שווקים"
      className={className}
      config={{
        width: '100%',
        height: '100%',
        dateRange: '1D',
        showChart: true,
        showSymbolLogo: true,
        showFloatingTooltip: true,
        ...lineColors,
        tabs: MARKET_GROUPS.map((g) => ({ title: g.name, originalTitle: g.name, symbols: g.symbols.slice(0, 4).map((s) => ({ s: s.symbol, d: s.label })) })),
      }}
    />
  );
}

/** A wide quote table per market. */
export function MarketQuotes() {
  return (
    <TradingViewWidget
      kind="market-quotes"
      title="טבלת שערים"
      className="h-[520px]"
      config={{
        width: '100%',
        height: '100%',
        showSymbolLogo: true,
        symbolsGroups: MARKET_GROUPS.map((g) => ({ name: g.name, originalName: g.name, symbols: g.symbols.map((s) => ({ name: s.symbol, displayName: s.label })) })),
      }}
    />
  );
}

export function StockHeatmap() {
  return (
    <TradingViewWidget
      kind="stock-heatmap"
      title="מפת חום של מניות"
      className="h-[min(720px,80vh)] min-h-[480px]"
      config={{
        width: '100%',
        height: '100%',
        dataSource: 'TA125',
        exchanges: [],
        grouping: 'sector',
        blockSize: 'market_cap_basic',
        blockColor: 'change',
        hasTopBar: true,
        isDataSetEnabled: true,
        isZoomEnabled: true,
        hasSymbolTooltip: true,
        isMonoSize: false,
      }}
    />
  );
}

export function StockScreener() {
  return (
    <TradingViewWidget
      kind="screener"
      title="סורק מניות"
      className="h-[min(760px,85vh)] min-h-[520px]"
      config={{ width: '100%', height: '100%', market: 'israel', defaultColumn: 'overview', defaultScreen: 'most_capitalized', showToolbar: true }}
    />
  );
}

/** The full charting tool, with quick picks for the most-watched symbols. */
export function ChartPanel() {
  const [symbol, setSymbol] = useState(CHART_SYMBOLS[0]!.symbol);
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="בחירת נייר ערך" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {CHART_SYMBOLS.map((s) => (
          <button
            key={s.symbol}
            type="button"
            aria-pressed={s.symbol === symbol}
            onClick={() => setSymbol(s.symbol)}
            className={`h-10 shrink-0 cursor-pointer rounded-full border-[1.5px] px-4 text-[15px] font-bold ${
              s.symbol === symbol ? 'border-ink bg-ink text-white' : 'border-line text-ink hover:border-ink'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <TradingViewWidget
        kind="advanced-chart"
        lazy={false}
        title="גרף אינטראקטיבי"
        className="h-[min(680px,75vh)] min-h-[460px]"
        config={{
          autosize: true,
          symbol,
          interval: 'D',
          timezone: 'Asia/Jerusalem',
          theme: 'light',
          style: '1',
          allow_symbol_change: true,
          calendar: false,
          support_host: 'https://www.tradingview.com',
        }}
      />
    </div>
  );
}

export function EconomicCalendar() {
  return (
    <TradingViewWidget
      kind="events"
      title="יומן כלכלי"
      className="h-[min(760px,85vh)] min-h-[520px]"
      config={{ width: '100%', height: '100%', importanceFilter: '0,1', countryFilter: 'il,us,eu,gb,de,cn,jp' }}
    />
  );
}
