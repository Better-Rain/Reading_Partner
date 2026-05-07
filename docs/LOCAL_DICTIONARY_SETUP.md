# 本地词典配置

当前已验证可用词典：

- 名称：ECDICT / 简明英汉字典增强版
- 格式：StarDict
- 本机路径：`D:\Books\Dictionaries\ECDICT-StarDict\stardict-ecdict-2.4.2\stardict-ecdict-2.4.2.ifo`
- 词条数：3,402,564
- 来源：`https://github.com/skywind3000/ECDICT/releases/tag/1.0.28`
- 文件：`ecdict-stardict-28.zip`

## 导入方式

1. 启动 Reading Partner。
2. 打开右侧“词汇”面板。
3. 点击“导入词典”。
4. 选择：

```text
D:\Books\Dictionaries\ECDICT-StarDict\stardict-ecdict-2.4.2\stardict-ecdict-2.4.2.ifo
```

也可以选择同目录下的 `.idx` 或 `.dict` 文件，应用会自动解析到对应的 `.ifo` 文件。

## 已验证查询

本机已用项目同等 StarDict 读取逻辑验证以下单词可查：

- `test`
- `reading`
- `revolution`
- `muckraking`

## 重新下载

如需重新下载，优先使用官方 release：

```powershell
New-Item -ItemType Directory -Force -Path "D:\Books\Dictionaries\ECDICT-StarDict"
Invoke-WebRequest `
  -Uri "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-stardict-28.zip" `
  -OutFile "D:\Books\Dictionaries\ECDICT-StarDict\ecdict-stardict-28.zip" `
  -UserAgent "Mozilla/5.0"
Expand-Archive `
  -LiteralPath "D:\Books\Dictionaries\ECDICT-StarDict\ecdict-stardict-28.zip" `
  -DestinationPath "D:\Books\Dictionaries\ECDICT-StarDict" `
  -Force
```

如果 GitHub 直连较慢，可使用可访问的 GitHub 代理下载同一 URL。下载完成后的 zip 大小应约为 `70,415,834` 字节。
