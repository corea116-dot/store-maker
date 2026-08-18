import { normalizeDetailPageDocument } from "./detail-page-schema.mjs";

export function renderDetailPageDocument(value, options = {}) {
  const document = normalizeDetailPageDocument(value);
  const visibleSections = document.sections.filter(({ visible }) => visible);
  const images = options.images;
  return {
    title: document.title,
    markdown: renderMarkdown(document, visibleSections, images),
    html: renderHtml(document, visibleSections, images),
  };
}

function renderMarkdown(document, sections, images) {
  const lines = [`# ${document.title}`];
  for (const section of sections) {
    lines.push("");
    if (section.heading) lines.push(`## ${section.heading}`, "");
    if (section.body) lines.push(section.body, "");
    if (section.bullets.length > 0) lines.push(...section.bullets.map((bullet) => `- ${bullet}`), "");
    if (section.image) lines.push(`![${escapeMarkdownAlt(section.image.alt || section.image.filename)}](${section.image.url})`, "");
    while (lines.at(-1) === "" && lines.at(-2) === "") lines.pop();
  }
  lines.push(...imageMetadataMarkdown(images));
  return lines.join("\n").trim();
}

function renderHtml(document, sections, images) {
  const imageByUrl = new Map((images?.files ?? []).map((file) => [file.url, file]));
  const content = sections.map((section) => {
    const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : "";
    const body = section.body ? renderBody(section.body) : "";
    const bullets = section.bullets.length > 0
      ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`
      : "";
    return `
      <section class="detail-page-section detail-page-section-${section.kind} detail-page-layout-${section.layout}" data-detail-page-section data-section-id="${escapeAttribute(section.id)}">
        <div class="detail-page-section-copy">${heading}${body}${bullets}</div>
        ${section.image ? renderImage(section.image, imageByUrl.get(section.image.url), images) : ""}
      </section>
    `;
  }).join("");
  return `<article class="detail-page-document" data-detail-page-document><h1>${escapeHtml(document.title)}</h1>${content}${imageSummaryHtml(images)}</article>`;
}

function renderBody(body) {
  return body.split(/\n{2,}/u)
    .map((paragraph) => `<p>${paragraph.split("\n").map(escapeHtml).join("<br />")}</p>`)
    .join("");
}

function renderImage(image, file = {}, images = {}) {
  const attributes = [
    ["data-image-url", image.url],
    ["data-image-filename", image.filename],
    ["data-image-relative-path", image.url.slice(1)],
    ["data-image-purpose", image.alt],
  ].map(([name, value]) => `${name}="${escapeAttribute(value)}"`).join(" ");
  const placeholder = file.isPlaceholder ? " generated-image-card-placeholder" : "";
  return `
    <figure class="generated-image-card detail-page-section-image${placeholder}" data-generated-image-card>
      <div class="generated-image-frame">
        <button class="generated-image-open" type="button" data-action="open-generated-image" ${attributes} aria-label="${escapeAttribute(`${image.alt || image.filename} 큰 화면으로 보기`)}">
          <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || image.filename)}" />
          <span class="generated-image-open-label">큰 화면으로 보기</span>
          ${file.isPlaceholder ? "<span class=\"generated-image-badge\">테스트 이미지</span>" : ""}
        </button>
      </div>
      <figcaption>
        <strong>${escapeHtml(image.filename)}</strong>
        <span>${escapeHtml(file.relativePath ?? image.url.slice(1))} · ${escapeHtml(formatBytes(file.size ?? 0))}</span>
        <span class="generated-image-style">스타일: ${escapeHtml(file.style ?? images.style ?? "미지정")}</span>
        <span>목적: ${escapeHtml(file.purpose ?? file.brief?.purpose ?? image.alt ?? "미지정")}</span>
        ${file.qualityWarning ? `<span class="generated-image-warning">${escapeHtml(file.qualityWarning)}</span>` : ""}
        ${file.brief?.visualPrompt ? `<small>${escapeHtml(file.brief.visualPrompt)}</small>` : ""}
        ${Number.isSafeInteger(file.width) && Number.isSafeInteger(file.height) ? `<span>${escapeHtml(`${file.width}x${file.height}px`)}</span>` : ""}
        <span>${escapeHtml(file.mimeType ?? file.type ?? (image.source === "edited" ? "수정 이미지" : "생성 이미지"))}</span>
      </figcaption>
      <div class="generated-image-actions">
        <button class="btn" type="button" data-action="open-generated-image" ${attributes}>큰 화면</button>
        <a class="btn" href="${escapeAttribute(image.url)}" target="_blank" rel="noopener">원본 열기</a>
      </div>
    </figure>
  `;
}

function imageMetadataMarkdown(images) {
  if (!images?.files?.length) return [];
  const requested = images.requestedImageCount ?? images.count ?? images.files.length;
  const generated = images.generatedImageCount ?? images.files.length;
  return [
    "",
    "## 3. 이미지 생성/촬영 프롬프트",
    "",
    `- 이미지 provider: ${images.providerLabel ?? images.provider ?? "미지정"}`,
    `- 생성 상태: 요청 ${requested}개 / 생성 ${generated}개`,
    `- 생성 옵션: ${requested}개, ${images.ratio ?? "미지정"}, ${images.style ?? "미지정"}, ${images.background ?? "미지정"}`,
    ...(Number.isSafeInteger(images.sameMoodCount) && Number.isSafeInteger(images.variedMoodCount)
      ? [`- 무드 구성: 동일한 무드 ${images.sameMoodCount}개 / 다른 무드 ${images.variedMoodCount}개`]
      : []),
    ...images.files.flatMap((file) => [
      `- 파일: ${file.relativePath ?? file.url}`,
      `- 스타일: ${file.style ?? images.style ?? "미지정"}`,
      `- 목적: ${file.purpose ?? file.brief?.purpose ?? "미지정"}`,
    ]),
  ];
}

function imageSummaryHtml(images) {
  if (!images?.files?.length) return "";
  const requested = images.requestedImageCount ?? images.count ?? images.files.length;
  const generated = images.generatedImageCount ?? images.files.length;
  const warnings = Array.isArray(images.quality?.warnings) ? images.quality.warnings.filter(Boolean) : [];
  return `
    <section class="generated-image-section detail-page-image-summary">
      <div class="generated-image-head">
        <div>
          <h2>3. 이미지 생성/촬영 프롬프트</h2>
          <p>${escapeHtml(`${images.providerLabel ?? images.provider ?? "미지정"} · ${requested}개 요청 · ${generated}개 생성 · ${images.ratio ?? "미지정"} · ${images.style ?? "미지정"} · ${images.background ?? "미지정"}`)}</p>
          ${Number.isSafeInteger(images.sameMoodCount) && Number.isSafeInteger(images.variedMoodCount) ? `<p class="generated-image-mood-count">${escapeHtml(`동일한 무드 ${images.sameMoodCount}개 / 다른 무드 ${images.variedMoodCount}개`)}</p>` : ""}
          <p class="generated-image-count">${escapeHtml(`요청 ${requested}개 / 생성 ${generated}개`)}</p>
        </div>
        <button class="btn" type="button" data-action="regenerate-images">재생성</button>
      </div>
      ${warnings.length > 0 ? `<div class="generated-image-warning-panel" role="note"><strong>이미지 품질 확인 필요</strong>${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>` : ""}
      <div class="generated-image-grid detail-page-edited-image-grid" data-detail-page-edited-images></div>
      ${images.prompt ? `<details class="generated-prompt"><summary>사용한 프롬프트 보기</summary><pre>${escapeHtml(images.prompt)}</pre></details>` : ""}
    </section>
  `;
}

function formatBytes(size) {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeMarkdownAlt(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
