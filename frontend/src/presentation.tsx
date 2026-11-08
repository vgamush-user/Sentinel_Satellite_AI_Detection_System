import { Fragment, type ReactNode } from "react";
import type { Incident } from "./protocol";

export const colorTokens = new Map([
  ["Normal", "--c-normal"], ["Storage Exhaustion", "--c-se"], ["Command Flooding", "--c-cf"],
  ["Data Injection", "--c-di"], ["Defence Impairment", "--c-dim"],
]);
export const classColor = (name: string) => colorTokens.get(name) ?? "--muted";
export const pct = (value?: number | null) => value == null ? "–" : (value * 100).toFixed(1) + "%";
export function fmtTime(ts?: number | null, includeDate = false) {
  if (ts == null) return "–";
  const date = new Date(ts * 1000);
  if (!Number.isFinite(date.getTime())) return "–";
  const iso = date.toISOString();
  const time = iso.slice(11, 19) + " UTC";
  return includeDate ? iso.slice(0, 10) + " " + time : time;
}
export function ClassLabel({ name }: { name?: string | null }) {
  return <span className="cls"><i style={{ background: `var(${classColor(name ?? "")})` }} />{name || "–"}</span>;
}
export function Fact({ label, value }: { label: string; value?: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value ?? "Unavailable"}</dd></div>;
}
export const confidenceNote = "Model confidence is a score, not the probability that an event is malicious. A high score can still be wrong.";
export function reportState(i: Incident) {
  if (!i.report_status) return "queued";
  if (i.report_status === "RUNNING") return "running";
  if (i.report_status === "ERROR") return "error";
  return "ready";
}
export function reportProgress(i: Incident) {
  const state = reportState(i);
  if (state === "queued") return "Queued for a report.";
  if (state === "error") return "Report unavailable. Review the telemetry evidence.";
  if (i.report_mode === "cached") return state === "running" ? "Loading a cached example." : "Cached example available.";
  if (i.report_mode !== "live") return "Report source unavailable.";
  if (state === "running") return "Live analysis running.";
  return i.report_status === "FLAGGED_FOR_REVIEW" ? "Awaiting review." : "Report ready.";
}
export function ReportBadge({ incident }: { incident: Incident }) {
  const state = reportState(incident);
  const label = reportProgress(incident).replace(/\.$/, "");
  const style = label === "Awaiting review" || state === "running" ? "run" :
    state === "error" ? "err" : state === "ready" && incident.report_mode === "live" ? "done" : "";
  return <span className={`badge ${style}`}>{label}</span>;
}

function inline(text: string) {
  return text.split(/(\*\*.+?\*\*|`[^`]+`|\*[^*]+\*)/).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={index}>{part.slice(2, -2)}</b>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <i key={index}>{part.slice(1, -1)}</i>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const blocks: ReactNode[] = [];
  let tables = 0;
  const bullet = /^[-*•]\s+/;
  for (let index = 0; index < lines.length;) {
    const key = index;
    const line = lines[index++];
    if (line.startsWith("|")) {
      const rows = [line];
      while (lines[index]?.startsWith("|")) rows.push(lines[index++]);
      blocks.push(<div className="report-table" role="region" aria-label={`Report table ${++tables}`} tabIndex={0} key={key}>
        <table><tbody>{rows.filter(row => !/^\|?\s*:?-{2,}/.test(row)).map((row, i) =>
          <tr key={i}>{row.replace(/^\||\|$/g, "").split("|").map((cell, j) => <td key={j}>{inline(cell.trim())}</td>)}</tr>)}</tbody></table>
      </div>);
    } else if (bullet.test(line)) {
      const items = [line];
      while (bullet.test(lines[index] ?? "")) items.push(lines[index++]);
      blocks.push(<ul key={key}>{items.map((item, i) => <li key={i}>{inline(item.replace(bullet, ""))}</li>)}</ul>);
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<h5 key={key}>{inline(line.replace(/^#+\s*/, ""))}</h5>);
    } else if (line) blocks.push(<p key={key}>{inline(line)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
export function OutputDetails({ label, content, open }: { label: string; content?: string | null; open?: boolean }) {
  return content ? <details open={open}><summary>{label}</summary><Markdown text={content} /></details> : null;
}

export function datasetName(dataset?: string | null) {
  return dataset === "raw" ? "Raw telemetry" : dataset === "noised" ? "Noised telemetry" : dataset || "unknown";
}
export function focus(id: string, preventScroll = false) {
  requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll }));
}
