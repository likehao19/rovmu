# Muse Local 开发文档

| 项 | 内容 |
|---|---|
| 文档版本 | v0.2 |
| 日期 | 2026-10-30 |
| 目标平台 | Windows 11（首发），macOS / Linux 后续 |
| 一句话定义 | 在用户本机起一台没有图形桌面的 Linux 电脑，交给 AI 自主操作，用户按需观看某个应用窗口并随时接管 |

---

## 0. 文档目的与范围

本文档是 Muse Local 从零到第一个可用版本的工程实施说明。它回答四个问题：

1. 系统由哪些部分组成，边界与信任模型在哪里；
2. 每个模块负责什么，模块之间用什么接口通信；
3. 第一版（v1.0）做到什么程度，不做什么；
4. 如何排期、测试、打包、发布。

**v0.2 的修订范围。** v0.1 是按「多台电脑 + 完整桌面环境」写的。对照真实产品行为之后，有三处前提变了，全文据此重写：

- **单机**：只有一台电脑，软件启动时创建，所有对话共用；
- **无桌面**：Guest 不装桌面环境，没有壁纸、图标、桌面文件夹，用户看不到「电脑桌面」；
- **按窗口转播**：画面只转播 AI 正在操作的那一个应用窗口，不是整屏桌面；命令执行以文本回传。

本文档**不包含**：云端 Agent 持续运行、多租户、计费、模型微调。

---

## 1. 产品定义

### 1.1 定位

给 AI 一台属于它自己的电脑。用户装好桌面软件后，软件在本机创建**一台** Linux 电脑，AI 在这台电脑里拥有文件系统、真实浏览器和终端，可以自主完成「打开网页查资料并整理成表格」这类任务。用户按需把某个应用窗口的实时画面调出来看，必要时接管那个窗口自己操作。

### 1.2 能力范围

| 能力 | v1.0 | 说明 |
|---|---|---|
| 一台本地 Linux 电脑 | 支持 | 软件启动时自动创建，不是用户手动建 |
| 所有对话共用这台电脑 | 支持 | 任务排队执行，见 §5.5 |
| AI 操作真实浏览器 | 支持 | Chromium，Playwright + CDP 驱动 |
| AI 执行 Shell / Python | 支持 | 输出以文本回传，不占用画面 |
| 无图形桌面 | 设计如此 | 用户看不到桌面，只看得到窗口 |
| 按窗口转播画面 | 支持 | 窗口枚举 + 单窗口抓取，见 §5.7 |
| 按需订阅画面 | 支持 | 没人看的时候不推流 |
| 人工接管窗口 | 支持 | 看画面与发输入是两条通道 |
| 画面折叠 / 拖动调宽 / 放大 | 支持 | 见 §5.8 |
| 电脑信息 | 支持 | 已装软件、已连接服务清单 |
| 任务与文件持久化 | 支持 | SQLite + 虚拟磁盘 |
| 快照与恢复 | 支持 | 冷快照；热快照列为 v1.1 |
| 多台电脑 | 不支持 | v1 明确不做 |
| 定时 / 循环任务 | 部分 | 仅软件运行期间 |
| 软件关闭后 AI 继续跑 | 不支持 | 需常驻服务，见 §13 |
| 与云端产品同等级安全 | 不支持 | 本地隔离强度不同，见 §9 |

### 1.3 明确不做（v1）

- 不做多台电脑、电脑列表、跨机迁移；
- 不做账号体系与云端同步；
- 不做虚拟化引擎自研，直接驱动 QEMU；
- 不做 Guest 内的多用户隔离；
- 不做跨宿主机的镜像兼容层（x86_64 与 ARM64 镜像分别制作）。

### 1.4 术语表

| 术语 | 含义 |
|---|---|
| Host | 用户的本机，运行 Tauri 客户端与 Rust 本地服务 |
| Guest | 虚拟机内运行的系统（Ubuntu，无桌面） |
| Computer | 那台 AI 电脑 = 一个 Guest 实例 + 一份数据盘 |
| Conversation | 一次对话，用户可见的会话单位 |
| Task | 用户在一次对话里发起的任务，包含多个 Turn |
| Turn | 一次「模型思考 → 工具调用 → 结果回灌」的循环 |
| Window | Guest 里的一个应用窗口，画面转播的最小单位 |
| Takeover | 用户接管窗口输入，AI 暂停操作该窗口 |

---

## 2. 架构总览

### 2.1 分层

```
┌───────────────────────────────────────────────────────────────┐
│  Tauri 2 桌面客户端 (WebView)                                  │
│  对话 · 模型配置 · 窗口画面 · 任务中心 · 电脑信息               │
│  技术：Vue 3 + TypeScript + Vite                               │
└───────────────▲───────────────────────────────────────────────┘
                │  Tauri IPC (command / event)
┌───────────────┴───────────────────────────────────────────────┐
│  Rust 本地服务 (Tauri 主进程内的 tokio runtime)                │
│                                                               │
│   Session Manager      对话 → 任务，共用一台电脑，串行调度      │
│   ComputerProvider     创建/启动/暂停/快照/销毁（单实例）       │
│   Window Broker        窗口枚举、画面订阅、输入通道、占用仲裁    │
│   Model Gateway        供应商适配 + 工具协议                    │
│   Task Scheduler       队列、重试、恢复、事件日志                │
│   Security Controller  权限、审批、密钥、网络策略                │
│   Store (SQLite)       元数据持久化                             │
└───────────────▲───────────────────────────────────────────────┘
                │  QMP (named pipe) · QGA (virtio-serial)
                │  Agent HTTP/WS (hostfwd → 127.0.0.1)
                │  窗口画面：WS 订阅，按需推流
┌───────────────┴───────────────────────────────────────────────┐
│  本地 Ubuntu 电脑（无图形桌面）                                 │
│   muse-agentd   工具服务（HTTP + WS，仅监听内网）               │
│   Chromium      真实浏览器                                     │
│   Xvfb          虚拟显示，浏览器窗口画在这上面                   │
│   窗口抓取器     单窗口截图 + 输入注入                          │
│   Python / Node / Bun / ffmpeg / Git（清单见附录 C）            │
│   qemu-guest-agent                                             │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策

**D1：单机。** 只有一台电脑，软件启动时创建，所有对话共用。这是产品语义，不是实现限制：用户面对的是「我的那台电脑」，不是一堆机器。数据结构保留扩展空间，但 v1 的 UI 与调度不做多机。

**D2：无图形桌面。** Guest 不装桌面环境。用户看不到壁纸、图标、桌面文件夹，也没有 `~/Desktop`。需要图形界面的应用（浏览器）跑在虚拟显示上，**不把整屏投给用户**。

**D3：画面按窗口转播。** 转播的最小单位是一个应用窗口。前端拿到的是「某个窗口的像素 + 它的标题 + 它的边界」，而不是一块桌面。没有窗口打开时，界面里就没有画面可看。

**D4：命令执行走文本，不走画面。** AI 用终端干活，输出以文本回传并渲染成终端块。只有需要图形界面的操作才产生画面。这既省带宽，也让日志可检索。

**D5：画面按需订阅。** 没有观看者时不推流、不做编码。用户点开画面才开始推，折叠或切走就停。这顺带解决了持续编码的 CPU 开销。

**D6：控制面与数据面分离。** 模型调用全部发生在宿主侧，API Key 永不进入 Guest；Guest 里的 agentd 只执行工具并回传结果。

**D7：VM 管理器在宿主，Agent 执行器在 Guest。** Agent 在 Guest 里执行危险命令只破坏 Guest，拿不到宿主控制权。两者跨信任边界，只通过 QMP、QGA、受控 HTTP 三个窄接口通信。

**D8：外部可执行程序作为 Tauri Sidecar。** 用户不需要手动装 QEMU；但虚拟化平台功能仍需要一次管理员提权开启。

---

## 3. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | Tauri 2 | 体积小、Rust 后端适合同进程管虚拟机、官方 Sidecar |
| 前端 | Vue 3 + TS + Vite | 上手快，配合画面缩放与拖拽布局简单 |
| 本地服务 | Rust 2021 + tokio + axum | 与 Tauri 同进程，共享状态零拷贝 |
| 虚拟机引擎 | QEMU（x86_64） | 跨平台一致、qcow2 快照成熟、可脚本化 |
| 加速后端 | Windows: WHPX；macOS: HVF；Linux: KVM | 统一抽象成 `Accel`，无硬件加速时降级 TCG |
| Guest OS | Ubuntu 24.04 LTS minimal | 稳定、包全、无桌面 |
| 虚拟显示 | Xvfb | 让 Chromium 有地方画窗口，无需真实桌面 |
| 浏览器自动化 | Playwright + CDP | DOM 操作准确；CDP 还能直接出内容级截图 |
| 窗口画面 | X11 窗口枚举 + 单窗口抓取 | 用户要看到的是「浏览器窗口」，含标签栏和地址栏 |
| 输入注入 | XTEST / xdotool | 与真实鼠标键盘等价，应用无法区分 |
| 画面传输 | WS 推 JPEG 帧（v1）；WebRTC（v1.2） | 帧率要求不高，先做简单可靠的 |
| 持久化 | SQLite（sqlx） | 免部署、事务可靠 |
| 镜像分发 | OCI registry 或对象存储 | 支持分块续传 |

> 窗口画面的两条路要分清：**内容级**用 CDP 的 `Page.captureScreenshot`，快、清晰、能按元素裁剪，但拿不到浏览器外壳；**窗口级**用 Xvfb + X11 抓取，看到的是完整窗口，代价是要维护一个虚拟显示。AI 自己看用内容级就够，给用户看建议窗口级。两者都要实现。

---

## 4. 仓库结构

```
muse-local/
├── apps/
│   └── desktop/                  # Tauri 客户端
│       ├── src/                  # Vue 3 前端
│       │   ├── views/            # Chat / Tasks / Settings
│       │   ├── components/       # 时间线、审批卡片、窗口画面
│       │   └── api/              # Tauri invoke 封装 + 事件订阅
│       └── src-tauri/
│           ├── src/main.rs
│           └── binaries/         # sidecar 产物（qemu 等）
├── crates/
│   ├── session/                  # 对话与任务调度（§5.5）
│   ├── computer/
│   │   ├── computer-core/        # ComputerProvider trait + 领域模型
│   │   ├── computer-qemu/        # QEMU 实现（QMP/QGA 客户端）
│   │   └── computer-fake/        # 测试用假实现
│   ├── window-broker/            # 窗口枚举、画面订阅、输入注入
│   ├── model-gateway/            # 供应商适配 + 工具协议
│   ├── security/                 # 审批、策略、密钥
│   ├── store/                    # SQLite schema 与 repository
│   └── shared/                   # 错误类型、DTO、日志
├── guest/                        # 打进镜像的代码
│   ├── muse-agentd/              # 工具服务
│   ├── window-capture/           # 窗口枚举与截图（X11）
│   └── image/                    # Packer / cloud-init
├── docs/
└── Cargo.toml / pnpm-workspace.yaml
```

---

## 5. 模块设计

### 5.1 ComputerProvider（单实例）

v1 只跑一台，但接口保留，便于测试与将来扩展。

```rust
#[async_trait::async_trait]
pub trait ComputerProvider: Send + Sync {
    async fn probe(&self) -> Result<HostCapabilities>;
    async fn create(&self, spec: &ComputerSpec) -> Result<ComputerId>;
    async fn start(&self, id: &ComputerId) -> Result<()>;
    async fn pause(&self, id: &ComputerId) -> Result<()>;
    async fn resume(&self, id: &ComputerId) -> Result<()>;
    async fn snapshot(&self, id: &ComputerId, name: &str) -> Result<SnapshotId>;
    async fn restore(&self, id: &ComputerId, snap: &SnapshotId) -> Result<()>;
    async fn shutdown(&self, id: &ComputerId, force: bool) -> Result<()>;
    async fn destroy(&self, id: &ComputerId, keep_workspace: bool) -> Result<()>;
    fn status_stream(&self, id: &ComputerId) -> BoxStream<'static, ComputerStatus>;
}

pub struct ComputerSpec {
    pub vcpus: u8,        // 默认 2
    pub memory_mib: u32,  // 默认 8192
    pub disk_gib: u32,    // 默认 150
    pub accel: Accel,     // Whpx | Hvf | Kvm | Tcg
    pub display: DisplayCfg, // 虚拟显示分辨率，默认 1280x800
}
```

**单机带来的简化**：端口固定（22001 / 22002 / 22003），不需要端口池；不需要并发启动；不需要多实例状态表。

**启动流程**：创建 COW 覆写盘 → 组装 QEMU 参数 → spawn 进程 → 轮询 `guest-ping` 直到就绪（超时 90 秒）→ 启动 `muse-agentd` → 拉起 Xvfb 与浏览器（或按需拉起）。

**QEMU 启动参数（参考，Windows/WHPX）：**

```
qemu-system-x86_64
  -machine q35,accel=whpx,kernel-irqchip=off
  -cpu max -smp 2 -m 8192
  -drive file=<images>/ubuntu-24.04-min.qcow2,if=virtio,readonly=on
  -drive file=<data>/disk.qcow2,if=virtio
  -netdev user,id=n0,hostfwd=tcp:127.0.0.1:22001-:22,
        hostfwd=tcp:127.0.0.1:22002-:8765
  -device virtio-net-pci,netdev=n0
  -display none
  -chardev pipe,id=qga,path=<data>/qga
  -device virtserialport,chardev=qga,name=org.qemu.guest_agent.0
  -qmp pipe:<data>/qmp
```

注意：无桌面电脑不需要 VGA 设备；WHPX 下 `kernel-irqchip` 必须为 `off`；不同平台不能共用同一份参数。

### 5.2 环境检测（HealthCheck）

软件启动时与创建电脑前各跑一次：

| 检查项 | 方法 | 不通过时 |
|---|---|---|
| CPU 虚拟化 | `Get-CimInstance Win32_Processor` 或 CPUID | 阻断，给 BIOS 指引 |
| 虚拟化平台功能 | `Get-WindowsOptionalFeature HypervisorPlatform` | 引导开启并重启 |
| 内存 | `sysinfo` | 低于 10GB 警告，低于 8GB 阻断 |
| 磁盘 | 数据目录所在盘 | 低于 180GB 警告，低于 160GB 阻断 |
| QEMU 后端 | `qemu-system-x86_64 -accel help` | 阻断，提示重装 |
| 端口占用 | 试绑 22001-22003 | 阻断，提示释放 |

### 5.3 镜像与电脑信息

**镜像管理**：分块下载 + SHA256 校验 + 断点续传，产物放 `%APPDATA%/muse-local/images/`；manifest 记录版本、大小、hash、guest agent 版本。

**电脑信息**（产品能力，前端独立页签，见 `MACHINE` 数据）：

- **硬件与系统**：系统版本、内核、CPU、内存、磁盘、Shell；
- **已装软件**：按开发语言、媒体与网络、Python 库分组列出，见附录 C；
- **没有安装**：明确列出 Go / Rust / Java / Docker / kubectl / Terraform / 云 CLI，并说明「需要时现装」；
- **已连接服务**：Gmail、Google 全家桶、GitHub、Slack、Notion、Dropbox、Figma、Canva、Spotify、Shopify、Stripe、1Password、Tailscale 等；
- **内置技能**：按领域分组的技能清单。

这份清单不是装饰。用户问「你的电脑什么配置、装了什么」时，它必须能当场给出一份**实测**结果，而不是凭印象回答。实现上是 Guest 内的一个只读盘点脚本（`muse-agentd` 启动时执行一次并缓存，用户在界面里点「重新检测」时重跑）。

**持久化语义（重要约束）**：虚拟机镜像可能被整体替换或重建，**只有主目录 `/home/muse` 保证保留**，装在系统目录外的东西不保证重启后还在。因此：

- 所有用户数据、工作区、浏览器 profile 一律放 `/home/muse`；
- AI 自装的软件必须走 `pip install --user`、`npm i -g`（前缀指到 home）或写进 `~/provision.sh` 以便重建后重放；
- 系统级依赖（apt 包）由镜像提供，AI 不应依赖运行时 apt 安装，必须装时触发审批。

### 5.4 Model Gateway

```rust
#[async_trait::async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn id(&self) -> &str;
    fn capabilities(&self) -> ProviderCaps;
    async fn chat(&self, req: ChatRequest) -> Result<ChatStream>;
    fn normalize(&self, msg: RawMessage) -> UnifiedMessage;
    fn tool_schema(&self, tools: &[ToolDef]) -> serde_json::Value;
}
```

- **统一消息模型**：`UnifiedMessage { role, content: Vec<Block> }`，`Block` 为 `Text | Image | ToolUse | ToolResult`；各家差异在 adapter 内消化。
- **流式**：所有 provider 归一成 `BoxStream<DeltaEvent>`，前端只处理一种事件流。
- **重试与降级**：429 / 5xx 指数退避；上下文超限时保留 system + 最近 N 轮 + 工具结果摘要。
- **Key 管理**：存系统密钥链（Windows Credential Manager / macOS Keychain），DB 只存引用键名。
- **成本统计**：每次调用记录 token 与估算费用。

### 5.5 会话与任务调度（多会话共用一台电脑）

这是单机方案里最需要设计清楚的一节。

**模型**

```
Conversation ──1:N──> Task ──> Turn ──> ToolCall
      └────────── 全部指向同一台 Computer ──────────┘
```

**三条硬规则**

1. **任务串行**。任一时刻只有一个 Task 处于 `running`。多个对话可以同时发起任务，但后到的排队，界面显示「前面还有 N 个任务，预计等待 …」。
2. **窗口独占**。正在运行的任务持有窗口（`window.holder = task_id`）。持有期间其他任务不得注入输入、不得导航。
3. **人工优先**。用户一旦接管，当前任务在下一个 Turn 边界暂停，直到交还。

**为什么要串行。** 两个任务同时点同一个浏览器，结果既不可复现也无法归因。串行是这台电脑「只有一个鼠标一个键盘」的必然结果，不是偷懒。用户的感知是「排队」，而不是「出错」。

**会话之间共享什么、隔离什么**

| 维度 | 行为 |
|---|---|
| 文件系统 | **共享**。所有会话看到同一个 `/home/muse/workspace`，这是有意的：用户可以让对话 A 抓数据、对话 B 分析 |
| 浏览器登录态 | **共享**。同一个 profile，避免每个对话重复登录 |
| 模型上下文 | **隔离**。每个 conversation 独立的消息历史 |
| 任务队列 | **共享**。全局一个队列，按提交时间排序 |
| 快照 | **共享**。快照是整机状态，不属于某个对话 |

**中断与抢占**

- 用户可取消排队中的任务，立即从队列移除；
- 用户可停止正在运行的任务（等当前工具调用自然结束，或 5 秒超时强断，见 §7.2）；
- 用户可接管窗口，效果等同于暂停当前任务；
- v1 **不做**高优先级抢占：后来的任务不能挤掉正在跑的任务。

### 5.6 Security Controller

1. **策略判定**：每个工具调用给出 `Allow / Ask / Deny`。写 Guest 内路径 Allow；`shell_exec` / `python_exec` Ask；访问宿主共享目录 Ask；`rm -rf` Deny。
2. **审批流**：`Ask` 时挂起任务，向前端推审批卡片（命令原文、影响范围、本次允许 / 本任务总是允许 / 拒绝），**超时默认拒绝**。
3. **网络策略**：QEMU user-mode NAT + 白名单代理，Guest 内 `http_proxy` 指向宿主代理，按域名放行；白名单外的访问触发审批而不是直接失败。
4. **审计**：工具调用、审批决定、文件传输写不可变追加日志，可导出 JSONL。

### 5.7 Host ↔ Guest 协议

Guest 内 `muse-agentd` 暴露 HTTP + WS，仅监听内网，经 QEMU `hostfwd` 映射到宿主 `127.0.0.1:22002`。所有请求带一次性 token（启动时经 QGA 注入 Guest 环境变量）。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/healthz` | 就绪探测、版本 |
| POST | `/exec` | 执行命令，返回 stdout / stderr / exit code |
| POST | `/fs/read` `/fs/write` `/fs/list` | 文件读写（限工作区） |
| GET | `/windows` | **窗口枚举**：id、标题、进程、边界、是否可见 |
| GET | `/windows/{id}/frame` | **单窗口截图**，返回 PNG |
| POST | `/windows/{id}/input` | **输入注入**：move / click / type / key / scroll |
| WS | `/windows/{id}/stream` | **画面订阅**：订阅后推帧，断开即停 |
| POST | `/browser/action` | 转发 Playwright / CDP 指令 |
| GET | `/inventory` | 电脑信息：已装软件、服务、配置（§5.3） |
| WS | `/events` | 工具执行进度、窗口增删、标题变更 |

**画面订阅的关键点**：`/windows/{id}/stream` 是**拉取式订阅**，没有订阅者时 Guest 侧不做任何截图与编码。前端折叠画面时必须撤销订阅，否则白烧 CPU。

### 5.8 前端关键实现

- **逻辑坐标映射**：画面按固定逻辑分辨率（1280×800）渲染，用一个 `transform: scale()` 适配容器。用户的点击坐标按 `(clientX - rect.left) / scale` 映射回逻辑坐标再发给 Guest，缩放比例变了也不用改后端。
- **接管是两条通道**：看画面（WS 订阅）与发输入（`/windows/{id}/input`）独立。接管时前端隐藏系统指针、用自绘指针跟随鼠标，输入走注入通道；交还后两条通道都停。
- **画面默认不显示**：界面里默认没有画面面板，避免「右边挂着一块空屏幕」。入口是对话里的画面快照——点它展开对应窗口的实时画面。
- **面板可折叠、可拖动调宽、可放大**：折叠时连同分隔条一起收起；拖动只改面板宽度并实时重算缩放；放大是全屏模态，模态内同样支持接管与输入。
- **状态同步**：所有状态变化通过 Tauri event 推送，前端不轮询。事件名 `computer://status`、`task://{id}/event`、`window://changed`。
- **虚拟列表**：任务事件流可能上万条，用虚拟滚动。

### 5.9 Guest 侧 muse-agentd

职责（薄执行层，不做规划）：

1. 接收工具调用请求并执行；
2. 工具执行串行队列，避免并发点击冲突；
3. **窗口服务**：枚举、截图、订阅推流、输入注入；
4. **清单盘点**：启动时执行一次，缓存给 `/inventory`；
5. 心跳与系统指标上报；
6. 维护工作区 `/home/muse/workspace`，宿主共享目录挂载到 `/mnt/host`（默认只读）。

语言建议 Rust 静态二进制（无运行时依赖、启动快）。

---

## 6. 数据模型（SQLite）

```sql
CREATE TABLE computers (          -- v1 只有一行
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
  spec_json TEXT NOT NULL, base_image TEXT NOT NULL, disk_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE conversations (      -- 对话；全部指向同一台电脑
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  computer_id TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL,
  status TEXT NOT NULL,               -- queued|running|waiting_approval|...
  provider TEXT, model TEXT,
  token_in INTEGER DEFAULT 0, token_out INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0,
  enqueued_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL, seq INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- message|tool_call|tool_result|window|approval|error
  payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, tool TEXT NOT NULL,
  args_json TEXT NOT NULL, decision TEXT, decided_at INTEGER, decided_by TEXT
);

CREATE TABLE windows (              -- 窗口登记，用于画面与占用仲裁
  id TEXT PRIMARY KEY, title TEXT, process TEXT,
  holder_task_id TEXT, captured_at INTEGER
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  size_bytes INTEGER, created_at INTEGER NOT NULL
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, base_url TEXT,
  secret_ref TEXT, models_json TEXT, enabled INTEGER DEFAULT 1
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
```

迁移用 `sqlx::migrate!`。

---

## 7. 状态机

### 7.1 电脑

```
created ──start──▶ starting ──agent ready──▶ running
                      │                        │
                      └──fail──▶ error        ├──pause──▶ paused ──resume──▶ running
                                               └──shutdown──▶ stopped
```

`starting` 超过 90 秒未就绪 → `error`，日志尾部返回前端；允许用户重试启动或重建数据盘。

### 7.2 任务

```
queued ─▶ running ─┬─▶ waiting_approval ─(批准)─▶ running
                   ├─▶ waiting_input ─(用户回复)─▶ running
                   ├─▶ paused_by_user ─(继续)─▶ running
                   └─▶ succeeded | failed | cancelled
```

**中断语义**：停止时先发取消信号，等当前工具调用自然结束（或 5 秒超时后强断），再把任务标记 `cancelled`，保证 Guest 不处于半执行状态。

### 7.3 窗口占用

```
free ──task acquires──▶ held(task_id) ──task ends──▶ free
         │                    │
         │                    └──takeover──▶ human_control ──release──▶ held(task_id)
         └──takeover (无任务)──▶ human_control ──release──▶ free
```

规则：同一时刻只有一个持有者；`held` 期间其他任务只能排队；`human_control` 期间 AI 的 GUI 工具立即返回 `Err(ControlTakenByHuman)`。

### 7.4 快照的正确语义

- **冷快照**：QMP `stop` → `savevm` → `cont`。磁盘与内存一致，耗时长、占用大。
- **恢复**：仅在电脑处于 `stopped` 状态时 `loadvm`。
- **重要区分**：快照**不等于**任务断点。恢复快照只回滚系统状态；继续任务要靠 task_events 重放加模型重新规划。UI 与文档都要说清。

---

## 8. 镜像构建

用 Packer（qemu builder）+ cloud-init 构建，产物发布到 registry。**目标是无可视桌面。**

| 层 | 内容 |
|---|---|
| 基础 | Ubuntu 24.04 LTS minimal，**不装任何桌面环境** |
| 虚拟显示 | `xvfb`（浏览器窗口画在这上面） |
| 浏览器 | Chromium + Playwright 及其依赖；浏览器 profile 固定在 `/home/muse/.config/chromium` |
| 窗口工具 | X11 窗口枚举与截图（`x11-utils`、`imagemagick` 或自研抓取器）、`xdotool`（输入注入） |
| 运行时 | Python 3.12、Node 22、Bun、`muse-agentd`（systemd）、`qemu-guest-agent` |
| 常用工具 | ffmpeg、curl、wget、jq、sqlite3、rsync、git、tmux、zsh、GCC/Make/CMake、tar/zip/unzip |
| Python 库 | numpy、pandas、SciPy、sympy、matplotlib、seaborn、plotly、openpyxl、python-docx、Pillow、lxml、requests、PyYAML |
| 磁盘布局 | `/home/muse` 单独一块盘（数据盘），其余属于可重建的镜像层 |
| 账户 | `muse` 免密 sudo（Guest 内），无桌面登录 |
| 清理 | 关闭 SSH 密码登录（仅密钥）、清空 machine-id 与日志 |

**不装**：XFCE 及任何桌面环境、LibreOffice、VS Code、屏幕保护。这些在 v1 里没有产品需求，装了只会让镜像变大、让「没有桌面」这件事说不清楚。

构建流程：`packer build guest/image/packer.pkr.hcl` → `ubuntu-24.04-min.qcow2` → sha256 → 上传 → 更新 `images/manifest.json`。

---

## 9. 安全设计

### 9.1 威胁模型

| 威胁 | 场景 | 缓解 |
|---|---|---|
| Guest 逃逸到宿主 | Agent 执行内核漏洞利用 | 及时更新 QEMU；不启用高危设备；宿主共享目录默认只读 |
| 提示注入导致越权 | 网页内容指示 AI 删除文件 | 工具分档 + 审批流；破坏性操作一律 Ask；外网内容标记为不可信来源 |
| 凭据泄露 | Key 被 Agent 读到 | 模型 Key 只存宿主密钥链，永不进入 Guest |
| 网站密码进入模型上下文 | 用户在对话里被诱导说出密码 | 产品规则：**AI 不在对话里索要密码**；登录在浏览器里完成，密码不经过模型 |
| 端口被局域网访问 | Agent / 画面端口暴露 | 全部绑定 `127.0.0.1`；防火墙拒绝外部入站 |
| 共享目录被加密勒索 | Agent 被诱导加密 `/mnt/host` | 默认不挂载；启用时默认只读；写入逐次审批 |
| 拒绝服务 | Agent 无限循环下载 | 每任务配额（时间 / token / 磁盘），超限即停 |

### 9.2 登录态的处理

真实浏览器意味着会有登录态。规则：

- 登录在 Guest 的浏览器里完成，凭据落在 `/home/muse/.config/chromium` 的 profile 里；
- 浏览器 profile 所在的盘需要加密（宿主侧对数据盘做加密，v1 用宿主文件系统加密即可）；
- AI 能看到「已登录」这个事实，但不读取也不回传表单里的密码字段；
- 用户接管输入密码时，输入通道直通浏览器，不经过模型上下文。

### 9.3 与云端产品的差距

本地电脑的隔离强度取决于宿主机与 QEMU 版本，**不等于**云端产品级沙箱；宿主机断电、关机、休眠都会中断 AI；本地电脑无法跨设备访问。首次启动应显示一页「能力与限制说明」。

---

## 10. 里程碑

| 里程碑 | 目标 | 交付物 | 预估 |
|---|---|---|---|
| M0 骨架 | 工程可跑通空壳 | monorepo、Tauri 骨架、SQLite、CI | 1 周 |
| M1 电脑能起来 | 无桌面 Guest 启动，能看到窗口画面 | computer-qemu、QMP/QGA、Xvfb + 窗口抓取、画面订阅、环境检测 | 3 周 |
| M2 AI 能动 | 端到端最小链路 | Session Manager、Model Gateway + 3 个 Provider、工具循环、终端文本流 | 3 周 |
| M3 一键化 | 用户装完即可用 | Packer 镜像、下载器、启动即创建、电脑信息盘点、冷快照 | 2 周 |
| M4 安全与体验 | 可发布 | 审批流、密钥链、网络白名单、接管输入通道、错误恢复、安装包与签名 | 3 周 |
| v1.0 发布 | Windows 11 稳定 | 安装包、自动更新、文档 | 1 周 |

**第一版必须打通的最小链路：**

```
安装桌面软件 → 启动时自动创建电脑 → AI 打开浏览器 → 点快照看到窗口画面
→ 接管窗口自己操作 → 交还 → AI 继续 → 产出文件
```

---

## 11. 测试策略

| 层 | 手段 | 覆盖重点 |
|---|---|---|
| 单元 | `cargo test` + `vitest` | trait 实现、参数拼装、消息归一化、状态机转移、坐标映射 |
| 契约 | 对 `ComputerProvider` 跑同一套集成测试（fake 与 qemu 共用） | 创建/启动/暂停/快照/恢复/销毁 |
| 调度 | 多会话并发用例 | 串行性、队列顺序、窗口占用仲裁、接管优先级 |
| Guest | 镜像启动后 smoke：开浏览器、开窗口、截图、注入点击、跑 Python | 镜像回归 |
| E2E | 驱动 Tauri 完成「启动 → 发任务 → 点快照 → 接管 → 断言文件生成」 | 主链路 |
| 稳定性 | 长跑 24 小时任务，注入网络中断、429、Guest 崩溃 | 恢复能力 |
| 安全 | 恶意提示词用例集、端口扫描、共享目录越权写入 | 见 §9 |

CI 矩阵：`windows-latest`（必须）、`ubuntu-latest`（KVM）。

---

## 12. 打包与分发

- **Sidecar**：QEMU 及依赖放 `src-tauri/binaries/`，用 Tauri `externalBin` 声明；Windows 可执行文件需带 target triple 后缀。
- **安装包**：NSIS，需要一次提权以检测并启用虚拟化功能、写防火墙规则。
- **体积**：精简 QEMU 约 40MB；镜像首次使用时下载。
- **自动更新**：Tauri updater + 签名校验；镜像与 agentd 走独立通道。
- **日志**：`%APPDATA%/muse-local/logs/`，滚动 7 天，提供「导出诊断包」。

---

## 13. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 用户机器不支持硬件虚拟化 | 中 | 高 | 环境检测与指引；TCG 降级并标注极慢 |
| 无桌面下的窗口抓取不稳定 | 中 | 高 | Xvfb 固定分辨率；抓取器独立进程，失败不影响 agentd；必要时降级为 CDP 内容级截图 |
| 单机串行导致等待感 | 高 | 中 | 队列位置与预计等待明示；排队任务可取消 |
| 登录态管理复杂 | 中 | 中 | profile 固定在 home 盘并加密；v1 不做多账号切换 |
| 镜像重建导致 AI 装的东西丢失 | 中 | 中 | 主目录保证保留；自装软件写入 `~/provision.sh` 重放 |
| WHPX 在不同 Windows 版本行为不一致 | 中 | 高 | 抽象 `Accel`，保留 TCG 分支；CI 覆盖多个版本 |
| 模型工具调用不稳定 | 高 | 中 | 参数 JSON Schema 校验、失败重试、错误回灌 |
| 快照占满用户磁盘 | 中 | 中 | 快照配额、LRU 清理、UI 显示占用 |

---

## 14. 附录

### A. 环境变量与路径

| 名称 | 默认值 | 说明 |
|---|---|---|
| `MUSE_DATA_DIR` | `%APPDATA%/muse-local` | 数据根目录 |
| `MUSE_IMAGES_DIR` | `<data>/images` | 基础镜像 |
| `MUSE_AGENT_PORT` | 22002 | agentd 回环端口 |
| `MUSE_TCG_FALLBACK` | true | 无硬件加速时是否允许 TCG |

### B. 工具清单（v1）

| 工具 | 参数 | 风险级 |
|---|---|---|
| `fs_read` / `fs_write` / `fs_list` | path, content | 低 |
| `shell_exec` | cmd, cwd, timeout | 中（按命令内容升级） |
| `python_exec` | code | 中 |
| `browser_goto` / `browser_click` / `browser_type` / `browser_extract` | url / selector / text | 低 |
| `window_list` / `window_screenshot` | window_id | 低 |
| `window_click` / `window_type` / `window_key` / `window_scroll` | window_id, 坐标或文本 | 中 |
| `clipboard_get` / `clipboard_set` | — | 低 |
| `host_share_read` / `host_share_write` | path | 高（默认 Ask） |
| `ask_user` | question, options | 低 |
| `task_finish` | summary, artifacts | 低 |

注意：v1 **没有**整屏截图工具。`gui_*` 那种操作整个桌面的工具在无桌面模型下没有意义，取而代之的是 `window_*`。

### C. 电脑默认配置与软件清单

镜像的验收基线。清单必须能被 `/inventory` 实测出来。

**硬件与系统**：Ubuntu 24.04.5 LTS（x86_64）· 2 核 · 8GB 内存 · 主目录 150GB · 无图形桌面 · bash / zsh / tmux

**已装软件**

- 开发语言与构建：Python 3.12、pip、Node.js 22、npm、Bun、GCC / G++、Make、CMake、Git
- 媒体与网络：ffmpeg / ffprobe、curl、wget、jq、sqlite3、rsync、ssh / scp、tar / zip / unzip
- Python 库：numpy、pandas、SciPy、sympy、matplotlib、seaborn、plotly、openpyxl、python-docx、Pillow、lxml、requests、PyYAML

**没有安装**（需要时现装，装系统包要审批）：Go、Rust、Java、Docker、kubectl、Terraform、AWS / Azure / GCP CLI

**已连接服务**：Gmail、Google 日历 / 文档 / 云端硬盘 / 表格 / 幻灯片 / 任务、Outlook 邮件 / 日历 / 联系人、GitHub、Slack、Notion、Dropbox、Box、Evernote、Figma、Canva、Spotify、Instagram、Facebook、Threads、Messenger、Meta 广告、Duffel 机票、FlightAware、Ticketmaster、OpenTable、Shopify、Shop Pay、Stripe、Plaid、QuickBooks、1Password、Tailscale、Apple Health、Peloton、Philips Hue

### D. 后续路线

- v1.1：热快照、多显示器、文件拖拽双向传输、`~/provision.sh` 自动重放；
- v1.2：WebRTC 画面（低延迟）、macOS 支持；
- v1.3：本地小模型旁路（简单工具调用不耗 API）；
- v2.0：可选常驻服务或远程执行节点，实现「关机后仍运行」。

---

## 附录：变更记录

**v0.2（2026-10-30）**
- 单机：移除多台电脑、电脑列表、端口池、多机并发；新增 §5.5 会话与任务调度。
- 无桌面：移除 XFCE、桌面自动化、整屏 VNC；改为按窗口转播 + 文本终端流。
- 新增画面按需订阅、窗口占用仲裁、逻辑坐标映射、电脑信息盘点、登录态处理（§9.2）。
- 新增 §5.3 持久化语义约束（只有主目录保证保留）。
- 工具清单用 `window_*` 取代 `gui_*`。

**v0.1（2026-10-30）** 首版骨架。
