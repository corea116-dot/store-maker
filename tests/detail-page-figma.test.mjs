import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildFigmaPage, renderFigmaPagePreview, makeFigmaPackage } from '../assets/detail-page-figma.js';
import { renderDetailPageDocument } from '../lib/server/detail-page-render.mjs';

const image = (name) => ({id:`id-${name}`,url:`/outputs/image-runs/4431d810-fe5d-46c0-aa55-a9940b6eb044/${name}.png`,filename:`${name}.png`,alt:name,source:'generated'});
const documentValue = {schemaVersion:2,title:'상품 제목',productName:'상품',markets:['smartstore'],sections:[{id:'one',kind:'features',layout:'text-only',source:'generated',visible:true,heading:'실제 제목',body:'실제 설명',bullets:['장점'],image:image('one')},{id:'two',kind:'free-image',layout:'full-bleed',source:'generated',visible:true,heading:'',body:'',bullets:[],image:image('two')}]};

test('preview and export use the same cards as the generated HTML and retain all image sections', () => {
  const page=buildFigmaPage(documentValue);
  const preview=renderFigmaPagePreview(page);
  const html=renderDetailPageDocument(documentValue).html;
  assert.equal(page.width,860);
  assert.equal(page.sections.length,3);
  assert.deepEqual(page.sections.slice(1).map((s)=>s.image.url),documentValue.sections.map((s)=>s.image.url));
  const cards=(s)=>[...s.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m)=>m[0]);
  assert.deepEqual(cards(preview),cards(html));
  assert.ok(page.sections[1].copy.nodes.some((n)=>n.type==='text' && n.value==='실제 제목'));
});

test('Figma importer creates editable elements from the actual copy layout', async () => {
  const script=await readFile(new URL('../figma-plugin/code.js',import.meta.url),'utf8');
  const messages=[];
  function node(type){return {type,children:[],height:100,resize(w,h){this.width=w;this.height=h;},appendChild(child){this.children.push(child);},remove(){this.removed=true;}};}
  const figma={showUI(){},ui:{postMessage(m){messages.push(m);}},async listAvailableFontsAsync(){return [{fontName:{family:'Inter',style:'Regular'}}];},async loadFontAsync(){},createFrame(){return node('FRAME');},createText(){return node('TEXT');},createRectangle(){return node('RECTANGLE');},createEllipse(){return node('ELLIPSE');},createImage(){return {hash:'image-hash'};},currentPage:{selection:[]},viewport:{scrollAndZoomIntoView(){}}};
  vm.runInNewContext(script,{figma,__html__:'',Uint8Array,Error,Number,String,parseInt});
  const page=buildFigmaPage(documentValue); page.images=Object.fromEntries(documentValue.sections.map((s)=>[s.image.url,{bytes:new Uint8Array([1]),width:100,height:200}]));
  await figma.ui.onmessage({type:'create',data:page});
  assert.equal(messages.at(-1).type,'done',messages.at(-1).message);
  const root=figma.currentPage.selection[0]; assert.equal(root.width,860);
  const [copy,photo]=root.children[1].children;
  assert.ok(copy.children.some((n)=>n.type==='TEXT' && n.characters==='실제 제목'));
  assert.ok(copy.children.some((n)=>n.name==='구분선'));
  assert.ok(copy.children.some((n)=>n.type==='ELLIPSE'));
  assert.equal(photo.fills[0].type,'IMAGE'); assert.equal(photo.height,1720);
});

test('export reports a missing image instead of silently dropping it', async()=>{
  await assert.rejects(makeFigmaPackage(buildFigmaPage(documentValue),{fetchImage:async()=>({ok:false})}),/이미지를 불러오지 못했습니다/);
});

test('generated design becomes separate Figma photo, gradient, shape and editable copy', async()=>{
 const script=await readFile(new URL('../figma-plugin/code.js',import.meta.url),'utf8');
 const messages=[];
 function node(type){return {type,children:[],height:100,resize(w,h){this.width=w;this.height=h;},appendChild(child){this.children.push(child);},remove(){this.removed=true;}};}
 const figma={showUI(){},ui:{postMessage(m){messages.push(m);}},async listAvailableFontsAsync(){return [{fontName:{family:'Inter',style:'Regular'}}];},async loadFontAsync(){},createFrame(){return node('FRAME');},createText(){return node('TEXT');},createRectangle(){return node('RECTANGLE');},createEllipse(){return node('ELLIPSE');},createImage(){return {hash:'image-hash'};},currentPage:{selection:[]},viewport:{scrollAndZoomIntoView(){}}};
 vm.runInNewContext(script,{figma,__html__:'',Uint8Array,Error,Number,String,parseInt});
 const doc=structuredClone(documentValue); doc.sections=doc.sections.slice(0,1); doc.sections[0].visual={version:1,height:900,layers:[{type:'image',x:0,y:0,width:860,height:900},{type:'gradient',x:0,y:500,width:860,height:400,from:'#ffffff',to:'#eeeeee',direction:'vertical'},{type:'rectangle',x:20,y:600,width:40,height:40,color:'#000000',radius:2},{type:'text',field:'heading',x:100,y:600,width:650,height:100,fontSize:48,color:'#111111',weight:'bold'}]};
 const page=buildFigmaPage(doc);page.images={[doc.sections[0].image.url]:{bytes:new Uint8Array([1]),width:100,height:100}};
 await figma.ui.onmessage({type:'create',data:page});
 assert.equal(messages.at(-1).type,'done',messages.at(-1).message);
 const canvas=figma.currentPage.selection[0].children[1].children[0];
 assert.equal(canvas.children.length,4);assert.equal(canvas.children[0].fills[0].type,'IMAGE');assert.equal(canvas.children[1].fills[0].type,'GRADIENT_LINEAR');assert.equal(canvas.children[2].name,'도형');assert.equal(canvas.children[3].characters,'실제 제목');
});
