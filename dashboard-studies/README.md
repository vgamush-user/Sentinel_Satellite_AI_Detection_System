# Dashboard studies

Open **index.html** in a browser, or open any individual dashboard page. You can copy this folder anywhere. The pages share two local style sheets and one local script. There is no install, build, API, account, or connection to SentinelSat.

## What to inspect

| Photo | Page | Layout reconstructed | Try it |
| --- | --- | --- | --- |
| 1 | Window | Grouped navigation, three KPI cards, a two-column sales chart, and a column of store totals. Small lower cards alternate between visualizations and lists. | Change the sales period, inspect a chart point, and open a product or sales-history row. |
| 2 | ACRU | Balance chart with adjacent totals, subdued comparison bars, a featured day, and a right-hand card and transaction rail. | Select a different day on the chart, change the date range, search transactions, and open a transaction. |
| 3 | Codename | Narrow tool rail and report tree, large revenue figure, compact KPI strip, and a sales row that opens in place. | Filter the platforms, switch chart measures, search the sales team, and expand or collapse the sales rows. |
| 4 | Logip | Three panes, an open central workspace separated by rules, two comparison series, and a persistent profile and activity rail. | Change the performance period, inspect a chart point, filter tasks, and add an entry to the local activity feed. |

## Reconstruction notes

- The source material is one screenshot per dashboard. These are reconstructed dashboard views with local demo interactions. Navigation entries outside the depicted dashboard explain their role in the study.
- Data, dates, and chart points are fixed sample values reconstructed for the study. Period selectors show a subset of those values. Demo dialogs for sharing, calls, payments, and account actions display local context.
- Initials, inline SVG icons, and CSS shapes stand in for the photos and product thumbnails. A local system font stack is used. No screenshot is used as the rendered UI.
- Desktop geometry follows the supplied images. Narrow screens reflow the cards and side rails into the reading order. Use Tab to reach chart points and Enter or Space to inspect them.
- The activity composer updates only the current page. Reloading restores the original fixture.

## Design breakdown

### Window
The shell uses a pale blue-gray surround, a narrow grouped sidebar, and a generous inset around a three-column card grid. The first row repeats the same card width while changing the information shape: goal ring, growth line, earnings bars. The sales report spans two columns, with compact store totals in the third. The lower row keeps the same column rhythm even when a chart gives way to a list. This is the most systematic of the four compositions.

### ACRU
The balance chart and three adjacent totals read as one unit. Most bars recede into gray, so the selected day can carry all three category colors without making the whole chart loud. The account rail keeps the card and transaction history together. The lower grid uses one compact visual per question: spending progress, cost distribution, health, and goals.

### Codename
The narrow tool rail handles broad product areas and the adjacent tree locates the current report. The large revenue figure establishes scale. A dark featured deal and small pink signals carry emphasis within a mostly neutral composition. Opening a salesperson expands details immediately below that row, keeping its name and totals in sight. The two report columns separate channel comparisons from individual sales activity.

### Logip
The sidebar, central workspace, and activity rail are divided by rules. The central column uses whitespace and repeated alignment rather than putting every section in a card. The three metrics form a compact strip above the comparison chart. Tasks retain a consistent title, status, and time rhythm. The profile is visually contained, while activity items use small text and muted blue bubbles to indicate the kind of update.

## Source map

- **shared.css** defines the shell, controls, typography, list rows, chart framing, and focus styles.
- **dashboards.css** defines each reference's grid, palette, and responsive behavior.
- **shared.js** renders charts from the local values embedded in the HTML and wires filters, dialogs, and local interactions.
- **The four HTML files** contain each dashboard's content, layout, and fixture values.
