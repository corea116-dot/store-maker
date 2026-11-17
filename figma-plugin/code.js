figma.showUI(__html__, { width: 380, height: 300, title: "스토어메이커 상세페이지" });
figma.ui.onmessage = async (message) => {
  if (message.type !== "create") return;
  let root;
  try {
    const page = message.data;
    if (page?.format !== "store-maker-figma" || page.version !== 2 || page.width !== 860 || page.sourceWidth !== 1120 || !Array.isArray(page.sections) || page.sections.length > 61) throw Error("파일 형식이 올바르지 않습니다.");
    const fonts = await figma.listAvailableFontsAsync();
    const families = ["Noto Sans KR", "Apple SD Gothic Neo", "Inter"];
    const family = families.find((name) => fonts.some((item) => item.fontName.family === name));
    if (!family) throw Error("사용 가능한 글꼴을 찾지 못했습니다.");
    const regular = fonts.find((item) => item.fontName.family === family && item.fontName.style === "Regular")?.fontName || fonts.find((item) => item.fontName.family === family).fontName;
    const bold = fonts.find((item) => item.fontName.family === family && /^(Bold|Black|Heavy)$/i.test(item.fontName.style))?.fontName || regular;
    await figma.loadFontAsync(regular);
    if (bold.style !== regular.style) await figma.loadFontAsync(bold);
    const images = {};
    for (const section of page.sections) {
      const url = section.image?.url;
      if (!url || images[url]) continue;
      const image = page.images?.[url];
      if (!image?.bytes || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) throw Error("이미지 정보가 올바르지 않습니다.");
      images[url] = { hash: figma.createImage(image.bytes).hash, width: image.width, height: image.height };
    }
    root = figma.createFrame(); root.name = `상세페이지 · ${page.title || "스토어메이커"}`; root.layoutMode = "VERTICAL"; root.primaryAxisSizingMode = "AUTO"; root.counterAxisSizingMode = "FIXED"; root.resize(860, 100); root.itemSpacing = 0; root.fills = [{ type:"SOLID", color:{r:1,g:1,b:1} }];
    const scale = 860 / 1120;
    const color = (hex) => { if (!/^#[a-f0-9]{6}$/i.test(hex)) throw Error("색상 정보가 올바르지 않습니다."); return { r:parseInt(hex.slice(1,3),16)/255, g:parseInt(hex.slice(3,5),16)/255, b:parseInt(hex.slice(5,7),16)/255 }; };
    for (const [index, section] of page.sections.entries()) {
      const frame = figma.createFrame(); frame.name = section.id === "page-title" ? "페이지 제목" : `${String(index).padStart(2,"0")} · ${section.heading || "이미지"}`; frame.layoutMode = "VERTICAL"; frame.primaryAxisSizingMode = "AUTO"; frame.counterAxisSizingMode = "FIXED"; frame.resize(860, 100); frame.itemSpacing = 0; frame.fills = []; root.appendChild(frame);
      if (section.creative) {
        const { canvas: source, layout } = section.creative;
        if (!source || !layout || !Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width < 1 || source.height < 1 || !Array.isArray(layout.lines) || layout.lines.length > 100 || !section.image?.url || ![layout.padding,layout.startY,layout.lineHeight,layout.fontSize].every(Number.isFinite)) throw Error("광고 디자인 정보가 올바르지 않습니다.");
        const factor=860/source.width, height=source.height*factor;
        const canvas=figma.createFrame(); canvas.name="광고 이미지와 제목"; canvas.resize(860,height); canvas.fills=[]; canvas.clipsContent=true; frame.appendChild(canvas);
        const photo=figma.createRectangle(); photo.name="생성 사진"; photo.resize(860,height); photo.fills=[{type:"IMAGE",scaleMode:"FILL",imageHash:images[section.image.url].hash}]; canvas.appendChild(photo);
        const gradient=figma.createRectangle(); gradient.name="그라디언트"; gradient.resize(860,height); gradient.fills=[{type:"GRADIENT_LINEAR",gradientTransform:[[0,1,0],[1,0,0]],gradientStops:[{position:0.38,color:{r:0,g:0,b:0,a:0}},{position:1,color:{r:0,g:0,b:0,a:0.84}}]}]; canvas.appendChild(gradient);
        for (const [lineIndex,line] of layout.lines.entries()) {
          if (typeof line !== "string" || line.length > 1000) throw Error("광고 제목이 올바르지 않습니다.");
          const text=figma.createText(); text.name="광고 제목"; text.fontName=bold; text.fontSize=layout.fontSize*factor; text.characters=line; text.fills=[{type:"SOLID",color:{r:1,g:1,b:1}}]; text.textAutoResize="WIDTH_AND_HEIGHT"; text.x=layout.padding*factor; text.y=(layout.startY+lineIndex*layout.lineHeight-layout.fontSize*.84)*factor; canvas.appendChild(text);
        }
        if (section.body || section.cta) {
          const copy=figma.createFrame(); copy.name="광고 문구"; copy.layoutMode="VERTICAL"; copy.primaryAxisSizingMode="AUTO"; copy.counterAxisSizingMode="FIXED"; copy.resize(860,100); copy.paddingTop=24;copy.paddingBottom=24;copy.paddingLeft=24;copy.paddingRight=24;copy.itemSpacing=12;copy.fills=[{type:"SOLID",color:{r:1,g:1,b:1}}];frame.appendChild(copy);
          for (const [name,value] of [["본문",section.body],["버튼 문구",section.cta]]) { if (!value) continue; const text=figma.createText();text.name=name;text.fontName=regular;text.fontSize=20;text.lineHeight={unit:"PERCENT",value:140};text.characters=String(value);text.fills=[{type:"SOLID",color:color("#222222")}];text.textAutoResize="HEIGHT";text.resize(812,text.height);copy.appendChild(text); }
        }
      }
      if (section.visual) {
        const visual = section.visual;
        if (!Number.isFinite(visual.height) || visual.height <= 0 || visual.height > 20000 || !Array.isArray(visual.layers) || visual.layers.length > 100) throw Error("디자인 구성이 올바르지 않습니다.");
        const canvas=figma.createFrame(); canvas.name="편집 가능한 디자인"; canvas.resize(860,visual.height); canvas.fills=[]; canvas.clipsContent=true; frame.appendChild(canvas);
        for (const item of visual.layers) {
          if (![item.x,item.y,item.width,item.height].every(Number.isFinite) || item.width <= 0 || item.height <= 0 || item.x < 0 || item.y < 0 || item.x+item.width > 860 || item.y+item.height > visual.height) throw Error("요소 위치가 올바르지 않습니다.");
          let node;
          if (item.type === "image") {
            if (!section.image?.url) continue;
            node=figma.createRectangle(); node.name="사진"; node.fills=[{type:"IMAGE",scaleMode:"FILL",imageHash:images[section.image.url].hash}];
          } else if (item.type === "text") {
            if (!["heading","body","bullets"].includes(item.field) || !Number.isFinite(item.fontSize) || item.fontSize < 8 || item.fontSize > 200) throw Error("문구 정보가 올바르지 않습니다.");
            node=figma.createText(); node.fontName=item.weight === "bold" ? bold : regular; node.fontSize=item.fontSize; node.characters=item.field === "bullets" ? (section.bullets || []).map(v=>`• ${v}`).join("\n") : String(section[item.field] || ""); node.name=item.field; node.fills=[{type:"SOLID",color:color(item.color)}]; node.lineHeight={unit:"PERCENT",value:130}; node.textAutoResize="NONE";
          } else if (item.type === "rectangle") {
            node=figma.createRectangle(); node.name="도형"; node.fills=[{type:"SOLID",color:color(item.color)}]; node.cornerRadius=item.radius || 0;
          } else if (item.type === "gradient") {
            node=figma.createRectangle(); node.name="그라디언트"; node.fills=[{type:"GRADIENT_LINEAR",gradientTransform:item.direction === "horizontal" ? [[1,0,0],[0,1,0]] : [[0,1,0],[1,0,0]],gradientStops:[{position:0,color:{...color(item.from),a:1}},{position:1,color:{...color(item.to),a:1}}]}];
          } else throw Error("지원하지 않는 디자인 요소입니다.");
          node.x=item.x; node.y=item.y; node.resize(item.width,item.height); canvas.appendChild(node);
        }
      }
      if (section.copy) {
        const layout = section.copy;
        if (!Number.isFinite(layout.height) || layout.height < 1 || layout.height > 100000 || !Array.isArray(layout.nodes) || layout.nodes.length > 3000) throw Error("문구 구성 정보가 올바르지 않습니다.");
        const copy = figma.createFrame(); copy.name = "문구 카드"; copy.resize(860, layout.height * scale); copy.fills = [{type:"SOLID",color:color("#ffffff")}]; copy.clipsContent = false; frame.appendChild(copy);
        const border=figma.createRectangle(); border.name="테두리"; border.x=24*scale; border.y=24*scale; border.resize((1120-48)*scale,(layout.height-48)*scale); border.fills=[]; border.strokes=[{type:"SOLID",color:color("#c8c8c8")}]; border.strokeWeight=scale; border.dashPattern=[3*scale,8*scale]; copy.appendChild(border);
        for (const item of layout.nodes) {
          if (![item.x,item.y].every(Number.isFinite)) throw Error("요소 위치가 올바르지 않습니다.");
          if (item.type === "text") {
            if (typeof item.value !== "string" || item.value.length > 20000 || !Number.isFinite(item.size) || item.size <= 0 || item.size > 500) throw Error("문구 정보가 올바르지 않습니다.");
            const node=figma.createText(); node.fontName=item.weight >= 700 ? bold : regular; node.characters=item.value; node.name=item.value.slice(0,50) || "문구"; node.fontSize=item.size*scale; node.fills=[{type:"SOLID",color:color(item.fill)}]; node.textAutoResize="WIDTH_AND_HEIGHT"; node.x=item.x*scale; node.y=(item.y-item.size*.84)*scale; copy.appendChild(node);
          } else if (item.type === "line") {
            if (!Number.isFinite(item.width) || item.width <= 0) throw Error("선 정보가 올바르지 않습니다.");
            const node=figma.createRectangle(); node.name="구분선"; node.x=item.x*scale; node.y=(item.y-1)*scale; node.resize(item.width*scale,2*scale); node.fills=[{type:"SOLID",color:color(item.color)}]; copy.appendChild(node);
          } else if (item.type === "circle") {
            const node=figma.createEllipse(); node.name="글머리 기호"; node.x=(item.x-item.radius)*scale; node.y=(item.y-item.radius)*scale; node.resize(item.radius*2*scale,item.radius*2*scale); node.fills=[{type:"SOLID",color:color(item.fill)}]; copy.appendChild(node);
          } else throw Error("지원하지 않는 요소입니다.");
        }
      }
      if (section.image?.url && !section.creative && (!section.visual || !section.visual.layers.some(item=>item.type === "image"))) { const image=images[section.image.url]; const node=figma.createRectangle(); node.name=`이미지 · ${section.image.filename || index}`; node.resize(860, 860*image.height/image.width); node.fills=[{type:"IMAGE",scaleMode:"FIT",imageHash:image.hash}]; frame.appendChild(node); }
    }
    figma.currentPage.selection=[root]; figma.viewport.scrollAndZoomIntoView([root]);
    figma.ui.postMessage({type:"done",message:`상세페이지를 만들었습니다. 사용 글꼴: ${family}. 이미지에 포함된 글자와 도형은 이미지로 유지됩니다.`});
  } catch (error) { if(root) root.remove(); figma.ui.postMessage({type:"error",message:error instanceof Error ? error.message : String(error)}); }
};
