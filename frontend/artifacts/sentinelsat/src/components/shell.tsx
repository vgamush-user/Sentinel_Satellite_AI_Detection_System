import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link, useLocation } from 'wouter';
import { Activity, FlaskConical, LayoutGrid, Menu, MoreHorizontal, Pause, Play, PlugZap, RotateCcw, ScanSearch, ShieldAlert, SkipForward, Unplug, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { fmtAge, fmtTime } from '@/lib/sentinel/format';
import { useAdapter, useNow, useSentinel } from '@/lib/sentinel/store';
import { SOURCE_FALLBACK, SOURCE_SETTING } from '@/lib/sentinel/adapter';
import { Btn } from './kit';
import { SourceSettings } from './source-settings';
import { useBackend } from '@/lib/backend/context';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutGrid },
  { href: '/telemetry', label: 'Telemetry', icon: Activity },
  { href: '/incidents', label: 'Incidents', icon: ShieldAlert },
  { href: '/threat-lab', label: 'Threat Lab', icon: FlaskConical, tag: 'Simulation' },
  { href: '/analysis', label: 'Manual analysis', icon: ScanSearch },
];

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="var(--color-sun)" stroke="var(--color-palette-orange)" />
      <path d="M5 14.5 L8.5 14.5 L10.5 8 L13.5 17 L15.5 11.5 L19 11.5" fill="none" stroke="var(--color-info)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13.5" cy="17" r="1.6" fill="var(--color-action)" />
    </svg>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const [loc] = useLocation();
  const s = useSentinel();
  const open = s.incidents.filter((i) => i.lifecycle === 'open').length;
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const active = n.href === '/' ? loc === '/' : loc.startsWith(n.href);
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            data-testid={`link-nav-${n.label.replace(/\s+/g, '-').toLowerCase()}`}
            className={cn(
              'group relative flex h-10 items-center gap-2.5 rounded-[11px] px-2.5 text-[13px] transition-colors duration-150',
              active ? 'bg-sky font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-sky-strong)]' : 'text-ink-2 hover:bg-sun hover:text-ink',
            )}
          >
            {active && <span aria-hidden className="absolute -left-1 top-2.5 bottom-2.5 w-[3px] rounded-full bg-action" />}
            <Icon aria-hidden className={cn('size-4', active ? 'text-info-ink' : 'text-ink-3 group-hover:text-ink-2')} />
            <span className="flex-1">{n.label}</span>
            {n.tag && <span className="rounded-full bg-peach-strong px-1.5 text-[10px] font-medium uppercase tracking-wider text-amber">Sim</span>}
            {n.href === '/incidents' && open > 0 && (
              <span className="min-w-5 rounded-full bg-action px-1.5 text-center text-[11px] font-semibold tnum text-on-action" aria-label={`${open} open`}>
                {open}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const s = useSentinel();
  const { client } = useBackend();
  return (
    <div className="space-y-2 rounded-[14px] border border-sky-strong bg-sky px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-ink-2">Data source</span>
        <span className="rounded-full bg-panel px-2 text-[10.5px] font-medium text-info-ink">{client ? 'Backend' : 'Sample demo'}</span>
      </div>
      <p>{s.config?.datasetName ?? 'Loading configuration'}</p>
      <p>{client ? 'Real API responses. Kafka connectivity and report mode are reported by your backend.' : 'Deterministic replay in this browser. No live spacecraft data.'}</p>
      {SOURCE_FALLBACK && !client && <p className="text-amber">Unsupported source setting: {SOURCE_SETTING}.</p>}
    </div>
  );
}

function ConnectionStatus() {
  const s = useSentinel();
  const { client, transport, data, statsReceivedAt } = useBackend();
  const now = useNow(1000);
  const age = client
    ? data?.stats.last_row_age_sec == null ? null : data.stats.last_row_age_sec * 1000 + (statsReceivedAt ? now - statsReceivedAt : 0)
    : s.lastReceivedAt ? now - s.lastReceivedAt : null;
  const stale = s.connection === 'disconnected' || s.connection === 'reconnecting' || (!!client && s.stats?.kafkaOk === false);
  const tone =
    s.connection === 'connected' ? (client ? s.stats?.kafkaOk ? 'bg-mint' : 'bg-amber' : s.playback?.playing ? 'bg-mint' : 'bg-ink-3') : s.connection === 'disconnected' ? 'bg-rose' : 'bg-amber';
  const text = { connecting: 'Connecting', connected: 'Connected', disconnected: 'Disconnected', reconnecting: 'Reconnecting' }[s.connection];
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12.5px]" data-testid="status-connection">
      <span className="relative flex size-2 shrink-0">
        {s.connection === 'connected' && s.playback?.playing && <span className="absolute inset-0 animate-ping rounded-full bg-mint/50 [animation-duration:2.4s]" />}
        <span className={cn('relative size-2 rounded-full', tone)} />
      </span>
      <span className="font-medium text-ink">{client ? transport === 'connected' ? s.stats?.kafkaOk ? 'Kafka connected' : 'Kafka unavailable' : `Backend ${transport}` : `Feed ${text.toLowerCase()}`}</span>
      {stale && <span className="rounded-full bg-peach px-2 text-[11px] font-medium text-amber">Stale data</span>}
      <span className="hidden truncate text-ink-3 sm:inline tnum" data-testid="text-freshness">
        {s.status === 'loading' ? 'Waiting for telemetry' : age != null ? `Last reading ${fmtAge(age)}` : 'No readings yet'}
      </span>
    </div>
  );
}

function PlaybackControls() {
  const s = useSentinel();
  const { client } = useBackend();
  const adapter = useAdapter();
  const pb = s.playback;
  const off = s.connection !== 'connected' || !pb;
  if (client) return <span className="text-[11.5px] text-ink-3">Live stream · backend-owned</span>;
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Sample replay playback (source-wide)">
      <span className="hidden text-[11.5px] text-ink-3 xl:inline">Replay</span>
      <Btn
        size="sm"
        variant="secondary"
        disabled={off}
        aria-label={pb?.playing ? 'Pause sample replay' : 'Resume sample replay'}
        onClick={() => adapter.replay({ action: pb?.playing ? 'pause' : 'play' })}
        data-testid="button-replay-toggle"
        className="w-[84px]"
      >
        {pb?.playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
        {pb?.playing ? 'Playing' : 'Paused'}
      </Btn>
      <Btn size="sm" variant="ghost" disabled={off || pb?.playing} aria-label="Step replay forward 5 readings" title="Step forward 5 readings" onClick={() => adapter.replay({ action: 'step', count: 5 })} data-testid="button-replay-step">
        <SkipForward className="size-3.5" aria-hidden />
      </Btn>
      <label className="sr-only" htmlFor="replay-speed">
        Replay speed
      </label>
      <select
        id="replay-speed"
        disabled={off}
        value={pb?.speed ?? 1}
        onChange={(e) => adapter.replay({ action: 'speed', speed: Number(e.target.value) as 1 | 2 | 5 })}
        className="h-7 rounded-[9px] border border-divider-strong/70 bg-raised hover:bg-sky px-1.5 text-[12px] tnum text-ink disabled:opacity-45"
        data-testid="select-replay-speed"
      >
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={5}>5×</option>
      </select>
      {pb && <span className="hidden font-mono text-[11.5px] text-ink-3 lg:inline">{fmtTime(pb.cursorTs)} UTC</span>}
    </div>
  );
}

function DemoMenu() {
  const s = useSentinel();
  const adapter = useAdapter();
  const [confirm, setConfirm] = useState(false);
  const { client } = useBackend();
  if (client) return <Btn size="sm" variant="ghost" onClick={() => client.reconnect()} data-testid="button-backend-resync"><PlugZap className="size-3.5" />Resync</Btn>;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Btn size="sm" variant="ghost" aria-label="Demo controls" data-testid="button-demo-menu">
            <MoreHorizontal className="size-4" aria-hidden />
            <span className="hidden md:inline">Demo</span>
          </Btn>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 rounded-[12px] border-divider bg-panel text-ink soft-shadow">
          <DropdownMenuLabel className="text-[11.5px] font-normal text-ink-3">Controlled adapter tests (sample only)</DropdownMenuLabel>
          {s.connection === 'connected' ? (
            <DropdownMenuItem onSelect={() => adapter.disconnect()} data-testid="menu-disconnect">
              <Unplug className="size-4" aria-hidden /> Disconnect feed
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={s.connection === 'reconnecting'} onSelect={() => void adapter.reconnect()} data-testid="menu-reconnect">
              <PlugZap className="size-4" aria-hidden /> Reconnect and resync
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirm(true)} data-testid="menu-reset">
            <RotateCcw className="size-4" aria-hidden /> Reset sample to start
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="rounded-[18px] border-divider bg-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-ink">Reset the sample demo?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              Replay returns to 14:04:38 UTC. Threat Lab runs and report retries from this browser are cleared. Manual analysis inputs are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-divider bg-raised text-ink hover:bg-sky">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-action text-on-action hover:bg-action-hover" onClick={() => adapter.reset()} data-testid="button-confirm-reset">
              Reset sample
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StaleBanner() {
  const s = useSentinel();
  const adapter = useAdapter();
  if (s.connection === 'disconnected' || s.connection === 'reconnecting')
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 border-b border-peach-strong bg-peach px-4 py-2 text-[12.5px] text-amber md:px-7">
        <Unplug className="size-4" aria-hidden />
        <span className="flex-1 min-w-[200px]">
          Feed disconnected. Showing the last {s.readings.length.toLocaleString()} readings and {s.incidents.length} incidents received; values may be out of date.
        </span>
        <Btn size="sm" variant="secondary" disabled={s.connection === 'reconnecting'} onClick={() => void adapter.reconnect()} data-testid="button-reconnect">
          <PlugZap className="size-3.5" aria-hidden /> {s.connection === 'reconnecting' ? 'Reconnecting…' : 'Reconnect'}
        </Btn>
      </div>
    );
  if (s.lastResync && Date.now() - s.lastResync.at < 8000)
    return (
      <div role="status" className="flex items-center gap-2 border-b border-leaf-strong bg-leaf px-4 py-2 text-[12.5px] text-mint md:px-7" data-testid="status-resync">
        <PlugZap className="size-4" aria-hidden />
        Resynchronized: {s.lastResync.added} new readings merged, {s.lastResync.duplicates} already-held readings deduplicated by ID, {Math.max(0, s.lastResync.incidentsUpdated)} new incidents.
      </div>
    );
  return null;
}

export function Shell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const { client, error } = useBackend();
  useNow(2000);
  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[216px] flex-col border-r border-divider bg-nav px-3 py-4 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-1.5" data-testid="link-home">
          <Mark className="size-7" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">SentinelSat</span>
        </Link>
        <NavList />
        <div className="mt-auto">
          <SidebarFooter />
        </div>
      </aside>

      <div className="lg:pl-[216px]">
        <header className="sticky top-0 z-20 border-b border-divider bg-canvas/90 backdrop-blur-[6px]">
          <div className="flex h-12 items-center gap-3 px-3 md:px-7">
            <Dialog.Root open={drawer} onOpenChange={setDrawer}>
              <Dialog.Trigger asChild>
                <Btn variant="ghost" size="sm" aria-label="Open navigation" className="lg:hidden h-9 w-9 px-0" data-testid="button-open-nav">
                  <Menu className="size-4.5" aria-hidden />
                </Btn>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(106_115_123/0.25)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150" />
                <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-[272px] max-w-[85vw] flex-col border-r border-divider bg-nav px-3 py-4 rounded-r-[20px] data-[state=open]:animate-in data-[state=open]:slide-in-from-left-8 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left-8 duration-150">
                  <div className="mb-5 flex items-center justify-between px-1.5">
                    <Dialog.Title className="flex items-center gap-2.5 text-[15px] font-semibold">
                      <Mark className="size-7" /> SentinelSat
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <Btn variant="ghost" size="sm" aria-label="Close navigation" className="h-9 w-9 px-0" data-testid="button-close-nav">
                        <X className="size-4" aria-hidden />
                      </Btn>
                    </Dialog.Close>
                  </div>
                  <NavList onNavigate={() => setDrawer(false)} />
                  <div className="mt-auto">
                    <SidebarFooter />
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <span className="hidden items-center gap-1.5 rounded-full border border-sky-strong bg-sky px-2.5 py-0.5 text-[12px] font-medium text-info-ink sm:inline-flex" data-testid="status-source">
              {client ? 'Backend · live stream' : 'Sample demo · replay'}
            </span>
            <ConnectionStatus />
            <div className="ml-auto flex items-center gap-1.5">
              <div className="hidden md:block">
                <PlaybackControls />
              </div>
              <DemoMenu />
              <SourceSettings />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-divider px-3 py-1.5 md:hidden">
            <span className="rounded-full border border-sky-strong bg-sky px-2.5 py-0.5 text-[11.5px] font-medium text-info-ink sm:hidden">{client ? 'Backend · live stream' : 'Sample demo · replay'}</span>
            <PlaybackControls />
          </div>
          <StaleBanner />
          {client && error && <div role="alert" className="border-b border-rose/30 bg-blush px-4 py-2 text-[12.5px] text-rose md:px-7">{error} <button className="underline" onClick={() => client.reconnect()}>Retry connection</button></div>}
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-7">{children}</main>
      </div>
    </div>
  );
}
