import { describe, expect, it } from 'vitest';
import { extractSummaryTag } from './summaryTag';

describe('extractSummaryTag', () => {
  it('extracts only complete, nonempty summary tags', () => {
    expect(extractSummaryTag('正文<summary>剧情摘要</summary>结尾')).toBe('剧情摘要');
    expect(extractSummaryTag('<summary>一</summary>\n<SUMMARY>二</SUMMARY>')).toBe('一\n\n二');
    expect(extractSummaryTag('没有标签')).toBe('');
    expect(extractSummaryTag('<summary>未闭合')).toBe('');
    expect(extractSummaryTag('<summary>   </summary>')).toBe('');
  });
});
