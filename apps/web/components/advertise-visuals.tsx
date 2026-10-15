// Drawings for the "advertise with us" page: a page of the site with its ad places lit up, and a
// small picture of each ad format. Built from blocks in the brand colors (no images to load).

const Line = ({ w, dark = false }: { w: string; dark?: boolean }) => <span className={`block h-2 rounded-full ${dark ? 'bg-ink/70' : 'bg-line'}`} style={{ width: w }} />;

/** The label every ad carries, in miniature. */
function MiniLabel() {
  return <span className="absolute right-1.5 top-1.5 rounded bg-white/90 px-1 text-[8px] font-bold leading-[14px] text-ink-2">פרסומת</span>;
}

/** A page of the site in a browser window, its ad places in the brand red. */
export function PageMock() {
  return (
    <div aria-hidden="true" className="w-full max-w-[520px] overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_-20px_rgba(0,0,0,.55)] ring-1 ring-white/10">
      <div className="flex items-center gap-1.5 bg-stone px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-line" />
        <span className="mx-auto h-4 w-40 rounded bg-white" />
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark */}
          <img src="/brand/b4-mark.svg" alt="" width={22} height={22} />
          <div className="flex gap-1.5">
            {[28, 36, 24, 30].map((w) => (
              <Line key={w} w={`${w}px`} />
            ))}
          </div>
        </div>
        <div className="h-20 rounded-md bg-[linear-gradient(135deg,#3A3A40,#1C1C20)]" />
        <div className="relative flex h-14 items-center justify-between rounded-md bg-brand px-3 text-white">
          <MiniLabel />
          <span className="space-y-1.5">
            <span className="block h-2.5 w-36 rounded-full bg-white/90" />
            <span className="block h-2 w-24 rounded-full bg-white/60" />
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-extrabold text-brand">לפרטים</span>
        </div>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2">
                <span className="h-10 w-14 shrink-0 rounded bg-stone" />
                <span className="flex-1 space-y-1.5 pt-1">
                  <Line w="90%" dark />
                  <Line w="70%" />
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="h-10 rounded bg-stone" />
            <div className="relative flex h-24 flex-col justify-end gap-1 rounded bg-ink p-2">
              <MiniLabel />
              <span className="block h-2 w-14 rounded-full bg-white/80" />
              <span className="block h-1.5 w-10 rounded-full bg-brand" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One format, drawn small. */
export function FormatMock({ kind }: { kind: 'billboard' | 'rectangle' | 'native' | 'lead' }) {
  if (kind === 'billboard')
    return (
      <div aria-hidden="true" className="relative flex h-16 items-center justify-between rounded-md bg-[linear-gradient(115deg,#1C1C20,#3B1418)] px-4">
        <MiniLabel />
        <span className="space-y-1.5">
          <span className="block h-2.5 w-28 rounded-full bg-white/90" />
          <span className="block h-2 w-20 rounded-full bg-white/50" />
        </span>
        <span className="rounded-full bg-brand px-2.5 py-1 text-[9px] font-extrabold text-white">לפרטים</span>
      </div>
    );
  if (kind === 'rectangle')
    return (
      <div aria-hidden="true" className="relative mx-auto flex h-24 w-28 flex-col justify-end gap-1.5 rounded-md bg-brand p-3">
        <MiniLabel />
        <span className="block h-2.5 w-16 rounded-full bg-white/90" />
        <span className="block h-2 w-12 rounded-full bg-white/60" />
        <span className="mt-1 w-fit rounded-full bg-white px-2 py-0.5 text-[8px] font-extrabold text-brand">להרשמה</span>
      </div>
    );
  if (kind === 'native')
    return (
      <div aria-hidden="true" className="relative mx-auto w-36 overflow-hidden rounded-md bg-white ring-1 ring-line">
        <MiniLabel />
        <div className="h-12 bg-[linear-gradient(135deg,#C9C9D0,#E6E4E1)]" />
        <div className="space-y-1.5 p-2">
          <Line w="90%" dark />
          <Line w="70%" />
          <span className="block w-fit rounded-full bg-ink px-2 py-0.5 text-[8px] font-bold text-white">לפרטים</span>
        </div>
      </div>
    );
  return (
    <div aria-hidden="true" className="relative mx-auto w-36 space-y-1.5 rounded-md bg-white p-2.5 ring-1 ring-line">
      <MiniLabel />
      <span className="block pt-2 text-[9px] font-extrabold">רוצים הצעה?</span>
      <span className="block h-4 rounded border border-line" />
      <span className="block h-4 rounded border border-line" />
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm bg-brand" />
        <Line w="70%" />
      </span>
      <span className="block h-4 rounded-full bg-ink" />
    </div>
  );
}
