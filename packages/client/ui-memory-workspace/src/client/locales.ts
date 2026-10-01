/** Locale-owned knowledge workspace labels. */
export const en = {
  panel: 'Memory', title: 'Memorix & Graphify', browse: 'Browse memories', graph: 'Context graph',
  refresh: 'Refresh', search: 'Search all records', previous: 'Previous', next: 'Next',
  loading: 'Loading…', upload: 'Upload documents', importing: 'Importing into Memorix…',
  importInfo: 'Extracted text is stored as Memorix memories. The original file is retained locally. Partial imports can be retried.',
  textFormats: 'Documents: TXT, Markdown, CSV, JSON, logs, PDF and Office',
  allScope: 'Local store: all projects, statuses and visibility scopes. These records are shown to you, not automatically sent to a model.',
  detail: 'Record details', empty: 'No records', imported: 'Document chunks saved', total: 'Total',
  source: 'Source',
  graphMissing: 'Generate a Graphify graph.json export in this project’s graphify-out folder, then refresh.',
}
/** Keys in the memory workspace dictionary. */
export type MemoryWorkspaceKey = keyof typeof en
/** Chinese memory workspace labels. */
export const zh: Record<MemoryWorkspaceKey, string> = {
  panel: '记忆', title: 'Memorix 与 Graphify', browse: '浏览记忆', graph: '上下文图谱',
  refresh: '刷新', search: '搜索所有记录', previous: '上一页', next: '下一页',
  loading: '正在加载…', upload: '上传文档', importing: '正在导入 Memorix…',
  importInfo: '提取的文本将存为 Memorix 记忆，原始文件保留在本地。部分导入失败时可以重试。',
  textFormats: '文档：TXT、Markdown、CSV、JSON、日志、PDF 和 Office',
  allScope: '本地存储：所有项目、状态与可见范围。这些记录仅向你展示，不会自动发送给模型。',
  detail: '记录详情', empty: '没有记录', imported: '已保存的文档片段', total: '总数',
  source: '来源',
  graphMissing: '在此项目的 graphify-out 文件夹中生成 Graphify graph.json 导出，然后刷新。',
}
/** Registered memory workspace locale namespace. */
export const NS = 'memoryWorkspace'
