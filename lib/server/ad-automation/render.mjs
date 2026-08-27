import { escapeHtml } from "./utils.mjs";
import { renderAdCreativeImage } from "./creative-image.mjs";

export function buildAdMarkdown(renderInput) {
  const { input, brandDna, adAutomation, adSet } = renderInput;
  const ads = adSet.items ?? adSet.ads;
  const lines = [
    `# ${input.product.name} 광고 세트`,
    "",
    `대상 마켓: ${input.markets.join(", ")}`,
    `무드 프리셋: ${adAutomation.mood.label} (${adAutomation.moodPreset})`,
    "",
    "## Brand DNA",
    "",
    `- 기준 URL: ${brandDna.source.brandUrl ?? "제공 없음"}`,
    `- URL 안전 상태: ${brandDna.source.urlSafety.status}`,
    `- 스냅샷 상태: ${brandDna.source.snapshotStatus}`,
    `- 신뢰도: ${brandDna.confidence}`,
    ...brandDna.warnings.map((warning) => `- 주의: ${warning}`),
    "",
    ...Object.entries(brandDna.layers).flatMap(([key, layer]) => [
      `### ${layer.label}`,
      "",
      `- layer: ${key}`,
      `- 요약: ${layer.summary}`,
      `- 근거: ${layer.evidence.join(", ")}`,
      "",
    ]),
    "## 광고 결과 갤러리",
    "",
    ...ads.flatMap((ad) => [
      `### ${ad.id} · ${ad.angleLabel}`,
      "",
      `- 헤드라인: ${ad.headline}`,
      `- 본문: ${ad.primaryText}`,
      `- CTA: ${ad.cta}`,
      `- 비주얼 브리프: ${ad.visualBrief}`,
      `- 마켓 메모: ${ad.localizationNotes}`,
      `- 표현 안전: ${ad.complianceNote}`,
      "",
    ]),
  ];
  return lines.join("\n").trim();
}

export function buildAdHtml(renderInput) {
  const { input, brandDna, adAutomation, adSet, images } = renderInput;
  const ads = adSet.items ?? adSet.ads;
  return `
    <section class="ad-result">
      <header class="ad-result-head">
        <div>
          <p class="eyebrow">ad-set · ${escapeHtml(adAutomation.moodPreset)}</p>
          <h1>${escapeHtml(input.product.name)} 광고 세트</h1>
          <p>${escapeHtml(input.product.description)}</p>
        </div>
        <span class="pill good">5 ads</span>
      </header>
      ${brandDnaPanel(brandDna)}
      ${adGallery(ads, images)}
    </section>
  `;
}

function brandDnaPanel(brandDna) {
  const layerCards = Object.entries(brandDna.layers).map(([key, layer]) => `
    <article class="brand-dna-layer">
      <span class="pill">${escapeHtml(key)}</span>
      <h3>${escapeHtml(layer.label)}</h3>
      <p>${escapeHtml(layer.summary)}</p>
      <small>${escapeHtml(layer.evidence.join(" · "))}</small>
    </article>
  `).join("");
  const warnings = brandDna.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  return `
    <section class="brand-dna-panel" aria-labelledby="brand-dna-title">
      <div class="section-head">
        <div><h2 id="brand-dna-title">Brand DNA</h2><p>${escapeHtml(brandDna.source.brandUrl ?? "브랜드 URL 없이 상품 입력 기준으로 구성")}</p></div>
        <span class="pill">${escapeHtml(brandDna.source.urlSafety.status)}</span>
      </div>
      ${warnings ? `<ul class="brand-warnings">${warnings}</ul>` : ""}
      <div class="brand-dna-grid">${layerCards}</div>
    </section>`;
}

function adGallery(ads, images) {
  const generatedImageCount = images?.files?.length ?? 0;
  const galleryDescription = generatedImageCount >= ads.length
    ? "각 카드의 사진은 이미지 기획대로 생성하고, 대제목을 사진 위에 정확한 한글로 넣었습니다."
    : generatedImageCount > 0
      ? `생성된 ${generatedImageCount}장에는 이미지 기획과 대제목을 합쳤습니다. 모든 광고안에 맞춤 사진을 넣으려면 이미지를 5장 이상 생성하세요.`
      : "이미지를 생성하면 카드별 이미지 기획대로 사진을 만들고, 대제목을 사진 위에 넣습니다.";
  const cards = ads.map((ad, index) => {
    const creative = renderAdCreativeImage({ ad, image: images?.files?.[index], ratio: images?.ratio });
    return `
    <article class="ad-card">
      <div class="ad-card-head"><span class="pill">${escapeHtml(ad.id)}</span><span class="pill">${escapeHtml(ad.angleLabel)}</span></div>
      ${creative || `<h3>${escapeHtml(ad.headline)}</h3>`}
      <p class="ad-card-primary-text">${escapeHtml(ad.primaryText)}</p>
      <dl>
        <div><dt>CTA</dt><dd>${escapeHtml(ad.cta)}</dd></div>
        <div><dt>판매 채널</dt><dd>${escapeHtml(ad.localizationNotes)}</dd></div>
        <div><dt>표현 확인</dt><dd>${escapeHtml(ad.complianceNote)}</dd></div>
      </dl>
      <details class="ad-card-visual-plan"><summary>이미지 기획 보기</summary><p>${escapeHtml(ad.visualBrief)}</p></details>
    </article>
  `;
  }).join("");
  return `
    <section class="ad-gallery" aria-labelledby="ad-gallery-title">
      <div class="section-head">
        <div><h2 id="ad-gallery-title">광고 결과 갤러리</h2><p>${galleryDescription}</p></div>
        <span class="pill good">${ads.length} cards</span>
      </div>
      <div class="ad-gallery-grid">${cards}</div>
    </section>`;
}
