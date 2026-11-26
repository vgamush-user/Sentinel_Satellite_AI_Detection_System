import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { SentinelProvider } from '@/lib/sentinel/store';
import { Shell } from '@/components/shell';
import Overview from '@/pages/overview';
import Telemetry from '@/pages/telemetry';
import Incidents from '@/pages/incidents';
import IncidentDetail from '@/pages/incident-detail';
import ThreatLab from '@/pages/threat-lab';
import Analysis from '@/pages/analysis';
import { SOURCE_FALLBACK } from '@/lib/sentinel/adapter';
import { BackendClient } from '@/lib/backend/client';
import { BackendProvider } from '@/lib/backend/context';
import { backendAddress } from '@/lib/backend/settings';
import { ConnectedAdapter } from '@/lib/backend/adapter';
import { SourceSettings } from '@/components/source-settings';

const queryClient = new QueryClient();

function RouteWayfinding() {
  const [path] = useLocation();
  const previous = useRef<string | null>(null);
  const traversing = useRef(false);
  useEffect(() => {
    const keyName = '__sentinelNavigation';
    const snapshots = new Map<string, { x: number; y: number; id?: string; testId?: string }>();
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const originalRestoration = history.scrollRestoration;
    const newKey = () => crypto.randomUUID();
    let currentKey: string = history.state?.[keyName] ?? newKey();
    const withKey = (state: unknown, key: string) => ({ ...(state && typeof state === 'object' ? state : {}), [keyName]: key });
    originalReplace.call(history, withKey(history.state, currentKey), '');
    history.scrollRestoration = 'manual';
    const save = () => {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      snapshots.set(currentKey, { x: window.scrollX, y: window.scrollY, id: active?.id || undefined, testId: active?.dataset.testid });
    };
    const push: History['pushState'] = function (state, unused, url) {
      save();
      currentKey = newKey();
      originalPush.call(history, withKey(state, currentKey), unused, url);
    };
    const replace: History['replaceState'] = function (state, unused, url) {
      originalReplace.call(history, withKey(state, currentKey), unused, url);
    };
    history.pushState = push;
    history.replaceState = replace;
    let frame = 0;
    const onPop = () => {
      save();
      currentKey = history.state?.[keyName] ?? newKey();
      traversing.current = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const snapshot = snapshots.get(currentKey);
          if (!document.querySelector('[role="dialog"][data-state="open"]')) {
            const target = snapshot?.id ? document.getElementById(snapshot.id) : snapshot?.testId
              ? Array.from(document.querySelectorAll<HTMLElement>('[data-testid]')).find(el => el.dataset.testid === snapshot.testId)
              : null;
            const fallback = document.querySelector<HTMLElement>('#main-content h1') ?? document.getElementById('main-content');
            (target?.getClientRects().length ? target : fallback)?.focus({ preventScroll: true });
            window.scrollTo({ left: snapshot?.x ?? 0, top: snapshot?.y ?? 0, behavior: 'instant' });
          }
          traversing.current = false;
        });
      });
    };
    window.addEventListener('popstate', onPop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', onPop);
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
      history.scrollRestoration = originalRestoration;
    };
  }, []);
  useEffect(() => {
    const names: Record<string, string> = { '/': 'Mission overview', '/telemetry': 'Telemetry', '/incidents': 'Incidents', '/threat-lab': 'Threat Lab', '/analysis': 'Manual analysis' };
    let incidentId = path.slice('/incidents/'.length);
    try { incidentId = decodeURIComponent(incidentId); } catch { /* Keep malformed URLs readable. */ }
    document.title = `${names[path] ?? (path.startsWith('/incidents/') ? `Incident ${incidentId}` : 'Page not found')} · SentinelSat`;
    const changed = previous.current !== null && previous.current !== path;
    previous.current = path;
    if (!changed || traversing.current) return;
    // Wait for React/Radix to commit focus changes. Deep-link dialogs own focus.
    const frame = requestAnimationFrame(() => {
      if (traversing.current || document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      const target = document.querySelector<HTMLElement>('#main-content h1') ?? document.getElementById('main-content');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [path]);
  return null;
}

function Router() {
  return (
    <Shell>
      <RouteWayfinding />
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/telemetry" component={Telemetry} />
          <Route path="/incidents" component={Incidents} />
          <Route path="/incidents/:id" component={IncidentDetail} />
          <Route path="/threat-lab" component={ThreatLab} />
          <Route path="/analysis" component={Analysis} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const [client] = useState(() => {
    const address = backendAddress();
    return address ? new BackendClient() : null;
  });
  const [connectedAdapter] = useState(() => client ? new ConnectedAdapter(client) : undefined);
  if (SOURCE_FALLBACK && !client) {
    return (
      <main className="min-h-screen grid place-items-center p-8">
        <section className="max-w-xl space-y-4">
          <h1 className="text-2xl">Telemetry source unavailable</h1>
          <p>No backend address is configured, so sample data has not been substituted for the requested source.</p>
          <p>Use Data source to check and connect your HTTPS SentinelSat backend.</p>
          <SourceSettings />
        </section>
      </main>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BackendProvider client={client}>
        <SentinelProvider adapter={connectedAdapter}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </SentinelProvider>
        </BackendProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
