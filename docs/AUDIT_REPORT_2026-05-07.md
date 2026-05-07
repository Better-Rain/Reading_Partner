# Reading Partner 审计报告

日期：2026-05-07  
范围：仅审计，不修改业务代码

## 1. 执行结论

仓库当前处于可开发、可构建状态。依赖已成功安装，`typecheck` 与生产构建均通过。项目的主要风险不在“能不能跑”，而在“后续改动是否容易失控”以及“面对大文件和长时间 AI 请求时是否足够稳”。

## 2. 环境搭建与验证

本机环境：

- Windows PowerShell 5.1
- Node.js v24.14.1
- npm 11.11.0

安装方式：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm ci --no-audit --no-fund
```

说明：首次直接安装耗时过久，改用 Electron 镜像后成功完成。

验证结果：

```powershell
npm run typecheck
npm run build
```

两项均通过。

## 3. 主要风险

### 高风险

1. 前端主文件过大，职责过度集中。`src/renderer/src/App.tsx` 约 3743 行，包含 PDF、选择、批注、AI、词典、设置、会话等大量状态和交互逻辑。这个结构会让新功能的回归概率持续升高，也会让调试和测试成本偏高。参考：[App.tsx](<D:\programme\Vscode Projects\Reading_Partner\src\renderer\src\App.tsx:1200>)

### 中风险

2. 主进程持久化是同步整库写回。`ReadingPartnerDatabase.persist()` 直接 `writeFileSync(this.databasePath, this.db.export())`，而很多写操作都会立刻触发它。数据量一大，主进程会被阻塞，窗口响应和 AI/导入流程都可能受影响。参考：[database.ts](<D:\programme\Vscode Projects\Reading_Partner\src\main\database.ts:1545>)

3. PDF 文本抽取在主进程一次性读入并逐页解析。`extractPdfText()` 先把整份 PDF 读进内存，再调用 PDF.js 顺序解析每页。这对大 PDF 或低内存机器不够友好，也会放大首次索引时的等待感。参考：[pdfText.ts](<D:\programme\Vscode Projects\Reading_Partner\src\main\pdfText.ts:120>)

4. AI 请求链路缺少显式超时、取消和更稳健的 SSE 容错。`runOpenAICompatibleCompletion()` 直接 `fetch()` 流式接口，随后对每个 `data:` 行直接 `JSON.parse()`。如果提供方返回异常片段、空行、非 JSON 事件，或者请求长时间挂起，错误表现会比较脆。参考：[ai.ts](<D:\programme\Vscode Projects\Reading_Partner\src\main\ai.ts:185>)

5. `KeyStore` 读取 secrets 文件没有异常保护。`readAll()` 直接 `JSON.parse(readFileSync(...))`，一旦 `secrets.json` 损坏或被手工编辑，相关配置路径会直接抛错，最差会影响启动或 provider 操作。参考：[keyStore.ts](<D:\programme\Vscode Projects\Reading_Partner\src\main\keyStore.ts:84>)

### 低风险

6. StarDict 查词路径对大词典的 I/O 成本偏高。当前实现把 `.idx` 全量读入内存，但每次命中都要重新打开 `.dict` 文件并顺序读取内容。对小词典问题不大，对高频查询和超大词库会有明显优化空间。参考：[stardict.ts](<D:\programme\Vscode Projects\Reading_Partner\src\main\stardict.ts:121>)

7. 文档存在环境路径不一致。`docs/USER_SETUP_GUIDE.md` 里的示例路径是 `C:\Code\Vscode Projects\Reading_Partner`，和这台机器上的实际路径 `D:\programme\Vscode Projects\Reading_Partner` 不一致。对新接手的人会造成一次无谓的排错。参考：[USER_SETUP_GUIDE.md](<D:\programme\Vscode Projects\Reading_Partner\docs\USER_SETUP_GUIDE.md:1>)

## 4. 可优化方向

1. 拆分 `App.tsx`。建议按“阅读器容器 / 批注面板 / AI 面板 / 词典面板 / 设置面板”继续拆组件和自定义 hooks，把状态归位，降低单文件复杂度。
2. 给 AI 请求加超时、可取消信号和更严格的 SSE 解析。至少要对异常 `data:` 行、空 payload、JSON 解析失败做容错。
3. 把 SQLite 持久化从“每次写都整库落盘”改成更细粒度或批量化策略。若短期不改底层存储，也应把写入频率和 UI 交互解耦。
4. 为大 PDF 索引增加更明确的后台化/排队策略，避免首次打开大文档时主进程卡顿。
5. 给 `KeyStore` 的文件读取增加容错和自愈逻辑，避免 secrets 文件损坏导致整条配置路径失效。
6. 优化 StarDict 访问方式，减少每次查询的文件打开成本。
7. 统一安装和启动文档，补齐 Windows 下的真实路径、镜像设置和常见失败说明。

## 5. 备注

- 本次仅做审计与环境验证，没有修改业务代码。
- 当前仓库的构建链路已验证可用，后续开发可以直接在此基础上继续。
