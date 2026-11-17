import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDetailPageDocument, migrateDetailPageDocument } from '../lib/server/detail-page-schema.mjs';
const visual={version:1,height:800,layers:[{type:'image',x:0,y:0,width:860,height:800},{type:'gradient',x:0,y:400,width:860,height:400,from:'#000000',to:'#ffffff',direction:'vertical'},{type:'text',field:'heading',x:40,y:500,width:780,height:100,fontSize:48,color:'#ffffff'}]};
const doc={schemaVersion:2,title:'제목',productName:'상품',markets:['smartstore'],sections:[{id:'one',kind:'free-text',layout:'text-only',visible:true,heading:'안녕',body:'',bullets:[],source:'generated',visual}]};
test('visual design survives normalization and migration',()=>{assert.deepEqual(normalizeDetailPageDocument(doc).sections[0].visual,migrateDetailPageDocument(doc).document.sections[0].visual);});
test('rejects visual layer outside 860px section',()=>{const bad=structuredClone(doc);bad.sections[0].visual.layers[0].width=861;assert.throws(()=>normalizeDetailPageDocument(bad),/visual is invalid/);});

test('AI design plan is attached to generated content and its image', async()=>{
 const {createDetailPageDocument,renderDetailPageDocument}=await import('../lib/server/detail-page-document.mjs');
 const {buildFigmaPage,renderFigmaPagePreview}=await import('../assets/detail-page-figma.js');
 const section={...visual,index:0,layers:[...visual.layers,{type:'text',field:'body',x:40,y:650,width:780,height:100,fontSize:24,color:'#ffffff'},{type:'text',field:'bullets',x:40,y:750,width:780,height:50,fontSize:18,color:'#ffffff'}]};
 const markdown='# 상품\n\n## 특징\n향긋한 설명\n\n```store-maker-visual\n'+JSON.stringify({sections:[section]})+'\n```';
 const image={url:'/outputs/image-runs/4431d810-fe5d-46c0-aa55-a9940b6eb044/a.png',filename:'a.png',purpose:'제품'};
 const doc=createDetailPageDocument({title:'상품',productName:'상품',markets:['smartstore'],markdown,images:{files:[image]}});
 assert.equal(doc.sections[0].image.url,image.url);
 assert.equal(doc.sections[0].visual.layers[1].type,'gradient');
 const page=buildFigmaPage(doc); const preview=renderFigmaPagePreview(page); const html=renderDetailPageDocument(doc).html;
 assert.ok(preview.includes('linear-gradient')); assert.ok(html.includes('linear-gradient'));
 assert.equal(page.sections[1].visual.layers[2].field,'heading');
 assert.equal(page.sections[1].heading,'특징');
});
