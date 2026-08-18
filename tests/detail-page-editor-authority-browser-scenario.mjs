import assert from "node:assert/strict";

export async function armNextDetailProjectLoadFailure(cdp, evaluate) {
  await evaluate(cdp, `(() => {
    const originalFetch = window.fetch.bind(window);
    let armed = true;
    window.fetch = (input, init = {}) => {
      const isProjectRead = (init.method ?? 'GET') === 'GET' && String(input).includes('/api/detail-page-projects/');
      if (!armed || !isProjectRead) return originalFetch(input, init);
      armed = false;
      window.fetch = originalFetch;
      return Promise.resolve(new Response(JSON.stringify({ error: { message: '프로젝트 저장소 일시 오류' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      }));
    };
  })()`);
}

export async function assertDetailProjectLoadFailed(context) {
  const { cdp, generationWaitMs, evaluate, text, value, waitFor } = context;
  await waitFor(cdp, "document.querySelector('#preview-badge')?.textContent?.includes('편집본 불러오기 실패')", generationWaitMs);

  assert.match(await text(cdp, "#result-preview"), /프로젝트 저장소 일시 오류/u);
  assert.equal(await value(cdp, "#export-output"), "");
  assert.equal(await evaluate(cdp, "[...document.querySelectorAll('[data-export]')].every((button) => button.disabled)"), true);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-action=\"toggle-export-panel\"]')?.disabled"), true);
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('#detail-page-editor'))"), false);
}

export async function holdDetailImageEdit(context) {
  const { cdp, click, evaluate, setValue, waitFor } = context;
  await click(cdp, "[data-action='edit-detail-image']");
  await waitFor(cdp, "!document.querySelector('#image-viewer-dialog')?.classList.contains('is-hidden')");
  await evaluate(cdp, `(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (init.method !== 'POST' || !String(input).includes('/api/images/edit')) return originalFetch(input, init);
      return new Promise((resolve, reject) => {
        window.__releaseHeldDetailImageEdit = () => {
          window.fetch = originalFetch;
          originalFetch(input, init).then(resolve, reject);
        };
      });
    };
  })()`);
  await setValue(cdp, "#image-edit-instruction", "광고 세트로 바뀌어도 적용되면 안 되는 늦은 수정본");
  await click(cdp, "[data-action='edit-generated-image']");
  await waitFor(cdp, "document.querySelector('#image-edit-state-card')?.dataset.state === 'running'");
  await waitFor(cdp, "typeof window.__releaseHeldDetailImageEdit === 'function'");
}

export async function releaseHeldImageEditAndAssertAdAuthority(context) {
  const { cdp, click, evaluate, value, waitFor } = context;
  await evaluate(cdp, "window.__releaseHeldDetailImageEdit()");
  await waitFor(cdp, "document.querySelector('[data-action=\"edit-generated-image\"]')?.disabled === false");
  await evaluate(cdp, "document.querySelector('#export-output').value = ''");
  await click(cdp, "[data-export='json']");
  await waitFor(cdp, "document.querySelector('#export-output')?.value?.includes('\\\"adSet\\\"')");
  const exportPayload = JSON.parse(await value(cdp, "#export-output"));

  assert.equal(exportPayload.generationMode, "ad-set");
  assert.equal(Array.isArray(exportPayload.editedImages), false);
  assert.equal(Array.isArray(exportPayload.result?.editedImages), false);
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('#detail-page-editor'))"), false);
  assert.equal(await evaluate(cdp, "document.querySelectorAll('.generated-image-card-edited').length"), 0);
}
