import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildH3ReferencePrompt } from '../app/utils/h3-reference-prompt.mjs';

test('binds scene and character sheets to their actual image indices without changing dialogue', () => {
  const input = '0-3秒：@图片2甲先生 对 @图片3乙先生 说：「请坐，我们开始吧。」';
  const result = buildH3ReferencePrompt(input, [
    {kind:'scene',name:'大厅',index:1},
    {kind:'character',name:'甲先生',index:2},
    {kind:'character',name:'乙先生',index:3},
  ]);
  assert.match(result, /environment 大厅 from <Picture 1>/);
  assert.match(result, /甲先生.*<Picture 2>/);
  assert.match(result, /2 distinct identities: 甲先生, 乙先生/);
  assert.ok(result.includes('0-3秒：<Subject 2> 甲先生 对 <Subject 3> 乙先生 说：「请坐，我们开始吧。」'));
  assert.ok(!result.includes('@图片'));
  assert.match(result, /SAME individual/);
});
test('does not invent image references for text-only input', () => {
  assert.equal(buildH3ReferencePrompt('原始提示词', []), '原始提示词');
});
test('defines appearance once without injecting extra cast into timed shots', () => {
  const result = buildH3ReferencePrompt('0-3秒：@图片2甲先生 说：「来了。」\n3-6秒：@图片3丙女士 点头。', [
    {kind:'character',name:'甲先生',index:2,appearanceLock:'navy jacket; round glasses',singleView:true},
    {kind:'character',name:'丙女士',index:3,appearanceLock:'cream dress; brown ponytail'},
  ]);
  const detail = result.split('detailed_description:')[1];
  assert.equal(result.split('navy jacket; round glasses').length, 2);
  assert.equal(result.split('cream dress; brown ponytail').length, 2);
  assert.ok(!detail.includes('cream dress'));
  assert.match(result, /single-person reference/);
  assert.match(result, /Lighting may change shading/);
  assert.ok(result.includes('「来了。」'));
});
