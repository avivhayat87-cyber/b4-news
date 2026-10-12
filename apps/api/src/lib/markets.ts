// Market data for the ticker and the sidebar widget. Today: the Bank of Israel's
// official representative exchange rates (free, public, updated each business
// day). Index quotes need a licensed provider; nothing is shown rather than a placeholder.
import type { MarketQuote } from '@b4/shared';

const BOI_URL = 'https://boi.org.il/PublicApi/GetExchangeRates?asJson=true';
const TTL_MS = 30 * 60_000;
const SHOWN: Record<string, string> = { USD: 'דולר/שקל', EUR: 'אירו/שקל', GBP: 'ליש״ט/שקל' };

type BoiRate = { key: string; currentExchangeRate: number; currentChange: number; unit: number; lastUpdate: string };

let cache: { at: number; quotes: MarketQuote[] } | null = null;

export async function marketQuotes(fetchImpl: typeof fetch = fetch): Promise<MarketQuote[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.quotes;
  try {
    const res = await fetchImpl(BOI_URL, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { exchangeRates?: BoiRate[] };
    const quotes: MarketQuote[] = Object.keys(SHOWN).flatMap((key) => {
      const r = body.exchangeRates?.find((x) => x.key === key);
      if (!r || !Number.isFinite(r.currentExchangeRate)) return [];
      const change = Number(r.currentChange);
      return [
        {
          symbol: `${key}ILS`,
          name: SHOWN[key]!,
          value: (r.currentExchangeRate / (r.unit || 1)).toFixed(3),
          change: `${change > 0 ? '+' : ''}${change.toFixed(2)}%`,
          direction: change > 0.005 ? ('up' as const) : change < -0.005 ? ('down' as const) : ('flat' as const),
        },
      ];
    });
    cache = { at: Date.now(), quotes };
    return quotes;
  } catch {
    // Keep the last good values for a while; otherwise show nothing.
    return cache && Date.now() - cache.at < 6 * TTL_MS ? cache.quotes : [];
  }
}
