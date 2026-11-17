import { createAdCreativeLayout, renderAdCreativeImage } from './ad-creative-layout.js';

function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }

export function buildAdFigmaPage(result) {
  const ads = result?.adSet?.items ?? result?.adSet?.ads ?? [];
  const files = result?.images?.files ?? [];
  if (!ads.length || !files.length || files.length < ads.length) throw new Error('모든 광고에 생성된 사진이 필요합니다.');
  const sections = files.map((image,index) => {
    const ad = ads[index];
    return { id: ad?.id ?? `image-${index+1}`, heading: ad?.headline ?? '', body: ad?.primaryText ?? '', cta: ad?.cta ?? '', image,
      ...(ad ? { creative: createAdCreativeLayout({ headline: ad.headline, ratio: image.brief?.ratio ?? result.images.ratio }) } : {}) };
  });
  return { format:'store-maker-figma', version:2, width:860, sourceWidth:1120, title:result.title, sections };
}

export function renderAdFigmaPreview(result, page) {
  const ads=result?.adSet?.items ?? result?.adSet?.ads ?? [];
  return `<div class="ad-figma-preview">${page.sections.map((section,index) => `<section>${ads[index] ? renderAdCreativeImage({ad:ads[index],image:section.image,ratio:result.images.ratio}) : `<img src="${escapeHtml(section.image.url)}" alt="생성 이미지" />`}${section.body || section.cta ? `<div class="ad-figma-caption"><p>${escapeHtml(section.body)}</p>${section.cta ? `<p>${escapeHtml(section.cta)}</p>` : ''}</div>` : ''}</section>`).join('')}</div>`;
}
