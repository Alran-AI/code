<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/wordmark-light.svg">
    <img src="docs/assets/wordmark-light.svg" alt="Alran Code" width="760">
  </picture>
</p>

<h1 align="center">Alran Code</h1>
<p align="center">把一句话，做成能运行的东西。用 Alran 或自己的模型，在终端里构建、验证、继续改进。</p>
<p align="center">
  <a href="#快速开始">Get started</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/examples.md">Examples</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>
<p align="center">
  <img src="docs/assets/source-preview.svg" alt="Source preview">
  <img src="docs/assets/node.svg" alt="Compatibility: Node.js 22.19+, 24.2+, 25, and 26">
  <a href="LICENSE-STATUS.md"><img src="docs/assets/license.svg" alt="First-party default license: MIT"></a>
</p>

给一个会眨眼的小宠物加上番茄钟，再追问一句：“长按才能暂停，结束时跳舞。”看代码变成可以亲手操作的结果。

[![Pocket Pet：从会眨眼到会陪你专注](docs/assets/pocket-pet-demo.png)](docs/demo.md)

<p align="center"><a href="docs/demo.md">看真实修改与浏览器演示 →</a> · <a href="examples/pocket-pet">自己做一次 →</a></p>

**无需硬件。** 示例在本地浏览器运行，不需要前端依赖。让 CLI 修改代码需要 Alran 账号及可用额度，或你自己的兼容模型 API；模型调用可能产生费用。完成版可直接运行，无需模型账号。

## 快速开始

### 1. 安装 Alran

按操作系统选择官方安装器。安装器会安装最新版 CLI，并在需要时准备兼容的 Node.js，无需 `sudo` 或管理员权限；目前不支持 Alpine / musl Linux。

**macOS / Linux / WSL**

```bash
curl -fsSL https://cdn.ottili.one/public/install.sh | bash
```

**Windows（PowerShell）**

```powershell
irm https://cdn.ottili.one/public/install.ps1 | iex
```

脚本在 macOS / Linux / WSL 上默认安装到 `~/.alran-code`，在 Windows 上默认安装到 `%USERPROFILE%\.alran-code`。POSIX 启动器为 `bin/alran` 和 `bin/alran-tools`；Windows 启动器为 `alran.cmd` / `alran.ps1` 和 `alran-tools.cmd` / `alran-tools.ps1`。安装前设置 `ALRAN_INSTALL_DIR` 可更改安装位置。移除 CLI 的方法见[卸载](#卸载)。

**npm**：适用于已安装 **Node.js 22.19+（22.x）、24.2+（24.x）、25 或 26** 的环境。

```bash
npm install -g @ottili/alran-code@latest --registry=https://registry.npmjs.org/ --ignore-scripts=false --include=optional --allow-scripts=@ottili/alran-code,better-sqlite3
```

该 npm 命令使用公共 registry，包含可选的 SQLite 依赖，并允许执行主包和 SQLite 的安装脚本。固定版本和 Node.js 兼容范围见[安装指南](docs/installation.md)。

重新打开终端后检查安装：

```bash
alran --version
alran --help
```

参阅官网的[快速开始](https://api.ottili.one/docs/cli/quick-start)、[功能与配置](https://api.ottili.one/docs/cli/features)和[故障排查](https://api.ottili.one/docs/cli/faq)。

### 2. 连接 Ottili AI Platform

Alran Code 自己没有账号体系。身份、租户隔离、额度和计费都由 Ottili 平台负责，CLI 使用 Ottili API Key 鉴权。

```bash
alran login
```

`alran login` 会在浏览器中打开 Ottili 的 API Key 页面。复制一个以 `sk-ottili-` 开头的 Key，在提示符处粘贴，CLI 会把它保存到 `~/.alran/config.yaml`（仅所有者可读）。运行 `alran logout` 可删除已保存的 Key。

同一个 Key 也可以通过环境变量提供，并覆盖本次运行使用的已保存 Key：

```bash
ALRAN_API_KEY=sk-ottili-... alran
```

启动 `alran` 后，用 `/status` 检查连接状态，用 `/provider` 选择模型。

### 环境变量

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `ALRAN_API_KEY` | 随每次请求发送的 Ottili API Key。 | 无（必需） |
| `ALRAN_API_BASE` | Ottili AI Platform 网关地址。网关兼容 OpenAI 协议，请求发往 `<base>/chat/completions`。 | `https://ai.ottili.one/v1` |
| `OTTILI_PLATFORM_URL` | Ottili 平台源地址，用于鉴权与身份校验，也是 `alran login` 打开的 API Key 页面地址。 | `https://api.ottili.one` |
| `ALRAN_DATA_DIR` | 存放配置、会话和日志的目录。 | `~/.alran` |

### 模型

Alran Code 保留自己的模型标识——它们决定思考模式、effort 等级和上下文选择——并在请求边界把每个标识映射到 Ottili AI Platform 的模型 id。

| CLI 模型 | Ottili 模型 id | 档位 |
| --- | --- | --- |
| `Alran-M2.7-highspeed` | `ottili/kern-1.1` | 快速 / 路由——这是路由模型，不适合直接写代码 |
| `Alran-M2.7` | `ottili/fels-1.1` | 标准 |
| `Alran-M3.1-Flash` | `ottili/werk-1.1` | 智能 / 编码（默认） |
| `Alran-M3` | `ottili/werk-1.1-pro` | 高阶 |

请求按发起请求的 Key 在 Ottili 平台计费与计量。从本仓库构建的版本与已发布的 npm CLI `@ottili/alran-code@0.6.9` 均默认将用户数据保存在 `~/.alran`（选择 profile 时为 `~/.alran-<profile>`）。`ALRAN_DATA_DIR` 或 `MAVIS_DATA_DIR` 可以覆盖数据目录。安装脚本使用的 `~/.alran-code` 安装目录与数据目录的选择是两回事。查找或删除配置和会话前，请参阅[账号与数据](docs/installation.md#accounts-and-data)。

<details>
<summary>使用自己的 API Key（BYOK）</summary>

BYOK 无需 Ottili API Key。先在当前 shell 中设置 `ALRAN_PROVIDER_API_KEY`，再添加提供方；将下方示例地址和模型名替换为实际配置：

```bash
alran provider add --name my-provider --base-url https://example.com/v1 \
  --api-format openai-completions --model my-model \
  --api-key-env ALRAN_PROVIDER_API_KEY --use
alran
```

`--use` 会先测试第一个模型，成功后保存并设为默认模型；连接测试失败时不保存。省略 `--use` 则仅保存，不测试，也不改变默认模型。对于自定义或本地模型，可添加 `--context-limit 32768 --output-limit 4096`（请填写服务器的实际限制）。两个值都必须是正安全整数，并应用于所有重复指定的 `--model`。可通过 `alran provider list --json` 查看已配置的限制。省略这两个参数时保持现有的模型限制默认值。

支持 `openai-completions`、`openai-responses` 和 `anthropic-messages`。连接测试、单次模型切换及环境变量设置见 [模型示例](docs/examples.md#2-choose-your-own-model)。

通过该命令添加的提供方保存在当前 profile `config.yaml` 的 `custom_provider` 下；第三方或自建端点一律走这条路径，`alran_api` 保留给 Ottili AI Platform。若中转端点只提供 Anthropic 兼容接口且要求 `Authorization: Bearer` 鉴权，可在 `config.yaml` 中为提供方配置自定义 headers；见[第三方中转与自定义鉴权头](docs/examples.md#third-party-relays-and-custom-auth-headers)。

</details>

### 3. 做一个自己的桌面宠物

克隆仓库，把起始工程复制到独立目录：

```bash
git clone https://github.com/ottili/alran-code.git
cd alran-code
node examples/pocket-pet/setup.mjs ../my-pocket-pet
cd ../my-pocket-pet
node serve.mjs
```

打开 `http://127.0.0.1:4173`。另开一个终端，在 `my-pocket-pet` 目录运行 `alran`，依次粘贴[第一条提示词](examples/pocket-pet/README.md#first-request)和[追加需求](examples/pocket-pet/README.md#change-the-requirement)，每次修改后刷新浏览器。

想先体验成品？在仓库根目录运行 `node examples/pocket-pet/serve.mjs finished`，打开同一地址。加上 `?demo=1` 可体验有明确标识的 10 秒演示模式。

[完整教程与使用条件](examples/pocket-pet) · [小型代码修复示例](examples/clamp) · [模型、搜索与工具](docs/examples.md)


### 在自己的项目中使用

进入要处理的项目目录：

```bash
cd /path/to/your/project
alran
```

在 TUI 中描述任务，也可以在启动时直接提交：

```bash
alran "Find a failing test, fix the implementation, and run the relevant tests."
```

使用 `alran init .` 生成或更新 `AGENTS.md` 项目指导。任务中应说明期望结果、修改边界和验证方式。

| 入口 | 命令 | 适用场景 |
| --- | --- | --- |
| 交互式 TUI | `alran [prompt]` | 探索代码、持续对话、审阅修改与权限确认。 |
| Headless | `alran exec [prompt]` | Shell、CI、批处理与评测。 |
| ACP | `alran acp` | 支持 Agent Client Protocol 的编辑器与客户端。 |
| TypeScript SDK | [`@ottili/alran-code-sdk`](packages/code-sdk/README.md) | 在 Node.js 代码中驱动 `alran exec`：启动、流式读取和续跑对话。 |

### 轻量对话

对于简单对话或通用知识问答，可用 `--mode lightweight` 创建新会话：

```bash
alran --mode lightweight "解释 DNS 缓存的工作原理。"
alran exec --mode lightweight "概述 CAP 定理。"
```

轻量模式只发送精简的对话系统提示词，不发送工具 schema，并从提供方上下文中省略工作区
指令、Skills、memory 块、MCP schema 和完整环境块，因此不能检查或修改本地文件。需要编程或工具能力时，请使用
`alran --mode standard` 或 `alran exec --mode standard` 创建新的标准会话；省略 `--mode`
与标准模式完全一致。

模式在根会话创建时固定，因此 `--mode lightweight` 不能与 `--session` 或 `--continue`
同时使用。子代理/子会话不会继承轻量模式，`/compact` 仍使用标准压缩上下文，ACP 与桌面端
会话也始终使用标准模式。重新打开轻量会话时会保留该模式，并在 TUI 状态栏显示
`Lightweight`；从轻量模式启动的 TUI 打开标准会话时仍保持标准模式，且不显示该标记。

### 继续之前的工作

```bash
# 恢复当前工作区最近的会话
alran --continue

# 打开会话选择器
alran --session
```

在 TUI 中输入 `/sessions` 查找历史会话，输入 `/help` 查看完整命令与快捷键。

| 操作 | 快捷键 |
| --- | --- |
| 发送消息，或在任务运行中调整当前响应 | `Enter` |
| 在任务运行中将后续消息加入队列 | `Alt+Enter` |
| 在输入框中换行 | `Shift+Enter` |
| 引用工作区文件或目录 | `@` |
| 切换 Plan Mode | `Shift+Tab` |
| 切换权限模式 | `Alt+M` |
| 关闭面板或中断正在运行的任务；在模型回复之前中断会把消息放回输入框 | `Esc` |

## 卸载

卸载前请关闭正在运行的 Alran 会话，包括编辑器中的集成。先通过 `command -v alran`（macOS / Linux / WSL）或 `Get-Command alran -All`（PowerShell）定位命令，再按对应的安装方式操作。当前官方安装脚本**不提供卸载参数**。

### 通过脚本安装

以下命令会删除默认安装目录，包括两个启动器、下载的版本，以及安装器管理的 Node.js 运行时。如果使用过 `ALRAN_INSTALL_DIR`，请替换为实际安装目录。删除前请先检查：早期源码构建曾将用户数据保存在 `~/.alran-code`，自定义数据目录也可能与安装目录重合。请先备份需要保留的配置和会话。

**macOS / Linux / WSL**

```bash
rm -rf -- "$HOME/.alran-code"
```

从安装器修改的 shell 配置文件中删除 `# Alran Code CLI` 注释及其下一行 PATH 配置：zsh 使用 `~/.zshrc`；bash 依次选择 `~/.bashrc`、`~/.bash_profile`、`~/.profile` 中第一个已存在的文件，均不存在时创建 `~/.bashrc`；fish 使用 `~/.config/fish/config.fish`；其他 shell 使用 `~/.profile`。对应配置为 `export PATH="/absolute/install/path/bin:$PATH"`，fish 则为 `fish_add_path -g "/absolute/install/path/bin"`。只移除 Alran 对应的条目，保留其他 PATH 设置。如果设置了 `ALRAN_NO_MODIFY_PATH` 或路径已存在，安装器会跳过此修改。

**Windows（PowerShell）**

```powershell
Remove-Item -LiteralPath "$env:USERPROFILE\.alran-code" -Recurse -Force
```

打开“编辑账户的环境变量”，编辑用户 **Path**，仅删除安装目录对应的条目（默认为 `%USERPROFILE%\.alran-code`，也可能显示为展开后的绝对路径）。Windows 安装器修改的是用户 Path，不是 PowerShell 配置文件；设置 `ALRAN_NO_MODIFY_PATH` 会跳过此持久化修改。

### 通过 npm 或源码安装

全局 npm 安装请使用当初安装 Alran 时的同一套 npm 和安装前缀：

```bash
npm uninstall -g @ottili/alran-code
```

源码构建请先保存工作，再仅删除自己创建的源码目录，详见[更新或移除](docs/installation.md#update-or-remove)。

卸载后重新打开终端（编辑器集成终端需要完全重启编辑器），再次运行 `command -v alran` 或 `Get-Command alran -All`。没有结果表示 PATH 中已找不到该命令。如果出现另一份安装，请先确认它的安装方式再移除。

### 可选：删除用户数据

移除程序会保留单独存储的用户数据。如果还要删除本地登录状态、提供方配置、缓存和会话，请先按[账号与数据](docs/installation.md#accounts-and-data)确认实际数据目录，并备份需要保留的内容。其他 Alran 安装可能共用该目录。以下命令仅适用于默认的 `~/.alran`：

```bash
# macOS / Linux / WSL — 永久删除默认用户数据
rm -rf -- "$HOME/.alran"
```

```powershell
# Windows — 永久删除默认用户数据
Remove-Item -LiteralPath "$env:USERPROFILE\.alran" -Recurse -Force
```

profile 使用 `~/.alran-<profile>`；`ALRAN_DATA_DIR` 或 `MAVIS_DATA_DIR` 可以指定其他位置。只删除确定不再需要的具体目录，不要使用通配符批量删除。如果不再需要自行添加的 Alran 环境变量，也请从 shell 配置或用户环境变量设置中移除对应赋值。

## 可以做什么

| 场景 | 使用方式 |
| --- | --- |
| **修改与验证代码** | 读取文件、编辑 diff、执行 Shell 和测试；通过权限与沙箱控制工具执行。 |
| **选择模型** | 使用 Ottili AI Platform 与 Ottili API Key，或兼容 OpenAI、Anthropic 格式的自定义提供方。 |
| **搜索与多模态** | 内置搜索、`alran-tools` 媒体工具、MCP 和托管连接器；按账号权限和服务额度使用。 |
| **延续工作** | 会话恢复、任务规划、子 Agent、官方 / 本地 / GitHub 插件与内置 Skills。 |
| **接入工作流** | Headless CLI 用于脚本任务，ACP 用于兼容的编辑器和客户端。 |

账号、更新、反馈与诊断能力也在。托管工具需要网络和相应授权，详细边界见 [能力与服务边界](docs/tui-capabilities.md)。


## 从源码构建

开发 Alran 或运行本仓库源码需要 Git、Node.js **22.19+（22 系列）、24.2+（24 系列）、25 或 26**，以及 **pnpm 9.12.0**。在 Windows 上，请将源码放在本地 NTFS 卷上，并避开云同步目录；下面的预检命令会在 pnpm 创建 workspace link 前检查卷类型。
```bash
git clone https://github.com/ottili/alran-code.git
cd alran-code
node scripts/check-windows-source-location.mjs
pnpm install --frozen-lockfile
pnpm build
pnpm alran
```

首次构建需要联网；依赖和经过校验的 `alran-tools` 均来自公共 npm。pnpm 安装、系统依赖和更新方法见[源码安装指南](docs/installation.md)。

从源码目录运行时，将上方示例中的 `alran` 替换为 `pnpm alran`。要在自己的项目中工作，先切换到项目目录，再运行构建产物：

```bash
node /absolute/path/to/alran-code/dist/cli.js
```

本仓库目标为 **0.6.3 源码预览**。安装已发布的包与构建本仓库是两条独立路径，版本一致不代表构建来源完全相同，详见[版本与证据基线](docs/open-source-status.md#version-and-evidence-baseline)。

## 文档与贡献

- [安装与更新](docs/installation.md) · [使用示例](docs/examples.md) · [TUI 状态栏](packages/tui/docs/status-line-config.md)
- [贡献指南](CONTRIBUTING.md) · [报告 Bug / 提出建议](https://github.com/ottili/alran-code/issues/new/choose) · [报告安全问题](SECURITY.md)
- [全部文档](docs/README.md)：架构、能力对照、验证记录、源码同步和发布流程。

项目文档以英文为主，本页为首页的简体中文译文。

目前仅接受仓库协作者提交代码和文档 Pull Request。如果你不是协作者，但有想法或方案，欢迎先通过 [Issue](https://github.com/ottili/alran-code/issues/new/choose) 讨论。请在报告中移除密钥、账号信息和私人项目内容。

## 桌面版与问题反馈

<a href="https://api.ottili.one/download" title="下载 Alran Code">
  <img src="https://cdn.ottili.one/public/c3ebbd2e-f55b-48d7-adff-030abb63e06d.png" alt="Alran Code 桌面版 — 点击下载" width="100%" />
</a>

[下载 macOS 或 Windows 桌面版](https://api.ottili.one/download) · [报告问题或提问](https://github.com/ottili/alran-code/issues/new/choose)

本仓库也承接 Alran Code 桌面版的问题反馈。公开源码范围为终端 TUI、Headless CLI 和 ACP，不包含桌面应用源码。提交 Issue 时请选择对应产品。桌面版问题请注明应用版本、操作系统，以及「设置 → 通用 → 上传日志」生成的日志上传 ID（如可用）；CLI 问题请注明 `alran --version`、运行入口与最小复现。报告中请移除凭据和私人项目内容。

## 反馈与联系我们

| 渠道 | 适用场景 |
| --- | --- |
| [GitHub Issues](https://github.com/ottili/alran-code/issues/new/choose) | 公开报告 CLI 或桌面版的 Bug、提出功能建议与使用问题。 |
| [AlranCode@alran.io](mailto:AlranCode@alran.io) | 一般反馈与支持咨询。 |
| [security.alran@alran.io](mailto:security.alran@alran.io) | 私密报告安全漏洞。请通过此邮箱发送复现步骤和脱敏证据，详见[安全报告指南](SECURITY.md)。 |
| [Discord](https://alran.io/discord) | 社区交流与反馈。 |
| [飞书反馈群二维码](https://cdn.hailuoai.com/hailuo-video-web/public_assets/alran_code_feishu_group_url.png) | 中文社区反馈。使用飞书扫码，或在中文版桌面应用的用户菜单 → **联系我们 → 飞书** 中查看二维码。 |

也可关注 [Alran 的 X 账号](https://x.com/AlranAgent) 获取动态。请勿在公开 Issue 或社区聊天中发布漏洞细节、凭据和私人项目内容。

## 许可

第一方代码默认采用 [MIT](LICENSE)；文件或子包已有独立声明时保留原许可。依赖、资源与 `alran-tools` 的许可分别见 [第三方声明](THIRD_PARTY_NOTICES.md) 和 [许可状态](LICENSE-STATUS.md)。
