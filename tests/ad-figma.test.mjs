import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildAdFigmaPage, renderAdFigmaPreview } from '../assets/ad-figma.js';
import { renderAdCreativeImage } from '../assets/ad-creative-layout.js';

const result = { title:'조명 광고', adSet:{items:Array.from({length:5},(_,i)=>({id:`ad-${i}`,headline:`조명 제목 ${i}`,primaryText:`본문 ${i}`,cta:`버튼 ${i}`}))},images:{ratio:'4:5',files:Array.from({length:5},(_,i)=>({url:`/outputs/image-runs/4431d810-fe5d-46c0-aa55-a9940b6eb044/${i}.png`,filename:`${i}.png`}))} };

test('광고 5장의 실제 이미지와 문구를 같은 순서로 내보내고 기존 이미지 디자인을 미리 보여준다',()=>{
  const page=buildAdFigmaPage(result);
  assert.equal(page.width,860);
  assert.equal(page.sections.length,5);
  assert.deepEqual(page.sections.map(s=>s.image.url),result.images.files.map(f=>f.url));
  const preview=renderAdFigmaPreview(result,page);
  for (const [i,ad] of result.adSet.items.entries()) {
    assert.ok(preview.includes(renderAdCreativeImage({ad,image:result.images.files[i],ratio:'4:5'})));
    assert.equal(page.sections[i].body,ad.primaryText);
    assert.equal(page.sections[i].cta,ad.cta);
  }
  assert.throws(()=>buildAdFigmaPage({...result,images:{...result.images,files:result.images.files.slice(0,4)}}),/모든 광고/);
  const extra=buildAdFigmaPage({...result,images:{...result.images,files:[...result.images.files,{url:'/outputs/image-runs/4431d810-fe5d-46c0-aa55-a9940b6eb044/extra.png'}]}});
  assert.equal(extra.sections.length,6);
});

test('피그마 가져오기는 각 광고의 사진, 그라디언트, 제목과 본문을 분리한다',async()=>{
  const script=await readFile(new URL('../figma-plugin/code.js',import.meta.url),'utf8');
  const messages=[];
  function node(type){return {type,children:[],height:100,resize(w,h){this.width=w;this.height=h;},appendChild(child){this.children.push(child);},remove(){this.removed=true;}};}
  const figma={showUI(){},ui:{postMessage(m){messages.push(m);}},async listAvailableFontsAsync(){return [{fontName:{family:'Inter',style:'Regular'}}];},async loadFontAsync(){},createFrame(){return node('FRAME');},createText(){return node('TEXT');},createRectangle(){return node('RECTANGLE');},createEllipse(){return node('ELLIPSE');},createImage(){return {hash:'image-hash'};},currentPage:{selection:[]},viewport:{scrollAndZoomIntoView(){}}};
  vm.runInNewContext(script,{figma,__html__:'',Uint8Array,Error,Number,String,parseInt});
  const page=buildAdFigmaPage(result);
  page.images=Object.fromEntries(result.images.files.map(f=>[f.url,{bytes:new Uint8Array([1]),width:1122,height:1402}]));
  await figma.ui.onmessage({type:'create',data:page});
  assert.equal(messages.at(-1).type,'done',messages.at(-1).message);
  const root=figma.currentPage.selection[0];
  assert.equal(root.width,860); assert.equal(root.children.length,5);
  for (const [i,section] of root.children.entries()) {
    const [creative,copy]=section.children;
    assert.equal(creative.children[0].fills[0].type,'IMAGE');
    assert.equal(creative.children[1].fills[0].type,'GRADIENT_LINEAR');
    assert.ok(creative.children.some(n=>n.type==='TEXT' && n.characters.includes(`제목 ${i}`)));
    assert.equal(copy.children[0].characters,`본문 ${i}`);
    assert.equal(copy.children[1].characters,`버튼 ${i}`);
  }
});
