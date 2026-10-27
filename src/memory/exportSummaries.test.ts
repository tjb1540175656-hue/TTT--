import { describe, expect, it } from 'vitest';
import { renderAllSummaries } from './exportSummaries';

describe('export all summaries', () => {
  it('includes compressed children, stale leaves and every summary level', () => {
    const text = renderAllSummaries('测试聊天', [
      { id: 'b', text: '第二楼原摘要', msgIndex: 2, stale: true },
      { id: 'a', text: '第一楼原摘要', msgIndex: 0 },
    ], [
      { id: 'l1', text: '一级压缩', level: 1, childIds: ['a', 'b'] },
      { id: 'l2', text: '二级压缩', level: 2, childIds: ['l1'] },
      { id: 'old', text: '导入旧剧情', level: 1, childIds: [], importedFloorEnd: 10 },
    ]);
    for (const content of ['第一楼原摘要', '第二楼原摘要', '一级压缩', '二级压缩', '导入旧剧情']) {
      expect(text).toContain(content);
    }
    expect(text.indexOf('第一楼原摘要')).toBeLessThan(text.indexOf('第二楼原摘要'));
    expect(text).toContain('总结 L2 · #0 - #2');
    expect(text).toContain('总结 L1 · #0 - #10');
    expect(text).toContain('当前页摘要待更新');
  });

  it('tolerates broken links and cycles', () => {
    expect(renderAllSummaries('空聊天', [], [
      { id: 'cycle', text: '保留文本', level: 1, childIds: ['cycle', 'missing'] },
    ])).toContain('楼层未知');
  });
});
