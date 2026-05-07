# Reading Partner 审计与整改跟踪报告

日期：2026-05-07  
仓库：`D:\programme\Vscode Projects\Reading_Partner`
来源：`https://github.com/Better-Rain/Reading_Partner.git`
当前阶段：已完成初审，正在按风险清单逐步整改。

## 1. 执行结论

项目已在本机完成依赖安装、类型检查和生产构建验证，可以继续开发。初审发现的主要风险集中在三类：

1. 前端主文件过大，职责高度集中。
2. 主进程对大文件、数据库持久化、AI 流式请求的长耗时链路缺少足够隔离和容错。
3. 文档、密钥、词典等边缘路径存在可维护性和鲁棒性问题。

截至本次更新，多个风险已完成或部分缓解：`App.tsx` 已从审计时约 3700+ 行下降到约 1290 行；AI SSE 容错、KeyStore 容错、StarDict 文件句柄复用、数据库写入合并、PDF 文本抽取让出事件循环、安装路径文档均已处理。仍建议继续拆业务 hooks，并对 PDF 索引和数据库持久化做更深层的后台化/增量化改造。

## 2. 环境与验证

本机环境：

- Windows PowerShell 5.1
- Node.js v24.14.1
- npm 11.11.0

安装命令：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm ci --no-audit --no-fund
```

常规验证命令：

```powershell
npm run typecheck
npm run build
```

最近一次验证结果：`npm run typecheck` 和 `npm run build` 均通过。

补充样例 PDF 烟测：

- 文件：`D:\Books\The Autobiography of Lincoln Steffens Volume II Muckraking Revolution Seeing America at Last (Lincoln aut Steffens) (z-library.sk, 1lib.sk, z-lib.sk).pdf`
- 结果：546 页，532 个非空文本页，约 1,525,282 字符，整本抽取约 4.3 秒。

## 3. 风险处理状态

| 编号 | 风险 | 当前状态 | 已处理内容 | 剩余建议 |
| --- | --- | --- | --- | --- |
| R1 | `src/renderer/src/App.tsx` 过大，前端职责集中 | 大幅缓解，继续优化 | 已拆出 AI 面板、笔记面板、搜索/设置/词汇面板、Markdown 渲染、批注浮层、PDF 搜索高亮、阅读器工具栏、阅读器表面、窗口栏、文档库、选区工具条、快捷键/平移/搜索定位/视口重置 hooks。`App.tsx` 已降至约 1290 行。 | 继续拆 AI 会话处理、批注 CRUD、词汇本操作等业务 hooks。 |
| R2 | 数据库每次写操作同步整库落盘，可能阻塞主进程 | 部分缓解 | `ReadingPartnerDatabase.persist()` 已改为合并写入，并在退出前 `flush()`。 | 仍然是整库 export 写回；后续可评估增量持久化或真正的 SQLite 文件型驱动。 |
| R3 | PDF 文本抽取在主进程中顺序解析，大 PDF 可能卡顿 | 部分缓解 | `extractPdfText()` 已在逐页处理间让出事件循环，降低长任务连续阻塞。 | 仍会一次性读取 PDF 并在主进程解析；后续建议 worker/队列化、进度回传、取消能力。 |
| R4 | AI 流式请求缺少显式超时和 SSE 容错 | 部分缓解 | 已加入 120 秒超时、`AbortController`、更宽容的 SSE `data:` 解析和 JSON 解析保护。 | 仍缺少用户侧取消按钮和更细的 provider 错误分类。 |
| R5 | `KeyStore` secrets JSON 损坏会影响配置路径 | 已处理 | `readAll()` 已加入异常保护和结构过滤，损坏时返回空配置并打印错误。 | 可进一步增加损坏文件备份/恢复提示。 |
| R6 | StarDict 每次查词重复打开 `.dict` 文件 | 已处理 | StarDict source 已复用 `.dict` 文件句柄，并在替换/退出时关闭。 | 可继续优化大词典索引内存占用和模糊查询策略。 |
| R7 | 安装/启动文档路径与本机实际路径不一致 | 已处理 | `docs/USER_SETUP_GUIDE.md` 已更新到 `D:\programme\Vscode Projects\Reading_Partner`，并保留 Electron 镜像说明。 | 后续可补充故障排查条目。 |

## 4. 已完成的主要提交

- `db3a584` `Address initial audit risks`：首批主进程鲁棒性和性能风险修复，新增审计报告。
- `cccbff3` `Split inspector panels`：拆出搜索、设置、词汇面板。
- `7bdf01c` `Split notes panel`：拆出笔记面板和批注筛选工具。
- `f4d8957` `Split AI panel`：拆出 AI 面板与 AI 面板类型。
- `5dfe502` `Split annotation overlay`：拆出批注浮层和几何工具。
- `1cb774d` `Extract reader search helpers`：拆出 PDF 搜索高亮和 AI 辅助批注解析。
- `cd34da9` `Extract reader interaction hooks`：拆出拖拽平移和快捷键 hooks。
- `177010a` `Extract shell UI components`：拆出窗口栏、文档库、选区工具条、检查器 tab。
- `8610f22` `Extract reader surface components`：拆出阅读器工具栏和 PDF 阅读表面。
- `2899b5d` `Extract search highlight locator`：拆出搜索结果定位高亮 hook。
- `1ec4d55` `Extract reader viewport reset hook`：拆出阅读器视口重置 hook。
- `Update audit progress and extract reader utilities`：更新本报告的风险处理状态，并迁出读者名、本地 PDF Blob URL、AI 对话标题和 AI 辅助批注清理等纯工具函数。

## 5. 后续优化优先级

1. 继续拆 `App.tsx` 中的业务流程 hooks，优先 AI 会话/流式结果处理、批注 CRUD、词汇本操作。
2. 为大 PDF 索引加入后台队列、取消、进度和错误恢复能力。
3. 评估数据库持久化从“整库 export 写回”改为更细粒度方案。
4. 给 AI 请求增加用户可见的取消入口和 provider 错误分类。
5. 增加关键纯函数单元测试，覆盖 AI 标注解析、搜索定位、批注几何归一化、StarDict 查询。

## 6. 当前开发约束

- 本项目是从用户自己的 GitHub 仓库 clone 下来的，本机路径为 `D:\programme\Vscode Projects\Reading_Partner`。
- 继续开发时应优先保持现有 Electron + React + TypeScript 架构，不引入大规模框架替换。
- 每次行为相关改动后至少运行：

```powershell
npm run typecheck
npm run build
```

- 对 UI 大拆分建议小步提交，避免一次性重排状态流。
