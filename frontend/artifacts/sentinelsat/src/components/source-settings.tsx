import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { PlugZap, X } from 'lucide-react';
import { Btn, ErrorNote } from './kit';
import { BackendClient } from '@/lib/backend/client';
import { useBackend } from '@/lib/backend/context';
import { saveBackendAddress } from '@/lib/backend/settings';

export function SourceSettings() {
  const { client } = useBackend();
  const local = import.meta.env.VITE_SENTINEL_DEPLOYMENT === 'local';
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog.Root open={open} onOpenChange={value => !busy && setOpen(value)}>
    <Dialog.Trigger asChild>
      <Btn size="sm" variant="ghost" data-testid="button-data-source">
        <PlugZap className="size-3.5" aria-hidden /><span className="hidden md:inline">Data source</span>
      </Btn>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(106_115_123/0.22)]" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-divider bg-panel p-5 soft-shadow">
        <div className="flex items-center justify-between gap-3">
          <Dialog.Title className="text-[17px] font-semibold text-ink">Telemetry data source</Dialog.Title>
          <Dialog.Close asChild><Btn size="sm" variant="ghost" disabled={busy} aria-label="Close data source settings"><X className="size-4" /></Btn></Dialog.Close>
        </div>
        <Dialog.Description className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {client ? 'Connected mode uses your backend data and real service responses.' : 'Sample demo is local, deterministic, and separate from your Kafka and model services.'}
          {' '}The server gateway adds authentication privately. Your browser only requests this dashboard’s origin. This gateway permits telemetry, incident reads, and the live stream; simulations and analysis controls are not authorized.
        </Dialog.Description>
        <form className="mt-5 space-y-4" onSubmit={async event => {
          event.preventDefault();
            setBusy(true); setError('');
          try {
            const candidate = new BackendClient();
            await candidate.probe();
            saveBackendAddress(candidate.base);
            window.location.reload();
          } catch (err) { setError(`${err instanceof Error ? err.message : 'Connection failed.'} The current source is unchanged. ${local ? 'Keep the local FastAPI backend running.' : 'Check server Secrets and keep the Windows backend, gateway, and tunnel running.'}`); }
          finally { setBusy(false); }
        }}>
          <p className="text-[12px] leading-relaxed text-ink-3">{local ? 'A successful check selects the local backend and reloads the dashboard. Sample inputs remain stored separately.' : 'The upstream address and token are configured only in Replit Secrets. A successful check selects the gateway and reloads the dashboard. Sample inputs remain stored separately. Keep Private preview enabled in Networking.'}</p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            <Btn type="submit" variant="primary" disabled={busy} data-testid="button-connect-backend">{busy ? 'Checking backend…' : 'Check & connect'}</Btn>
            {client && <Btn type="button" disabled={busy} onClick={() => {
              try { saveBackendAddress(null); window.location.reload(); }
              catch { setError('Could not update browser storage. Your source has not changed.'); }
            }} data-testid="button-use-sample">Use Sample demo</Btn>}
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
