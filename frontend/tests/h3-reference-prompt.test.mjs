import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildH3ReferencePrompt, resolveNamedReferenceMarkers } from '../app/utils/h3-reference-prompt.mjs';

test('resolves longest full names including spaces and punctuation', () => {
  const result = resolveNamedReferenceMarkers('@医院走廊 · 夜里，@小明 对 @小明爸爸 说：「来了。」', {'医院走廊 · 夜里':1,'小明':2,'小明爸爸':3});
  assert.equal(result, '@图片1医院走廊 · 夜里，@图片2小明 对 @图片3小明爸爸 说：「来了。」');
});
test('H3 maps actual indices without adding example appearances or layout warnings', () => {
  const input = '0-3秒：@图片2甲 对 @图片3乙 说：「请坐。」';
  assert.equal(buildH3ReferencePrompt(input,[{name:'甲',index:2},{name:'乙',index:3}]),'0-3秒：<Subject 2> 甲 对 <Subject 3> 乙 说：「请坐。」');
});
test('native prompts are not wrapped a second time and text-only prompts stay intact', () => {
  const native = 'subject_definitions:\n<Subject 1> is the person in <Picture 1>.\nsummary:\n[reference generation] A wave.';
  assert.equal(buildH3ReferencePrompt(native,[{name:'Person',index:1}]),native);
  assert.equal(buildH3ReferencePrompt('原始提示词',[]),'原始提示词');
});
