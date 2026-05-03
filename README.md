# Reading Partner

Reading Partner 是一个面向大部头 PDF 文献和英文原著的本地优先桌面阅读工具。它的目标不是做一个普通 PDF 查看器，而是把阅读、划线、批注、书签、词汇、文档搜索和 AI 共读放在同一个工作流里，尽量接近“可以一起读书的研究伙伴”。

当前项目使用 Electron、React、TypeScript、PDF.js 和本地 SQLite 构建。PDF 文件、批注、书签、笔记、词汇、文本索引和 AI 对话记录都保存在本机；AI 请求通过 OpenAI-compatible Provider 接入，优先考虑国内更容易使用、成本较低的服务。

## 已实现功能

- 本地 PDF 导入、打开、阅读、翻页、缩放和拖动。
- 视觉高亮、批注、书签，并保存到本地数据库。
- 批注/高亮位置与 PDF 原文绑定，缩放后仍能跟随定位。
- 批注/高亮悬浮预览，右侧笔记列表可折叠、跳转、删除、编辑内容和颜色。
- 固定荧光笔色板：黄、绿、蓝、粉、紫。
- 阅读快捷键：`H` 高亮选区，`N` 打开批注输入，`D` 切换拖动模式。
- 本地文档文本索引、搜索和跳转。
- 第一版文档问答和可持续上下文的 AI 共读对话。
- AI 对话草稿态：新建对话只有发送第一条消息后才保存，并自动按首条消息生成标题；用户也可以手动改名。
- 本地词汇本、选区加生词、ECDICT/StarDict 词典导入和本地查词。
- 自定义无边框窗口标题栏，包含最小化、最大化/还原和关闭按钮。

## 本地运行

环境要求：

- Node.js 22+
- npm 10+
- Git for Windows

安装依赖并启动开发版：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
npm run dev
```

常用检查：

```powershell
npm run typecheck
npm run lint
npm run build
```

如果 Electron 下载较慢，保留上面的 `ELECTRON_MIRROR` 环境变量即可。项目的 `.npmrc` 已设置 `omit=optional`，用于减少 Windows 上可选原生依赖带来的安装阻塞。

## AI Provider 与 API Key

应用支持 OpenAI-compatible 接口，当前重点适配 DeepSeek 等国内更容易使用的服务。API Key 通过 Electron 主进程保存，并使用 `safeStorage` 加密；密钥不会写入源码文件。

仓库的 `.gitignore` 已排除 `.env`、`.env.*`、`*.db`、`*.sqlite`、`*.sqlite3`、日志和构建产物。不要手动把 API Key 写进 README、源码、计划文档或其他会被 git 跟踪的文件。

## 项目文档

- [架构说明](docs/ARCHITECTURE.md)
- [开发路线图](docs/ROADMAP.md)
- [AI Provider 策略](docs/AI_PROVIDER_STRATEGY.md)
- [数据模型](docs/DATA_MODEL.md)
- [用户配置指南](docs/USER_SETUP_GUIDE.md)

## 数据与隐私

- PDF 文件路径、阅读记录、批注、词汇、AI 对话和索引数据默认存储在本机。
- 文档问答不会默认把整本书发送给模型，而是先从本地文本索引中检索相关片段。
- API Key 只应通过应用配置界面保存，不应提交到 GitHub。
