import { normalizeDetailPageDocument } from "./detail-page-schema.mjs";

export function renderDetailPageDocument(value) {
  const document = normalizeDetailPageDocument(value);
  const visibleSections = document.sections.filter(({ visible }) => visible);
  return {
    title: document.title,
    markdown: renderMarkdown(document, visibleSections),
    html: renderHtml(document, visibleSections),
  };
}

function renderMarkdown(document, sections) {
  const lines = [`# ${document.title}`];
  for (const section of sections) {
    lines.push("");
    if (section.heading) lines.push(`## ${section.heading}`, "");
    if (section.body) lines.push(section.body, "");
    if (section.bullets.length > 0) lines.push(...section.bullets.map((bullet) => `- ${bullet}`), "");
    if (section.image) lines.push(`![${escapeMarkdownAlt(section.image.alt || section.image.filename)}](${section.image.url})`, "");
    while (lines.at(-1) === "" && lines.at(-2) === "") lines.pop();
  }
  return lines.join("\n").trim();
}

function renderHtml(document, sections) {
  const content = sections.map((section) => {
    const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : "";
    const body = section.body ? renderBody(section.body) : "";
    const bullets = section.bullets.length > 0
      ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`
      : "";
    return `
      <section class="detail-page-section detail-page-section-${section.kind} detail-page-layout-${section.layout}" data-detail-page-section data-section-id="${escapeAttribute(section.id)}">
        <div class="detail-page-section-copy">${heading}${body}${bullets}</div>
        ${section.image ? renderImage(section.image) : ""}
      </section>
    `;
  }).join("");
  return `<article class="detail-page-document" data-detail-page-document><h1>${escapeHtml(document.title)}</h1>${content}</article>`;
}

function renderBody(body) {
  return body.split(/\n{2,}/u)
    .map((paragraph) => `<p>${paragraph.split("\n").map(escapeHtml).join("<br />")}</p>`)
    .join("");
}

function renderImage(image) {
  const attributes = [
    ["data-image-url", image.url],
    ["data-image-filename", image.filename],
    ["data-image-relative-path", image.url.slice(1)],
    ["data-image-purpose", image.alt],
  ].map(([name, value]) => `${name}="${escapeAttribute(value)}"`).join(" ");
  return `
    <figure class="generated-image-card detail-page-section-image" data-generated-image-card>
      <div class="generated-image-frame">
        <button class="generated-image-open" type="button" data-action="open-generated-image" ${attributes} aria-label="${escapeAttribute(`${image.alt || image.filename} 큰 화면으로 보기`)}">
          <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || image.filename)}" />
          <span class="generated-image-open-label">큰 화면으로 보기</span>
        </button>
      </div>
      <figcaption><strong>${escapeHtml(image.filename)}</strong><span>${escapeHtml(image.source === "edited" ? "수정 이미지" : "생성 이미지")}</span></figcaption>
    </figure>
  `;
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
