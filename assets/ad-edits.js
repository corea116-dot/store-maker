const prefix = 'store-maker.ad-edits.v1.';
const imageUrl = /^\/outputs\/image-runs\/[a-z0-9-]+\/[a-z0-9._%()/-]+$/iu;

export function applyAdEdits(result, edits) {
  const copy = structuredClone(result);
  const ads = copy.adSet?.items ?? copy.adSet?.ads ?? [];
  for (const [index, ad] of ads.entries()) {
    const edit = edits?.[ad.id];
    if (!edit) continue;
    if (typeof edit.headline === 'string' && edit.headline.trim() && edit.headline.length <= 120) ad.headline = edit.headline;
    if (edit.image && typeof edit.image.url === 'string' && imageUrl.test(edit.image.url) && !edit.image.url.includes('..') && copy.images?.files?.[index]) copy.images.files[index] = edit.image;
  }
  return copy;
}

export function loadAdEdits(jobId, storage = localStorage) {
  try { const data = JSON.parse(storage.getItem(prefix + jobId) || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
}

export function saveAdEdits(jobId, edits, storage = localStorage) {
  try { storage.setItem(prefix + jobId, JSON.stringify(edits)); return true; } catch { return false; }
}
