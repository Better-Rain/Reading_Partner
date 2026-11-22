# Mac 私人书库

Windows、Android 和 Apple 客户端通过 HTTPS 打开 Mac 上的同一个书库。Mac 提供页面、PDF 和阅读接口，客户端负责显示页面和 PDF。每台设备先配对，再登录阅读账号。书目和 PDF 在账号间共享。阅读进度、批注、生词、共读和分组分别保存到当前账号。使用外部模型时，Mac 会将该轮请求所需的上下文发送给所选模型服务。

## 连接路径

| 客户端 | 如何连接 |
| --- | --- |
| Windows 云端版 | 打开构建时配置的单个服务器 IPv4 地址。首次配对可通过配置的 SSH 主机读取本设备配对码，之后使用本机加密保存的凭据。 |
| Android | 同时探测配置的候选地址，使用首个通过 TLS 校验并返回健康状态的入口。可以配置局域网、私人网络或 USB 转发地址。 |
| iPhone | 在连接界面选择可达的局域网或私人网络地址。 |
| 服务器上的 macOS 客户端 | 默认使用本机回环。模拟器也可以连接所在 Mac 的回环地址。 |

在外使用时，客户端需要一条到服务器地址的可达路由。在同一局域网时可以使用服务器已监听、且证书覆盖的局域网地址。Android USB 调试可运行 `clients/android/connect-usb.ps1`，由 PC 通过 SSH 把手机的回环连接转发到 Mac。此路径要求 PC 能通过 SSH 连到 Mac。云端书库需要在线连接。独立 Electron 桌面版使用自己的本地数据目录。

## 私有部署配置

从仓库根目录将 `docs/connection.example.json` 复制为 `private-deploy/connection.json`，在本机填写地址、HTTPS 端口和 SSH 主机别名。示例中的服务器 IP 属于文档示例网段。也可以用 `RP_CONNECTION_FILE` 指向私有配置的绝对路径。`androidSerial` 为可选项，连接多台 Android 设备时用于指定调试设备。`androidDevice` 是在服务器上生成配对文件时使用的标签。

将私有配置分别放在需要构建或初始化服务的机器上。构建脚本只向相应客户端写入它需要的连接字段。安装包包含连接地址和公开 CA，供自己的设备分发。Git 忽略私有配置、签名和证书、配对材料、数据库及构建产物。

## 运行与维护

- Windows 下运行 `npm run build` 和 `node server/build.mjs` 构建服务器与页面。将 `out/cloud/service.mjs` 和 `out/cloud/web` 部署到 Mac 的 `~/ReadingPartner/service`。服务器使用 Node 22 和 `server/package-lock.json` 中的依赖。
- 在准备好运行时、依赖、数据及 TLS 目录的 Mac 上，从仓库运行 `python3 server/configure-mac.py` 生成证书和 LaunchAgent。证书首次签发时会包含 `binds` 中的 IP。后来更换 IP 时，应检查证书是否仍覆盖客户端使用的地址。LaunchAgent 在 Mac 用户登录后启动服务。
- 在 `out/cloud/ca.pem` 放置服务器的公开 CA，运行 `clients/windows/build.ps1` 或 `clients/android/build.ps1` 构建客户端。Apple 构建步骤见 `clients/apple/README.md`。
- 首次管理员密码保存在 Mac 的 `~/ReadingPartner/data/owner-initial-password`。登录后的个人主页提供改密和切换账号。要撤销设备，可从服务器的 `data/devices.json` 移除对应条目。
- `data/library.sqlite` 保存共享书目、账号及会话，`data/reading-partner.sqlite` 保存原账号的阅读记录，其他账号的数据位于 `data/profiles/<用户 ID>/`。请备份整个 `data` 和 `tls` 目录。服务端模型地址中的 `127.0.0.1` 指 Mac 本机。
