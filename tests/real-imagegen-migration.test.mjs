import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, state } from '../assets/settings-state.js';

test('replaces a saved fake image engine once without changing other settings', () => {
 const store=new Map([['store-maker.settings.v2',JSON.stringify({provider:'custom',generationMode:'ad-set',imageGenerationExplicit:true,imageGeneration:{provider:'codex-imagegen',command:'./scripts/fake-codex-imagegen.mjs',extraArgs:'--test-only',model:'CLI config',timeoutMs:'300000'}})]]);
 globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 try {
  loadSettings();
  assert.equal(state.imageGeneration.command,'codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write');
  assert.equal(state.imageGeneration.extraArgs,'');
  assert.equal(state.generationMode,'ad-set');
  assert.equal(JSON.parse(store.get('store-maker.settings.v2')).imageGeneration.command,state.imageGeneration.command);
  const saved=JSON.parse(store.get('store-maker.settings.v2'));saved.imageGeneration.command='./scripts/fake-codex-imagegen.mjs';store.set('store-maker.settings.v2',JSON.stringify(saved));
  loadSettings(); assert.equal(state.imageGeneration.command,'./scripts/fake-codex-imagegen.mjs');
 } finally {delete globalThis.localStorage;}
});
