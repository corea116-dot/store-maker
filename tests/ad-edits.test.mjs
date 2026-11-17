import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAdEdits,loadAdEdits,saveAdEdits} from '../assets/ad-edits.js';
import {buildAdFigmaPage} from '../assets/ad-figma.js';

test('광고 제목과 사진 수정은 같은 광고에 복원되고 피그마 출력에 반영된다',()=>{
  const src='/outputs/image-runs/4431d810-fe5d-46c0-aa55-a9940b6eb044/original.png';
  const edited='/outputs/image-runs/4431d810-fe5d-46c0-aa55-a9940b6eb044/edited.png';
  const result={title:'상품',adSet:{items:[{id:'ad-01',headline:'원래 제목'}]},images:{ratio:'4:5',files:[{url:src}]}};
  const map=new Map();const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
  assert.equal(saveAdEdits('job-1',{'ad-01':{headline:'새 제목',image:{url:edited}}},storage),true);
  const updated=applyAdEdits(result,loadAdEdits('job-1',storage));
  assert.equal(result.adSet.items[0].headline,'원래 제목');
  assert.equal(buildAdFigmaPage(updated).sections[0].heading,'새 제목');
  assert.equal(buildAdFigmaPage(updated).sections[0].image.url,edited);
  assert.equal(applyAdEdits(result,loadAdEdits('job-2',storage)).images.files[0].url,src);
  assert.equal(applyAdEdits(result,{'ad-01':{image:{url:'https://example.com/x.png'}}}).images.files[0].url,src);
});

test('브라우저 저장 실패를 알릴 수 있다',()=>{
  const storage={setItem(){throw Error('full');},getItem(){throw Error('blocked');}};
  assert.equal(saveAdEdits('job',{},storage),false);
  assert.deepEqual(loadAdEdits('job',storage),{});
});
