import { escapeHtml } from "./utils.mjs";

export function buildAdMarkdown(renderInput) {
  const { input, brandDna, adAutomation, adSet, engineNote } = renderInput;
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
    "## 추천 앵글",
    "",
    ...adAutomation.recommendedAngles.map((angle, index) => `- ${index + 1}. ${angle.label} (${angle.id}) · score ${angle.score}: ${angle.reason}`),
    "",
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
  if (engineNote) lines.push("## 엔진 응답 메모", "", `- ${engineNote}`, "");
  return lines.join("\n").trim();
}

export function buildAdHtml(renderInput) {
  const { input, brandDna, adAutomation, adSet, engineNote } = renderInput;
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
      ${anglePanel(adAutomation)}
      ${adGallery(ads)}
      ${engineNote ? `<section class="engine-note"><h2>엔진 응답 메모</h2><p>${escapeHtml(engineNote)}</p></section>` : ""}
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

function anglePanel(adAutomation) {
  const items = adAutomation.recommendedAngles.map((angle, index) => `
    <li>
      <strong>${index + 1}. ${escapeHtml(angle.label)}</strong>
      <span>${escapeHtml(angle.id)} · score ${angle.score}</span>
      <p>${escapeHtml(angle.reason)}</p>
    </li>
  `).join("");
  return `
    <section class="angle-panel" aria-labelledby="angle-title">
      <div class="section-head">
        <div><h2 id="angle-title">추천 앵글</h2><p>16개 카피 앵글 중 상품/마켓/무드 기준으로 5개를 자동 선별했습니다.</p></div>
        <span class="pill">16 catalog</span>
      </div>
      <ol class="angle-list">${items}</ol>
    </section>`;
}

function adGallery(ads) {
  const cards = ads.map((ad) => `
    <article class="ad-card">
      <div class="ad-card-head"><span class="pill">${escapeHtml(ad.id)}</span><span class="pill">${escapeHtml(ad.angleLabel)}</span></div>
      <h3>${escapeHtml(ad.headline)}</h3>
      <p>${escapeHtml(ad.primaryText)}</p>
      <dl>
        <div><dt>CTA</dt><dd>${escapeHtml(ad.cta)}</dd></div>
        <div><dt>Visual</dt><dd>${escapeHtml(ad.visualBrief)}</dd></div>
        <div><dt>Market</dt><dd>${escapeHtml(ad.localizationNotes)}</dd></div>
        <div><dt>Safety</dt><dd>${escapeHtml(ad.complianceNote)}</dd></div>
      </dl>
    </article>
  `).join("");
  return `
    <section class="ad-gallery" aria-labelledby="ad-gallery-title">
      <div class="section-head">
        <div><h2 id="ad-gallery-title">광고 결과 갤러리</h2><p>기본 추천 광고안 5개입니다. 각 카드는 독립 카피 앵글과 안전 문구를 포함합니다.</p></div>
        <span class="pill good">${ads.length} cards</span>
      </div>
      <div class="ad-gallery-grid">${cards}</div>
    </section>`;
}
