// Symbols and sections for the TradingView widgets (homepage ticker, sidebar overview, /markets).
// Symbols are TradingView codes; US and European indices use the CFD feeds that free widgets may show.

export type MarketSymbol = { symbol: string; label: string };
export type MarketGroup = { name: string; symbols: MarketSymbol[] };

export const MARKET_GROUPS: MarketGroup[] = [
  {
    name: 'ישראל',
    symbols: [
      { symbol: 'TASE:TA35', label: 'ת״א-35' },
      { symbol: 'TASE:TA125', label: 'ת״א-125' },
      { symbol: 'TASE:TA90', label: 'ת״א-90' },
      { symbol: 'TASE:TABANKS5', label: 'ת״א-בנקים 5' },
      { symbol: 'TASE:TATECHNOLOGY', label: 'ת״א-טכנולוגיה' },
      { symbol: 'TASE:TAREALESTATE15', label: 'ת״א-נדל״ן' },
    ],
  },
  {
    name: 'ארה״ב',
    symbols: [
      { symbol: 'FOREXCOM:SPXUSD', label: 'S&P 500' },
      { symbol: 'FOREXCOM:NSXUSD', label: 'נאסד״ק 100' },
      { symbol: 'FOREXCOM:DJI', label: 'דאו ג׳ונס' },
      { symbol: 'FOREXCOM:US2000', label: 'ראסל 2000' },
    ],
  },
  {
    name: 'אירופה ואסיה',
    symbols: [
      { symbol: 'FOREXCOM:UKXGBP', label: 'פוטסי 100' },
      { symbol: 'FOREXCOM:GRXEUR', label: 'דאקס' },
      { symbol: 'FOREXCOM:FRXEUR', label: 'CAC 40' },
      { symbol: 'FOREXCOM:JPXJPY', label: 'ניקיי 225' },
    ],
  },
  {
    name: 'סחורות',
    symbols: [
      { symbol: 'OANDA:XAUUSD', label: 'זהב' },
      { symbol: 'OANDA:XAGUSD', label: 'כסף' },
      { symbol: 'TVC:UKOIL', label: 'נפט ברנט' },
      { symbol: 'TVC:USOIL', label: 'נפט WTI' },
    ],
  },
  {
    name: 'מט״ח',
    symbols: [
      { symbol: 'FX_IDC:USDILS', label: 'דולר/שקל' },
      { symbol: 'FX_IDC:EURILS', label: 'אירו/שקל' },
      { symbol: 'FX_IDC:GBPILS', label: 'ליש״ט/שקל' },
      { symbol: 'FX:EURUSD', label: 'אירו/דולר' },
    ],
  },
  {
    name: 'קריפטו',
    symbols: [
      { symbol: 'BITSTAMP:BTCUSD', label: 'ביטקוין' },
      { symbol: 'BITSTAMP:ETHUSD', label: 'את׳ריום' },
    ],
  },
];

const bySymbol = new Map(MARKET_GROUPS.flatMap((g) => g.symbols).map((s) => [s.symbol, s]));
const pick = (...symbols: string[]) => symbols.map((s) => bySymbol.get(s)!);

/** The homepage ticker: the headline numbers. */
export const TICKER_SYMBOLS = pick(
  'TASE:TA35',
  'TASE:TA125',
  'FOREXCOM:SPXUSD',
  'FOREXCOM:NSXUSD',
  'FOREXCOM:DJI',
  'FX_IDC:USDILS',
  'FX_IDC:EURILS',
  'OANDA:XAUUSD',
  'TVC:UKOIL',
  'BITSTAMP:BTCUSD',
);

/** Quick picks above the interactive chart (any other symbol can be searched inside it). */
export const CHART_SYMBOLS = pick('TASE:TA35', 'TASE:TA125', 'FOREXCOM:SPXUSD', 'FOREXCOM:NSXUSD', 'FX_IDC:USDILS', 'OANDA:XAUUSD', 'BITSTAMP:BTCUSD');

/** Tabs of the markets page; the first one is /markets itself. */
export const MARKET_TABS = [
  { slug: '', label: 'סקירת שווקים', description: 'מדדים, סחורות, מטבעות וקריפטו במבט אחד.' },
  { slug: 'heatmap', label: 'מפת חום', description: 'כל מניה היא ריבוע: הגודל לפי שווי השוק, הצבע לפי השינוי היומי.' },
  { slug: 'screener', label: 'סורק מניות', description: 'סינון ומיון של מניות בבורסה בתל אביב ובעולם.' },
  { slug: 'charts', label: 'גרפים', description: 'גרף אינטראקטיבי לכל נייר ערך, עם כלי ניתוח טכני.' },
  { slug: 'calendar', label: 'יומן כלכלי', description: 'הודעות ריבית, נתוני אינפלציה, תעסוקה וצמיחה, לפי מדינה וחשיבות.' },
] as const;

export type MarketTabSlug = (typeof MARKET_TABS)[number]['slug'];

export const marketsHref = (slug: MarketTabSlug = '') => (slug ? `/markets/${slug}` : '/markets');
