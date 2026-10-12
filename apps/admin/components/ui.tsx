'use client';
// Small, consistent building blocks for every CMS screen.
import type { DraftColor } from '@b4/shared';
import Link from 'next/link';
import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Tone } from '@/lib/labels';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'; size?: 'sm' | 'md'; busy?: boolean };

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-deep disabled:bg-brand/50',
  dark: 'bg-ink text-white hover:bg-night disabled:bg-ink/40',
  secondary: 'bg-white text-ink ring-1 ring-line hover:bg-stone disabled:text-muted',
  ghost: 'text-ink-2 hover:bg-stone disabled:text-muted',
  danger: 'bg-white text-brand ring-1 ring-brand/40 hover:bg-brand-soft disabled:opacity-50',
};

export function Button({ variant = 'secondary', size = 'md', busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-[15px]',
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = 'secondary', className, children }: { href: string; variant?: ButtonProps['variant']; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx('inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition-colors', VARIANTS[variant ?? 'secondary'], className)}>
      {children}
    </Link>
  );
}

const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-brand-soft text-brand-deep',
  info: 'bg-info-soft text-info',
  muted: 'bg-stone text-muted',
  ink: 'bg-ink text-white',
};

export function Badge({ tone = 'muted', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', TONES[tone], className)}>{children}</span>;
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-xl bg-white ring-1 ring-line', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
          {title && <h2 className="text-base font-extrabold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span aria-hidden className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'size-3.5' : 'size-5')} />;
}

export function Loading({ label = 'טוען…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <p className="font-display text-lg font-extrabold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-[15px] text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'משהו השתבש';
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-xl bg-brand-soft px-5 py-4 text-brand-deep">
      <span className="font-semibold">{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          לנסות שוב
        </Button>
      )}
    </div>
  );
}

export function ColorDot({ color, className }: { color: DraftColor | null; className?: string }) {
  if (!color) return null;
  return <span aria-hidden className={cx('inline-block size-3 shrink-0 rounded-full', className)} style={{ background: `var(--color-label-${color})` }} />;
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-bold text-ink-2">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs font-semibold text-brand">{error}</p>}
    </div>
  );
}

export const inputClass =
  'block w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] placeholder:text-muted/70 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:bg-stone';

export function Thumb({ src, alt = '', className }: { src: string | null; alt?: string; className?: string }) {
  if (!src) return <div className={cx('rounded-md bg-gradient-to-br from-stone to-line', className)} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- external and API-hosted images
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={cx('rounded-md bg-stone object-cover', className)} />;
}

// --- Toasts ------------------------------------------------------------------
type Toast = { id: number; text: string; tone: 'ok' | 'danger' };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'danger' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-5 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-[15px] font-semibold shadow-lg', t.tone === 'ok' ? 'bg-ink text-white' : 'bg-brand text-white')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
