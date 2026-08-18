import assert from "node:assert/strict";

const pendingBody = "백그라운드 작업이 실행 중이어도 보존되는 편집 내용입니다.";

export async function runBackgroundJobEditorScenario(context) {
  const { cdp, slowEngineCommand, generationWaitMs, click, setValue, evaluate, value, waitFor } = context;
  const projectId = await evaluate(cdp, "document.querySelector('#detail-page-editor')?.dataset.projectId");
  const product = await evaluate(cdp, `({
    name: document.querySelector('#product-name')?.value ?? '',
    description: document.querySelector('#product-description')?.value ?? '',
    requirements: document.querySelector('#product-requirements')?.value ?? '',
    requiredInclusions: document.querySelector('#product-required-inclusions')?.value ?? ''
  })`);
  assert.ok(projectId);

  await click(cdp, "[data-action='open-settings']");
  await click(cdp, "[data-provider='custom']");
  await setValue(cdp, "#command", slowEngineCommand);
  await setValue(cdp, "#timeout-ms", "8000");
  await click(cdp, "[data-action='close-settings']");
  await click(cdp, "[data-action='generate']");
  await waitFor(cdp, "document.querySelector('#job-status-pill')?.textContent?.includes('생성 중')", generationWaitMs);
  const backgroundJobId = await evaluate(cdp, `fetch('/api/generate-jobs', {
    headers: {
      'x-store-maker-token': document.querySelector('meta[name="store-maker-token"]')?.content ?? '',
      'x-store-maker-ephemeral-job': '1'
    }
  }).then((response) => response.json()).then((payload) => payload.jobs.find((job) => ['queued', 'running'].includes(job.status))?.id)`);
  assert.ok(backgroundJobId);

  await evaluate(cdp, `(() => {
    const backgroundJobId = ${JSON.stringify(backgroundJobId)};
    const projectId = ${JSON.stringify(projectId)};
    const originalFetch = window.fetch.bind(window);
    let pollHeld = false;
    window.fetch = (input, init = {}) => {
      const method = String(init.method ?? 'GET').toUpperCase();
      const url = String(input);
      if (!pollHeld && method === 'GET' && url.endsWith('/api/generate-jobs/' + encodeURIComponent(backgroundJobId))) {
        pollHeld = true;
        return new Promise((resolve, reject) => {
          window.__releaseBackgroundJobPoll = () => originalFetch(input, init).then(resolve, reject);
        });
      }
      if (method === 'PUT' && url.endsWith('/api/detail-page-projects/' + encodeURIComponent(projectId))) {
        return new Promise((resolve, reject) => {
          window.__releaseBackgroundEditorSave = () => originalFetch(input, init).then(resolve, reject);
        });
      }
      return originalFetch(input, init);
    };
    window.__restoreBackgroundRaceFetch = () => { window.fetch = originalFetch; };
  })()`);
  await waitFor(cdp, "typeof window.__releaseBackgroundJobPoll === 'function'", generationWaitMs);
  await waitFor(cdp, `Boolean(document.querySelector('[data-job-id="${projectId}"]'))`, generationWaitMs);
  await click(cdp, `[data-job-id="${projectId}"]`);
  await waitFor(cdp, `document.querySelector('#detail-page-editor')?.dataset.projectId === ${JSON.stringify(projectId)}`, generationWaitMs);
  await setValue(cdp, "[data-editor-section]:first-of-type [data-section-body]", pendingBody);
  await waitFor(cdp, "typeof window.__releaseBackgroundEditorSave === 'function'", generationWaitMs);
  await evaluate(cdp, "window.__releaseBackgroundJobPoll()");
  await evaluate(cdp, "new Promise((resolve) => setTimeout(resolve, 500))");

  assert.equal(await evaluate(cdp, "document.querySelector('#detail-page-editor')?.dataset.projectId"), projectId);
  assert.equal(await value(cdp, "[data-editor-section]:first-of-type [data-section-body]"), pendingBody);
  await evaluate(cdp, "window.__releaseBackgroundEditorSave()");
  await waitFor(cdp, "document.querySelector('[data-editor-save-status]')?.dataset.editorSaveStatus === 'saved'", generationWaitMs);
  await evaluate(cdp, "window.__restoreBackgroundRaceFetch()");
  await evaluate(cdp, `(async () => {
    const deadline = Date.now() + ${generationWaitMs};
    let finished = false;
    while (Date.now() < deadline) {
      const response = await fetch('/api/generate-jobs/${backgroundJobId}', {
        headers: {
          'x-store-maker-token': document.querySelector('meta[name="store-maker-token"]')?.content ?? '',
          'x-store-maker-ephemeral-job': '1'
        }
      });
      const payload = await response.json();
      if (['completed', 'failed', 'cancelled'].includes(payload.job?.status)) {
        finished = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!finished) throw new Error('background job did not finish');
    const deletion = await fetch('/api/generate-jobs/${backgroundJobId}/delete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-store-maker-token': document.querySelector('meta[name="store-maker-token"]')?.content ?? '',
        'x-store-maker-ephemeral-job': '1'
      },
      body: '{}'
    });
    if (!deletion.ok) throw new Error('background job cleanup failed');
  })()`);
  await click(cdp, "[data-action='open-settings']");
  await click(cdp, "[data-provider='codex']");
  await setValue(cdp, "#command", "./scripts/fake-codex.mjs");
  await setValue(cdp, "#timeout-ms", "1000");
  await click(cdp, "[data-action='close-settings']");
  await cdp.call("Page.reload", { ignoreCache: true });
  await waitFor(cdp, "document.readyState === 'complete'");
  await setValue(cdp, "#product-name", product.name);
  await setValue(cdp, "#product-description", product.description);
  await setValue(cdp, "#product-requirements", product.requirements);
  await setValue(cdp, "#product-required-inclusions", product.requiredInclusions);
  await waitFor(cdp, `Boolean(document.querySelector('[data-job-id="${projectId}"]'))`, generationWaitMs);
  await click(cdp, `[data-job-id="${projectId}"]`);
  await waitFor(cdp, `document.querySelector('#detail-page-editor')?.dataset.projectId === ${JSON.stringify(projectId)}`, generationWaitMs);
  await click(cdp, "[data-editor-tab='preview']");
  await waitFor(cdp, "document.querySelector('[data-editor-tab=\"preview\"]')?.getAttribute('aria-selected') === 'true'", generationWaitMs);
}
