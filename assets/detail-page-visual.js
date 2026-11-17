function esc(v) { return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
export function visualText(section, field) { return field === 'bullets' ? (section.bullets ?? []).map(v => `• ${v}`).join('\n') : String(section[field] ?? ''); }
export function renderVisualSection(section) {
  const visual = section.visual;
  const html = visual.layers.map((layer) => {
    const box=`position:absolute;left:${layer.x/8.6}%;top:${layer.y/visual.height*100}%;width:${layer.width/8.6}%;height:${layer.height/visual.height*100}%;`;
    if (layer.type === 'image') return section.image?.url ? `<img alt="${esc(section.image.alt)}" src="${esc(section.image.url)}" style="${box}object-fit:cover;display:block;"/>` : '';
    if (layer.type === 'text') return `<div style="${box}font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;font-size:${layer.fontSize/8.6}cqw;line-height:1.3;font-weight:${layer.weight === 'bold' ? 700 : 400};color:${layer.color};white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;">${esc(visualText(section,layer.field))}</div>`;
    if (layer.type === 'rectangle') return `<div style="${box}background:${layer.color};border-radius:${layer.radius/8.6}cqw;"></div>`;
    if (layer.type === 'gradient') return `<div style="${box}background:linear-gradient(to ${layer.direction === 'horizontal' ? 'right' : 'bottom'},${layer.from},${layer.to});"></div>`;
    return '';
  }).join('');
  const unplaced = section.image?.url && !visual.layers.some(l=>l.type==='image') ? `<img src="${esc(section.image.url)}" alt="${esc(section.image.alt)}" style="width:100%;height:auto;display:block;"/>` : '';
  return `<div style="container-type:inline-size;width:100%;"><div style="position:relative;width:100%;aspect-ratio:860/${visual.height};overflow:hidden;">${html}</div>${unplaced}</div>`;
}
