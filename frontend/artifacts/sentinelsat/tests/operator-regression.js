// Run this function with Playwright's browser_run_code tool on a local SentinelSat preview.
// The supplied page provides the preview origin. All checks run in a disposable context.
(async (preview) => {
  const origin = new URL(preview.url()).origin;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    throw new Error('Open the local SentinelSat preview before running this suite.');
  }

  const context = await preview.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('sentinelsat.backend.connection.v1', JSON.stringify({ mode: 'sample' }));
  });
  await context.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'Isolated test backend' } }));
  const page = await context.newPage();
  page.setDefaultTimeout(2500);
  const results = [];
  const check = async (name, run) => {
    try {
      await run();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
    }
  };
  const require = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const open = path => page.goto(`${origin}${path}`);

  try {
    await check('Sample reset replaces the active timeline', async () => {
      await open('/telemetry');
      const pause = page.getByRole('button', { name: 'Pause sample replay', exact: true });
      await pause.click();
      const step = page.getByTestId('button-replay-step').filter({ visible: true });
      await step.click();
      await step.click();
      const latest = page.locator('[data-testid^="row-reading-"]').first();
      const before = await latest.getAttribute('data-testid');
      await page.getByRole('button', { name: 'Demo controls', exact: true }).click();
      await page.getByTestId('menu-reset').click();
      await page.getByTestId('button-confirm-reset').click();
      await pause.click();
      require(await latest.getAttribute('data-testid') === 'row-reading-rd-000278', 'Reset did not restore the baseline latest row');
      require(before !== await latest.getAttribute('data-testid'), 'Previous timeline survived reset');
    });

    await check('Sort retains focus on both tables', async () => {
      for (const [path, label] of [['/telemetry', 'Time (UTC)'], ['/incidents', 'First seen (UTC)']]) {
        await open(path);
        const sort = page.getByRole('button', { name: label, exact: true });
        await sort.focus();
        await sort.press('Enter');
        require(await sort.evaluate(button => button === document.activeElement), `${path}: sort lost focus`);
      }
    });

    await check('Chart marker activates only its incident', async () => {
      await open('/telemetry');
      const marker = page.getByTestId('marker-incident-INC-0417');
      await marker.press('Space');
      await page.waitForURL('**/incidents/INC-0417*');
      require(!(await page.getByTestId('dialog-reading-inspector').count()), 'Marker also opened a reading');
    });

    await check('History restores a held, filtered investigation', async () => {
      await open('/telemetry');
      const filter = page.getByTestId('input-search-telemetry');
      await filter.fill('rd-000');
      await page.getByTestId('chart-telemetry').press('ArrowLeft');
      await page.getByTestId('button-return-latest').waitFor();
      await page.getByTestId('link-nav-incidents').click();
      await page.goBack();
      await page.getByTestId('button-return-latest').waitFor();
      require(await filter.inputValue() === 'rd-000', 'Back discarded the search filter');
      await page.reload();
      await page.getByTestId('button-return-latest').waitFor();
      require(await filter.inputValue() === 'rd-000', 'Reload discarded the search filter');
    });

    await check('Unavailable reading link explains its state', async () => {
      await open('/telemetry?reading=missing-reading&at=1742306400000');
      await page.getByText(/Reading missing-reading is unavailable in current client history/).waitFor();
    });

    await check('Touch chart selects a reading without prior hover', async () => {
      const touch = await preview.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        await touch.addInitScript(() => localStorage.setItem('sentinelsat.backend.connection.v1', '{"mode":"sample"}'));
        await touch.route('**/api/**', route => route.abort());
        const mobile = await touch.newPage();
        mobile.setDefaultTimeout(2500);
        await mobile.goto(`${origin}/telemetry`);
        const chart = mobile.getByTestId('chart-telemetry');
        await chart.scrollIntoViewIfNeeded();
        const box = await chart.boundingBox();
        require(box, 'Chart has no visible bounds');
        await mobile.touchscreen.tap(box.x + box.width * .65, box.y + 180);
        await mobile.getByTestId('dialog-reading-inspector').waitFor();
      } finally {
        await touch.close();
      }
    });

    await check('Mobile settings is named and fits a short viewport', async () => {
      await page.setViewportSize({ width: 390, height: 320 });
      await open('/');
      const trigger = page.getByRole('button', { name: 'Data source settings', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog');
      const bounds = await dialog.boundingBox();
      require(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 320, 'Dialog extends outside viewport');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      require(await trigger.evaluate(button => button === document.activeElement), 'Dialog did not restore focus');
    });

    await check('Failed backend probe preserves sample source', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open('/');
      await page.getByTestId('button-data-source').click();
      await page.getByTestId('button-connect-backend').click();
      await page.getByText(/Isolated test backend/).waitFor();
      const mode = await page.evaluate(() => JSON.parse(localStorage.getItem('sentinelsat.backend.connection.v1')).mode);
      require(mode === 'sample', 'Failed probe changed the active source');
    });

    await check('Escape cancels a pending probe', async () => {
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      const delayed = async route => {
        await pending;
        await route.fulfill({ status: 503, json: { detail: 'Canceled probe' } }).catch(() => {});
      };
      await page.route('**/api/state', delayed);
      try {
        await open('/');
        const trigger = page.getByTestId('button-data-source');
        await trigger.click();
        await page.getByTestId('button-connect-backend').click();
        await page.getByRole('button', { name: 'Cancel check' }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        require(await trigger.evaluate(button => button === document.activeElement), 'Canceled probe did not restore focus');
      } finally {
        release();
        await page.unroute('**/api/state', delayed);
      }
    });

    await check('Manual analysis completion survives a route change', async () => {
      await open('/analysis');
      const preset = page.getByTestId('select-sample');
      await preset.selectOption({ index: 1 });
      await page.getByTestId('button-run-analysis').click();
      await page.getByRole('button', { name: 'Analyzing…' }).waitFor();
      await page.getByTestId('link-nav-overview').click();
      await page.getByTestId('link-nav-manual-analysis').click();
      await page.getByTestId('panel-result').waitFor();
      await page.locator('[data-testid^="input-feature-"]').first().fill('15');
      await page.getByTestId('status-previous-result').waitFor();
      require(await page.getByTestId('panel-result').evaluate(panel => getComputedStyle(panel).opacity === '1'), 'Historical result is dimmed');
    });

    await check('Threat Lab acknowledgement fits at 320px', async () => {
      await page.setViewportSize({ width: 320, height: 568 });
      await open('/threat-lab');
      await page.getByTestId('button-run-simulation').click();
      await page.getByRole('button', { name: 'Copy JSON' }).first().waitFor();
      require(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Raw acknowledgement overflows the page');
    });

    await check('Reduced motion preserves stable metric geometry', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
      try {
        await open('/');
        const metric = page.getByRole('region', { name: 'Key metrics' }).locator(':scope > *').first();
        const before = await metric.boundingBox();
        await metric.hover();
        const after = await metric.boundingBox();
        require(before && after && before.y === after.y, 'Metric moved under reduced motion');
      } finally {
        await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
      }
    });

    await check('All sample screens contain document width', async () => {
      for (const path of ['/', '/telemetry', '/incidents', '/incidents/INC-0416', '/threat-lab', '/analysis']) {
        await open(path);
        await page.getByRole('main').getByRole('heading', { level: 1 }).waitFor();
        for (const width of [320, 390, 639, 640, 767, 768, 1023, 1024, 1440, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          const overflow = await page.evaluate(async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return document.documentElement.scrollWidth - innerWidth;
          });
          require(overflow <= 1, `${path} overflows ${width}px by ${overflow}px`);
        }
      }
    });

    await check('Unknown route has a heading and recovery link', async () => {
      await open('/regression-missing-route');
      await page.getByRole('main').getByRole('heading', { level: 1 }).waitFor();
      await page.getByTestId('link-go-overview').click();
      await page.waitForURL(`${origin}/`);
    });

    await check('Malformed saved sample recovers visibly', async () => {
      await open('/');
      await page.evaluate(() => localStorage.setItem('sentinelsat.sample.v2', '{invalid'));
      await page.reload();
      await page.getByText(/Saved sample data could not be restored safely/).waitFor();
      await page.getByRole('button', { name: 'Pause sample replay', exact: true }).waitFor();
    });

    await check('Connected mock exposes stale data and missing incident facts', async () => {
      const mock = await preview.context().browser().newContext({ viewport: { width: 390, height: 844 } });
      try {
        const incident = { incident_id: 'partial-incident', report_status: 'UNRECOGNIZED' };
        const snapshot = {
          config: { classes: ['Normal'], features: ['MemoryAnonMB'], agent_mode: 'live', guards: { min_confidence: .7, min_rows: 5, window_rows: 20 } },
          recent: [{ entry_id: 'old-reading', seq: 1, ts: 1700000000, predicted_class: 'Normal', confidence: .91, threat: .1, f: { MemoryAnonMB: 120 } }],
          incidents: [incident],
          stats: { kafka_ok: true, rows_total: 1, rows_per_sec: 0, accuracy: null, replay_dataset: 'isolated-mock', latency_p50_ms: null, last_row_age_sec: 3600, counts: {}, pred_counts: { Normal: 1 } },
        };
        await mock.route('**/api/**', route => {
          const path = new URL(route.request().url()).pathname;
          if (route.request().method() !== 'GET') return route.abort();
          return route.fulfill({ json: path === '/api/state' ? snapshot : incident });
        });
        await mock.routeWebSocket('**/ws', socket => socket.onMessage(() => {}));
        const connected = await mock.newPage();
        connected.setDefaultTimeout(2500);
        await connected.goto(`${origin}/incidents/partial-incident`);
        await connected.getByTestId('status-connection').getByText(/stale/i).first().waitFor();
        await connected.getByRole('heading', { name: 'partial-incident' }).waitFor();
        const main = await connected.getByRole('main').innerText();
        require(/unknown/i.test(main), 'Partial incident has no unknown state');
        require(!main.includes('0.0%') && !main.includes('Report ready'), 'Partial incident displayed fabricated facts');
      } finally {
        await mock.close();
      }
    });

    return results;
  } finally {
    await context.close();
  }
})
