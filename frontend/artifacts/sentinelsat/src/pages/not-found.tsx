import { Link } from 'wouter';
import { Compass } from 'lucide-react';
import { Empty, PageHeader } from '@/components/kit';

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-[10px] border border-divider bg-panel">
      <div className="px-6 pt-6"><PageHeader title="Page not found" /></div>
      <Empty icon={Compass} title="No view at this address" body="The link may be outdated. SentinelSat has five destinations: Overview, Telemetry, Incidents, Threat Lab and Manual analysis.">
        <Link href="/" className="mt-2 text-[13px] text-lav hover:underline" data-testid="link-go-overview">
          Go to Mission overview
        </Link>
      </Empty>
    </div>
  );
}
