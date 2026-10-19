import assert from 'node:assert/strict';
import { extractSummary, scan, memoryText, writeSummary } from './lite.js';

assert.equal(extractSummary('正文<summary>剧情进展</summary>尾声'), '剧情进展');
assert.equal(extractSummary('<summary>一</summary><summary>二</summary>'), '一\n\n二');
assert.equal(extractSummary('<summary>未闭合'), '');
assert.equal(extractSummary('普通正文'), '');

let saved = 0;
const chat = Array.from({ length: 7 }, (_, index) => ({
    is_user: false,
    is_system: index === 0,
    mes: index === 1 ? '没有摘要' : `<summary>第 ${index} 楼</summary>`,
    extra: index === 0 ? { bbs_hidden: true } : {},
}));
const context = {
    chat,
    chatMetadata: {},
    saveChat: () => { saved++; },
    saveMetadataDebounced: () => {},
};

assert.equal(scan(context), true);
assert.equal(saved, 1);
assert.equal(chat[0].is_system, false);
assert.equal(chat[0].extra.bbs_hidden, undefined);
assert.equal(chat[1].extra.bbs_lite.summary, '');
assert.equal(writeSummary(context, 1, '手动补写的剧情'), true);
assert.equal(chat[1].extra.bbs_lite.summary, '手动补写的剧情');
assert.equal(scan(context), false);
assert.match(memoryText(context), /第 0 楼/);
assert.doesNotMatch(memoryText(context), /第 6 楼/);
assert.equal(scan(context), false);
assert.equal(saved, 2);

chat[0].mes = '改写后没有摘要';
assert.equal(scan(context), true);
assert.equal(chat[0].extra.bbs_lite.summary, '');
assert.equal(memoryText(context), '');

console.log('柏宝书简版：提取、空摘要、手动写入、旧隐藏楼层、注入窗口和编辑失效均通过');
