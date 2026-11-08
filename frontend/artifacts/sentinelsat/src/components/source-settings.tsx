import { useEffect, useRef, useState } from 'react';
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
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const cancel = () => { generation.current++; pending.current?.abort(); pending.current = null; setBusy(false); };
  useEffect(() => () => { generation.current++; pending.current?.abort(); }, []);
  const gateway = client?.readOnlyGateway ?? !local;
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) cancel(); setOpen(value); }}>
    <Dialog.Trigger asChild>
      <Btn size="sm" variant="ghost" aria-label="Data source settings" data-testid="button-data-source">
        <PlugZap className="size-3.5" aria-hidden /><span className="hidden md:inline">Data source</span>
      </Btn>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(106_115_123/0.22)]" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-[16px] border border-divider bg-panel p-5 soft-shadow">
        <div className="flex items-center justify-between gap-3">
          <Dialog.Title className="text-[17px] font-semibold text-ink">Telemetry data source</Dialog.Title>
          <Dialog.Close asChild><Btn size="sm" variant="ghost" aria-label="Close data source settings"><X className="size-4" /></Btn></Dialog.Close>
        </div>
        <Dialog.Description className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {client ? 'Connected mode uses your backend data and real service responses.' : 'Sample demo is local, deterministic, and separate from your Kafka and model services.'}
          {' '}{gateway ? 'This connection is read-only: telemetry, incident evidence, and stream updates remain available. Simulation and analysis require a deployment that authorizes those actions.' : 'Local connected mode supports telemetry and the analysis or simulation actions authorized by your backend.'}
        </Dialog.Description>
        <form className="mt-5 space-y-4" onSubmit={async event => {
          event.preventDefault();
          if (pending.current) return;
          const controller = new AbortController();
          pending.current = controller;
          const current = ++generation.current;
          setBusy(true); setError('');
          try {
            const candidate = new BackendClient();
            await candidate.probe(controller.signal);
            if (controller.signal.aborted || current !== generation.current) return;
            saveBackendAddress(candidate.base);
            window.location.reload();
          } catch (err) {
            if (controller.signal.aborted || current !== generation.current) return;
            const message = err instanceof Error && err.name === 'TimeoutError' ? 'The backend did not respond within 20 seconds.' : err instanceof Error ? err.message : 'Connection failed.';
            setError(`${message} Your current source is unchanged. ${local ? 'Keep the local backend running, then retry.' : 'Check the server connection configuration, then retry.'}`);
          }
          finally { if (current === generation.current) { pending.current = null; setBusy(false); } }
        }}>
          <p className="text-[12px] leading-relaxed text-ink-3">{local ? 'A successful check selects the local backend and reloads the dashboard. Sample inputs remain stored separately.' : 'The upstream address and token are configured only in Replit Secrets. A successful check selects the gateway and reloads the dashboard. Sample inputs remain stored separately. Keep Private preview enabled in Networking.'}</p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-2">
            <Btn type="submit" variant="primary" disabled={busy} data-testid="button-connect-backend">{busy ? 'Checking backend…' : 'Check & connect'}</Btn>
            {busy && <Btn type="button" onClick={cancel} data-testid="button-cancel-connection">Cancel check</Btn>}
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
