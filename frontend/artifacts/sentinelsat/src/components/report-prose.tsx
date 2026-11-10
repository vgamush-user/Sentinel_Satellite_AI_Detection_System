import type { ReactNode } from 'react';

/** Renders untrusted generated text as a safe Markdown subset (no HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={i} className="rounded-[4px] bg-support/15 px-1 py-px font-mono text-[0.88em] text-info-ink break-all">
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function ReportProse({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push(
        <h3 key={i} className="mt-7 first:mt-0 border-t border-divider pt-4 text-[16px] font-semibold tracking-[-0.01em] text-ink first:border-0 first:pt-0">
          {line.slice(3)}
        </h3>,
      );
      i++;
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
      blocks.push(
        <ul key={i} className="mt-2.5 space-y-1.5">
          {items.map((it, k) => (
            <li key={k} className="relative pl-4 before:absolute before:left-0 before:top-[0.7em] before:h-px before:w-2 before:bg-ink-3">
              {inline(it)}
            </li>
          ))}
        </ul>,
      );
    } else if (line.startsWith('> ')) {
      blocks.push(
        <aside key={i} className="mt-5 rounded-[12px] border-l-4 border-palette-yellow bg-sun px-4 py-3 text-[13.5px] text-ink">
          {inline(line.slice(2))}
        </aside>,
      );
      i++;
    } else {
      blocks.push(
        <p key={i} className="mt-2.5 break-words">
          {inline(line)}
        </p>,
      );
      i++;
    }
  }
  return <div className="max-w-[68ch] text-[14.5px] leading-[1.7] text-ink-2">{blocks}</div>;
}
