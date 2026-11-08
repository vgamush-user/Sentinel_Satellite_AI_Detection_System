import { useState, type ReactNode } from 'react';
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

function Router() {
  return (
    <Shell>
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
