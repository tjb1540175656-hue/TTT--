interface ExportLeaf {
  id: string;
  text: string;
  msgIndex: number;
  timeStart?: string;
  timeEnd?: string;
  stale?: boolean;
}

interface ExportSummary {
  id: string;
  text: string;
  level: number;
  childIds: string[];
  importedFloorStart?: number;
  importedFloorEnd?: number;
}

/** 导出全部节点而非列表根节点，避免折叠、搜索或压缩导致原始摘要遗漏。 */
export function renderAllSummaries(chatName: string, leaves: ExportLeaf[], summaries: ExportSummary[]): string {
  const leafMap = new Map(leaves.map(l => [l.id, l]));
  const summaryMap = new Map(summaries.map(s => [s.id, s]));
  function floors(id: string, seen = new Set<string>()): number[] {
    if (seen.has(id)) return [];
    seen.add(id);
    const leaf = leafMap.get(id);
    if (leaf) return [leaf.msgIndex];
    const node = summaryMap.get(id);
    if (!node) return [];
    if (Number.isFinite(node.importedFloorEnd)) {
      return [node.importedFloorStart ?? 0, node.importedFloorEnd!];
    }
    return node.childIds.flatMap(child => floors(child, seen));
  }
  const range = (id: string) => {
    const all = floors(id);
    if (!all.length) return '楼层未知';
    const start = Math.min(...all), end = Math.max(...all);
    return start === end ? `#${start}` : `#${start} - #${end}`;
  };
  const lines = [
    '# 柏宝书 · 全部摘要', '', `聊天：${chatName.replace(/[\r\n]+/g, ' ')}`, '',
    `逐楼摘要：${leaves.length} 条；各级总结（含导入）：${summaries.length} 条。`, '',
    '## 逐楼摘要', '',
  ];
  for (const leaf of [...leaves].sort((a, b) => a.msgIndex - b.msgIndex)) {
    lines.push(`### #${leaf.msgIndex}${leaf.stale ? '（当前页摘要待更新）' : ''}`, '');
    const time = [leaf.timeStart, leaf.timeEnd].filter(Boolean).join(' — ');
    if (time) lines.push(`时间：${time}`, '');
    lines.push(leaf.text || '（无摘要正文）', '');
  }
  lines.push('## 各级总结 / 导入历史', '');
  for (const node of summaries) {
    lines.push(`### 总结 L${node.level} · ${range(node.id)}`, '', node.text || '（无总结正文）', '');
  }
  return lines.join('\n');
}
