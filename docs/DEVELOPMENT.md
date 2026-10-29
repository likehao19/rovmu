# Muse Local 开发文档

| 项 | 内容 |
|---|---|
| 文档版本 | v0.1 |
| 日期 | 2026-10-30 |
| 目标平台 | Windows 11（首发），macOS / Linux 后续 |
| 一句话定义 | 在用户本地电脑上用 QEMU 起一台 Ubuntu 虚拟机，交给 AI 自主操作，用户可实时观看并随时接管 |

---

## 0. 文档目的与范围

本文档是 Muse Local 从零到第一个可用版本的工程实施说明。它回答四个问题：

1. 系统由哪些部分组成，边界与信任模型在哪里；
2. 每个模块负责什么，模块之间用什么接口通信；
3. 第一版（v1.0）做到什么程度，不做什么；
4. 如何排期、测试、打包、发布。

本文档**不包含**：云端 Agent 持续运行、多租户、计费、模型微调。这些属于 v2 及以后的路线。

---

## 1. 产品定义

### 1.1 定位

给 AI 一台属于它自己的电脑。用户安装桌面软件后，软件在本地创建一台 Linux 虚拟机，AI 在这台虚拟机里拥有文件系统、浏览器、桌面环境和终端，可以自主完成「打开网页查资料并写进表格」这类需要真实图形界面的任务。用户通过软件窗口实时看到 AI 的操作画面，必要时按键中断并接管鼠标键盘。

### 1.2 能力范围

| 能力 | v1.0 | 说明 |
|---|---|---|
| 一键创建本地 Linux VM | 支持 | QEMU + qcow2 写时复制 |
| AI 操作浏览器 | 支持 | Playwright（主）+ 视觉坐标点击（备） |
| AI 执行 Shell / Python | 支持 | 虚拟机内工具服务，宿主机不可达 |
| 独立文件系统与工作区 | 支持 | 独立数据盘，与宿主机仅通过显式挂载共享 |
| 实时观看画面 | 支持 | VNC over 回环，前端 noVNC 渲染 |
| 人工接管（鼠标键盘） | 支持 | 输入仲裁：人优先，AI 暂停 |
| 多模型配置 | 支持 | Provider Adapter，至少 3 家 |
| 多台 AI 电脑 | 支持 | 理论上限 3，受宿主内存约束 |
| 任务与文件持久化 | 支持 | SQLite + 虚拟磁盘 |
| 定时 / 循环任务 | 部分 | 仅支持软件运行期间 |
| 快照与恢复 | 支持 | 冷快照；热快照（含内存）列为 v1.1 |
| 软件关闭后 AI 继续跑 | 不支持 | 需常驻服务，见 §13 风险 |
| 与 Muse 同等级安全 | 不支持 | 本地隔离强度不同，见 §9 |

### 1.3 明确不做（v1）

- 不做账号体系与云端同步；
- 不做虚拟化引擎自研，直接驱动 QEMU；
- 不做跨宿主机的镜像兼容层（x86_64 与 ARM64 镜像分开制作）；
- 不做虚拟机内的多用户隔离。

### 1.4 术语表

| 术语 | 含义 |
|---|---|
| Host | 用户的本机，运行 Tauri 客户端与 Rust 本地服务 |
| Guest | 虚拟机内运行的系统（Ubuntu + XFCE） |
| Computer | 一台 AI 电脑，= 一个 Guest 实例 + 一份数据盘 |
| Provider | 大模型供应商适配器 |
| Tool | Agent 可调用的原子动作（读文件、点击、执行命令…） |
| Turn | 一次「模型思考 → 工具调用 → 结果回灌」的循环 |
| Task | 用户发起的一次完整任务，包含多个 Turn |

---

## 2. 架构总览

### 2.1 分层

```
┌───────────────────────────────────────────────────────────────┐
│  Tauri 2 桌面客户端 (WebView)                                  │
│  聊天  ·  模型配置  ·  电脑画面  ·  文件  ·  任务中心           │
│  技术：Vue 3 + TypeScript + Vite + noVNC (Web 组件)            │
└───────────────▲───────────────────────────────────────────────┘
                │  Tauri IPC (command / event, JSON)
┌───────────────┴───────────────────────────────────────────────┐
│  Rust 本地服务 (Tauri 主进程内的 tokio runtime)                │
│                                                               │
│   HostController ────── 统一入口，路由 IPC 与事件              │
│   VM Manager (ComputerProvider)  创建/启动/暂停/快照/销毁      │
│   Model Gateway                  模型供应商适配 + 工具协议      │
│   Task Scheduler                 任务队列、重试、恢复、日志      │
│   Security Controller            权限、网络策略、人工审批        │
│   Store (SQLite, sqlx)           元数据持久化                  │
└───────────────▲───────────────────────────────────────────────┘
                │  QEMU 控制通道：QMP (named pipe / unix socket)
                │  Guest 通信：QGA (virtio-serial) + Agent HTTP
                │  画面：VNC (127.0.0.1) → WebSocket 桥 → 前端
┌───────────────┴───────────────────────────────────────────────┐
│  本地 Ubuntu VM（一台独立的「电脑」）                           │
│   muse-agentd   任务执行循环 · 工具服务(HTTP+WS, 仅监听内网)     │
│   Chromium      浏览器 + Playwright Server                    │
│   XFCE          桌面环境                                       │
│   TigerVNC + xdotool                                           │
│   qemu-guest-agent                                             │
│   Python / Node / LibreOffice / VS Code（预装）                 │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策

**D1：VM 管理器在宿主机，Agent 执行器在虚拟机内。**
VM Manager 必须看到宿主机磁盘和虚拟化后端，只能在宿主机；Agent 一旦在 Guest 内执行恶意命令，只破坏 Guest，拿不到宿主机控制权。两者跨信任边界，只通过 QMP、QGA、受控 HTTP 三个窄接口通信。

**D2：控制面与数据面分离。**
模型调用走宿主机 Rust 服务，Agent 不持有 API Key；Guest 内的 muse-agentd 只负责执行工具并把结果回传。这样 API Key 不进入可能被 AI 破坏的系统。

**D3：浏览器优先用 Playwright，视觉点击作为回退。**
DOM 操作准确、便宜、可断言；但很多任务需要真实桌面交互，所以必须保留「截图 + 坐标点击」能力作为兜底。

**D4：画面与控制分离。**
VNC 只走 `127.0.0.1`，Rust 服务做 VNC 到 WebSocket 的桥接并注入鉴权；不把 VNC 端口暴露到局域网。

**D5：外部可执行程序（QEMU、镜像下载器）作为 Tauri Sidecar 打包。**
避免用户手动装环境；但驱动（WHPX / 虚拟化平台）仍需提升权限安装一次。

---

## 3. 技术选型

| 层 | 选型 | 理由 | 备选与否决理由 |
|---|---|---|---|
| 桌面框架 | Tauri 2 | 体积小、Rust 后端天然适合同进程管虚拟机、官方 Sidecar | Electron：内存开销大，Node 侧调 QMP 不便 |
| 前端 | Vue 3 + TS + Vite | 上手快、生态足够、配合 noVNC 简单 | React：无实质差别，取决于团队熟悉度 |
| 本地服务 | Rust 2021 + tokio + axum | 与 Tauri 同进程，零拷贝共享状态 | 独立 sidecar 进程：IPC 复杂度上升 |
| 虚拟机引擎 | QEMU（x86_64） | 跨平台一致、qcow2 快照成熟、可脚本化、无需自研 | Docker：共享内核，桌面与隔离不足；Hyper-V：Windows 专有、脚本化差 |
| 加速后端 | Windows: WHPX；macOS: HVF；Linux: KVM | 统一抽象成 `Accel` | 无硬件加速时降级 TCG |
| Guest OS | Ubuntu 24.04 LTS + XFCE | LTS 稳定、桌面轻、包全 | Alpine：缺桌面生态 |
| 镜像 | qcow2 基础镜像 + 每台 COW 覆盖层 | 秒级创建、磁盘占用可控 | 全量复制：慢且占空间 |
| 浏览器自动化 | Playwright (Chromium) | API 稳定、可导出 trace | Puppeteer：功能覆盖较少 |
| 桌面自动化 | xdotool + 截图工具 | 与 Playwright 互补 | — |
| 画面传输 | TigerVNC + noVNC 前端 | 成熟、可嵌 WebView | WebRTC：延迟低但需信令服务，v1.2 再评估 |
| 持久化 | SQLite（sqlx） | 免部署、事务可靠 | — |
| 镜像分发 | OCI registry 或对象存储 | 支持分块续传 | 单文件 HTTP：断点续传弱 |

---

## 4. 仓库结构

单仓库（monorepo），pnpm workspace + Cargo workspace。

```
muse-local/
├── apps/
│   └── desktop/                  # Tauri 客户端
│       ├── src/                  # Vue 3 前端
│       │   ├── views/            # Chat / Computer / Tasks / Files / Settings
│       │   ├── components/
│       │   ├── vnc/              # noVNC 封装 + 输入仲裁
│       │   └── api/              # Tauri invoke 封装 + 事件订阅
│       ├── src-tauri/
│       │   ├── src/main.rs
│       │   ├── tauri.conf.json
│       │   └── binaries/         # sidecar 产物（qemu 等）
│       └── package.json
├── crates/
│   ├── host-controller/          # IPC 与事件总线路由
│   ├── computer/
│   │   ├── computer-core/        # ComputerProvider trait + 领域模型
│   │   ├── computer-qemu/        # QEMU 实现（QMP/QGA 客户端）
│   │   └── computer-fake/        # 测试用假实现
│   ├── model-gateway/            # Provider Adapter + 工具协议
│   ├── scheduler/                # 任务队列与恢复
│   ├── security/                 # 审批、策略、密钥
│   ├── store/                    # SQLite schema 与 repository
│   └── shared/                   # 错误类型、DTO、日志
├── guest/                        # 打进镜像的代码
│   ├── muse-agentd/              # 工具服务（建议 Rust 静态二进制）
│   ├── image/                    # Packer / 构建脚本 / cloud-init
│   └── tools/                    # xdotool / 截图 / 剪贴板 脚本
├── docs/
│   ├── DEVELOPMENT.md            # 本文件
│   ├── PROTOCOL.md               # Host↔Guest 协议
│   ├── TOOLS.md                  # 工具清单与参数
│   └── SECURITY.md               # 威胁模型
├── scripts/                      # 构建、签名、发布脚本
└── Cargo.toml / pnpm-workspace.yaml
```

---

## 5. 模块设计

### 5.1 ComputerProvider（虚拟机抽象）

核心 trait，隔离不同虚拟化后端与操作系统差异：

```rust
#[async_trait::async_trait]
pub trait ComputerProvider: Send + Sync {
    /// 探测本机虚拟化能力：CPU 特性、后端可用性、资源余量
    async fn probe(&self) -> Result<HostCapabilities>;

    /// 创建一份 COW 覆盖层数据盘，分配端口，注册到 store
    async fn create(&self, spec: &ComputerSpec) -> Result<ComputerId>;

    /// 启动；返回后保证 Guest Agent 已可连接（内部轮询 QGA）
    async fn start(&self, id: &ComputerId) -> Result<()>;

    /// 暂停（QMP stop，保留内存）
    async fn pause(&self, id: &ComputerId) -> Result<()>;
    async fn resume(&self, id: &ComputerId) -> Result<()>;

    /// 冷快照：先 stop 再 savevm；快照名带时间戳
    async fn snapshot(&self, id: &ComputerId, name: &str) -> Result<SnapshotId>;
    async fn restore(&self, id: &ComputerId, snap: &SnapshotId) -> Result<()>;
    async fn list_snapshots(&self, id: &ComputerId) -> Result<Vec<SnapshotMeta>>;

    /// 优雅关闭 → 超时强杀
    async fn shutdown(&self, id: &ComputerId, force: bool) -> Result<()>;

    /// 销毁：删除覆盖层、释放端口、清元数据（可选保留用户工作区）
    async fn destroy(&self, id: &ComputerId, keep_workspace: bool) -> Result<()>;

    /// 实时状态流（供前端订阅）
    fn status_stream(&self, id: &ComputerId) -> BoxStream<'static, ComputerStatus>;
}

pub struct ComputerSpec {
    pub name: String,
    pub vcpus: u8,          // 默认 4
    pub memory_mib: u32,    // 默认 4096
    pub disk_gib: u32,      // 默认 40
    pub accel: Accel,       // Whpx | Hvf | Kvm | Tcg
    pub display: DisplayCfg,// 分辨率、色深
    pub network: NetworkCfg,// v1 固定 user-mode NAT
}
```

**QEMU 实现的内部职责：**

1. **端口分配**：每台 Computer 分配一组回环端口（SSH / Agent / VNC / QMP），从 `20000..30000` 的池中取，冲突则重试，持久化到 store。
2. **进程管理**：用 `tokio::process::Command` 启动 QEMU，stdout/stderr 重定向到日志文件；父进程退出时通过 Job Object（Windows）或进程组（Linux）避免孤儿进程。
3. **QMP 客户端**：连接 named pipe / unix socket，`qmp_capabilities` 后发送 `query-status`、`system_powerdown`、`stop`、`cont`、`savevm`、`loadvm`。
4. **QGA 客户端**：经 virtio-serial 通道调用 `guest-ping`、`guest-exec`、`guest-file-read/write`、`guest-network-get-interfaces`。
5. **健康等待**：`start` 返回前轮询 `guest-ping` 直到成功（超时 90 秒，期间向前端发进度事件）。

**v1 的 QEMU 启动参数（参考）：**

```
qemu-system-x86_64
  -machine q35,accel=whpx,kernel-irqchip=off
  -cpu max -smp 4 -m 4096
  -drive file=<images>/ubuntu-24.04-xfce.qcow2,if=virtio,readonly=on
  -drive file=<computers>/<id>/disk.qcow2,if=virtio
  -netdev user,id=n0,
      hostfwd=tcp:127.0.0.1:<ssh>-:22,
      hostfwd=tcp:127.0.0.1:<agent>-:8765,
      hostfwd=tcp:127.0.0.1:<vnc>-:5900
  -device virtio-net-pci,netdev=n0
  -device virtio-vga -display none
  -chardev pipe,id=qga,path=<computers>/<id>/qga
  -device virtserialport,chardev=qga,name=org.qemu.guest_agent.0
  -qmp pipe:<computers>/<id>/qmp
```

注意：WHPX 下 `kernel-irqchip` 需为 `off`；不同平台不能共用同一份参数，`computer-qemu` 内按 `cfg(target_os)` 与 `Accel` 组合生成参数是必须的。

### 5.2 环境检测（HealthCheck）

软件启动时与「创建电脑」前各跑一次，输出结构化结果：

| 检查项 | 方法 | 不通过时的处理 |
|---|---|---|
| CPU 虚拟化 | Windows：`Get-CimInstance Win32_Processor` 的 VirtualizationFirmwareEnabled；或 CPUID 位 | 阻断，给出 BIOS 开启指引 |
| 虚拟化平台已启用 | `Get-WindowsOptionalFeature HypervisorPlatform` | 引导用户开启并重启 |
| 内存 | `sysinfo` 读可用内存 | 低于 6GB 警告，低于 4GB 阻断 |
| 磁盘 | 数据目录所在盘可用空间 | 低于 30GB 警告，低于 15GB 阻断 |
| QEMU 后端 | 试运行 `qemu-system-x86_64 -accel help` | 阻断，提示重装 |
| 端口池 | 抽样试绑 20000-30000 | 缩小池范围 |

结果同时暴露给前端做「环境自检」页，每条给出可执行的修复动作。

### 5.3 镜像管理（ImageStore）

- 基础镜像从 registry 拉取，分块下载 + SHA256 校验 + 断点续传，产物放 `%APPDATA%/muse-local/images/`；
- 记录 manifest（版本、大小、hash、Guest 内 agentd 版本）；
- 提供「升级镜像」流程：保留用户数据盘，替换基础镜像层，Guest 内 `/opt/muse` 自更新后重启；
- Guest 内 muse-agentd 有独立自更新通道（签名校验，保留上一版可回滚）。

### 5.4 Model Gateway

```rust
#[async_trait::async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn id(&self) -> &str;                        // "anthropic" | "openai" | ...
    fn capabilities(&self) -> ProviderCaps;      // tool_use / 图像 / 流式
    async fn chat(&self, req: ChatRequest) -> Result<ChatStream>;
    fn normalize(&self, msg: RawMessage) -> UnifiedMessage;
    fn tool_schema(&self, tools: &[ToolDef]) -> serde_json::Value;
}

pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<UnifiedMessage>,
    pub tools: Vec<ToolDef>,
    pub temperature: f32,
    pub max_tokens: u32,
}
```

要点：

- **统一消息模型**：`UnifiedMessage { role, content: Vec<Block> }`，`Block` 为 `Text | Image | ToolUse | ToolResult`。各家差异在 adapter 内消化。
- **流式**：所有 provider 归一成 `BoxStream<DeltaEvent>`，前端只处理一种事件流。
- **重试与降级**：429 / 5xx 指数退避；上下文超限时截断（保留 system + 最近 N 轮 + 工具结果摘要）。
- **Key 管理**：存系统密钥链（Windows Credential Manager / macOS Keychain），DB 只存引用键名。
- **成本统计**：每次调用记录 token 数与估算费用，写入 usage 表供前端展示。

### 5.5 Task Scheduler

- 任务队列持久化在 SQLite，进程重启后恢复未完成任务；
- 状态机：`queued → running → (paused_by_user | waiting_approval | waiting_input) → succeeded | failed | cancelled`；
- 每个 Task 有独立 `CancellationToken`，用户点「停止」立即中断当前 Provider 流与工具调用；
- 并发策略：默认单任务独占一台 Computer；同一台机上不允许并发任务，避免鼠标键盘争抢；
- 定时任务（v1 部分支持）：仅在软件运行期间由 tokio timer 触发，重启后重建；
- 每步写 task_events（类型、payload、时间戳），前端时间线直接读它。

### 5.6 Security Controller

四个职责：

1. **策略判定**：对每个工具调用给出 `Allow / Ask / Deny`。例如写 Guest 内路径 Allow；访问宿主共享目录 Ask；`curl` 到白名单外 Ask；`rm -rf /` Deny。
2. **审批流**：`Ask` 时挂起任务，向前端推审批卡片（命令原文、影响范围、本次允许 / 本任务总是允许 / 拒绝），超时默认拒绝。
3. **网络策略**：v1 用 QEMU user-mode NAT 加白名单代理，Guest 内 `http_proxy` 指向宿主代理服务，宿主机按域名放行。
4. **审计**：所有工具调用、审批决定、文件传输写不可变追加日志，可导出 JSONL。

### 5.7 Host 与 Guest 协议

Guest 内 muse-agentd 暴露 HTTP + WebSocket，仅监听 Guest 内网，经 QEMU hostfwd 映射到宿主 `127.0.0.1:<agent>`。所有请求带一次性 token（启动时经 QGA 注入 Guest 环境变量，宿主侧随机生成）。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/healthz` | 就绪探测、版本 |
| POST | `/exec` | 执行命令，返回 stdout / stderr / exit code |
| POST | `/fs/read` `/fs/write` `/fs/list` | 文件读写（限工作区） |
| POST | `/gui/screenshot` | 返回 PNG（base64） |
| POST | `/gui/click` `/gui/type` `/gui/key` | 桌面输入 |
| POST | `/browser/action` | 转发 Playwright 指令 |
| WS | `/events` | 工具执行进度、画面变化、窗口标题变更 |

详细字段见 `docs/PROTOCOL.md`。

### 5.8 前端关键实现

- **输入仲裁**：noVNC 画布捕获鼠标键盘事件时先调 `take_control()`，Rust 侧把该 Computer 标记为「人工接管」，暂停 Agent 的 GUI 工具（返回 `Err(ControlTakenByHuman)`），前端显示「AI 已暂停」横幅；用户点「交还」再 `release_control()`。
- **状态同步**：所有状态变化通过 Tauri event 推送，前端不轮询。事件名统一为 `computer://{id}/status`、`task://{id}/event`。
- **虚拟列表**：任务事件流可能上万条，用虚拟滚动。

### 5.9 Guest 侧 muse-agentd

职责（薄执行层，不做规划）：

1. 接收工具调用请求，按 TOOLS.md 定义执行；
2. 工具执行串行队列，避免并发点击冲突；
3. 定期上报心跳与系统指标（CPU / 内存 / 当前窗口）；
4. 维护工作区 `/home/muse/workspace`，宿主共享目录挂载到 `/mnt/host`（可配置为只读或关闭）。

语言建议：Rust 静态二进制，无运行时依赖、启动快；若团队更熟 Python 也可，但需把 Playwright 与解释器一起固化进镜像层。

---

## 6. 数据模型（SQLite）

```sql
CREATE TABLE computers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL,           -- created|starting|running|paused|stopped|error
  spec_json     TEXT NOT NULL,           -- ComputerSpec
  base_image    TEXT NOT NULL,
  disk_path     TEXT NOT NULL,
  ports_json    TEXT NOT NULL,           -- {ssh,agent,vnc,qmp}
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY, computer_id TEXT NOT NULL,
  name TEXT NOT NULL, kind TEXT NOT NULL,  -- cold|warm
  size_bytes INTEGER, created_at INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, computer_id TEXT NOT NULL,
  title TEXT NOT NULL, prompt TEXT NOT NULL,
  status TEXT NOT NULL, provider TEXT, model TEXT,
  token_in INTEGER DEFAULT 0, token_out INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0,
  created_at INTEGER NOT NULL, finished_at INTEGER
);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL, seq INTEGER NOT NULL,
  kind TEXT NOT NULL,        -- message|tool_call|tool_result|approval|error|note
  payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
  tool TEXT NOT NULL, args_json TEXT NOT NULL,
  decision TEXT, decided_at INTEGER, decided_by TEXT
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL, role TEXT NOT NULL,
  content_json TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, base_url TEXT,
  secret_ref TEXT,           -- 指向系统密钥链的键名
  models_json TEXT, enabled INTEGER DEFAULT 1
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
```

迁移用 `sqlx::migrate!`，schema 版本写在 settings 中。

---

## 7. 状态机

### 7.1 Computer

```
created ──start──▶ starting ──guest ready──▶ running
   ▲                  │                        │
   │                  └──fail──▶ error         ├──pause──▶ paused ──resume──▶ running
   │                                           ├──snapshot──▶ (running，快照落盘)
   └──────────── destroy ◀── stopped ◀─shutdown─┘
```

- `starting` 超过 90 秒未就绪 → `error`，日志尾部返回前端；
- `error` 允许用户打开串口日志 / 重试启动 / 重建磁盘。

### 7.2 Task

```
queued ─▶ running ─┬─▶ waiting_approval ─(批准)─▶ running
                   ├─▶ waiting_input ─(用户回复)─▶ running
                   ├─▶ paused_by_user ─(继续)─▶ running
                   └─▶ succeeded | failed | cancelled
```

**中断语义**：用户点「停止」时先发取消信号，等当前工具调用自然结束（或 5 秒超时后强断），再把任务标记 `cancelled`，保证 Guest 不处于半执行状态。

### 7.3 快照的正确语义

- **冷快照**：QMP `stop` → `savevm` → `cont`。磁盘与内存一致，但耗时长、占用大。
- **恢复**：仅在 VM 处于 `stopped` 状态时 `loadvm`。
- **重要区分**：快照不等于任务断点。任务断点恢复靠 task_events 重放加模型重新规划；快照只回滚系统状态。文档与 UI 都要说清，避免用户误以为「恢复快照 = 继续任务」。

---

## 8. 镜像构建

用 Packer（qemu builder）+ cloud-init 构建，产物发布到 registry。

| 层 | 内容 |
|---|---|
| 基础 | Ubuntu 24.04 LTS server，装 `xfce4` 与 `xfce4-goodies`，禁用屏保与锁屏 |
| 显示 | TigerVNC server，开机自启，密码首次启动由 cloud-init 生成并回传 |
| 自动化 | Chromium + `playwright install chromium --with-deps`，Playwright Server 开机自启 |
| 桌面工具 | `xdotool`、`scrot`、`xclip`、`wmctrl` |
| 运行时 | Python 3.12、Node 22、muse-agentd（systemd unit）、qemu-guest-agent |
| 办公 | LibreOffice、VS Code（无账号模式） |
| 账户 | `muse` 免密 sudo（Guest 内），自动登录 XFCE |
| 清理 | 关闭 SSH 密码登录（仅密钥）、清空 machine-id 与日志 |

构建流程：`packer build guest/image/packer.pkr.hcl` 产出 `ubuntu-24.04-xfce.qcow2`，计算 sha256，上传 registry，更新 `images/manifest.json`。

版本管理：镜像内 `/opt/muse/VERSION` 记录 agentd 版本，宿主启动后经 `/healthz` 比对，不一致则提示升级。

---

## 9. 安全设计

### 9.1 威胁模型

| 威胁 | 场景 | 缓解 |
|---|---|---|
| Guest 逃逸到宿主 | Agent 执行内核漏洞利用 | 及时更新 QEMU；不启用高危设备；宿主共享目录默认只读 |
| 提示注入导致越权 | 网页内容指示 AI 删除文件 | 工具分档加审批流；破坏性操作一律 Ask；外网内容标记为不可信来源 |
| 凭据泄露 | Key 被 Agent 读到 | Key 只存宿主密钥链，永不进入 Guest；模型调用全在宿主侧 |
| 端口被局域网访问 | VNC / Agent 端口暴露 | 全部绑定 `127.0.0.1`；防火墙规则拒绝外部入站到端口池 |
| 共享目录被加密勒索 | Agent 被诱导加密 `/mnt/host` | 默认不挂载；启用时默认只读；写入逐次审批 |
| 拒绝服务 | Agent 无限循环下载 | 每任务配额（时间 / token / 磁盘），超限即停 |

### 9.2 与云端 Muse 的差距（必须向用户明说）

本地 VM 的隔离强度取决于宿主机与 QEMU 版本，不等于云端产品级沙箱。宿主机断电、关机、休眠都会中断 Agent，且本地虚拟机无法跨设备访问。首次启动应显示一页「能力与限制说明」。

### 9.3 密钥与权限

- API Key 存系统密钥链；
- QEMU 需要的虚拟化权限：优先 WHPX（需「虚拟机平台」功能，一次管理员提权），否则降级 TCG 并明确警告性能损失；
- 软件自身以普通用户运行，仅在安装驱动或开启系统功能时提权。

---

## 10. 里程碑

| 里程碑 | 目标 | 交付物 | 预估 |
|---|---|---|---|
| M0 骨架 | 工程可跑通空壳 | monorepo、Tauri 骨架、SQLite、CI | 1 周 |
| M1 VM 能起来 | 起 QEMU 并在前端看到画面 | computer-qemu、QMP/QGA 客户端、noVNC 接入、环境检测 | 3 周 |
| M2 AI 能动 | 端到端最小链路 | Model Gateway 加 3 个 Provider、tool 循环、`/exec` 与 `/gui` 工具、任务时间线 | 3 周 |
| M3 一键化 | 用户装完即可用 | Packer 镜像、下载器、一键创建、端口池、快照 | 2 周 |
| M4 安全与体验 | 可发布 | 审批流、密钥链、网络白名单、输入仲裁、错误恢复、安装包与签名 | 3 周 |
| v1.0 发布 | Windows 11 稳定 | 安装包、自动更新、文档 | 1 周 |

**第一版必须打通的最小链路：**

```
安装桌面软件 → 一键创建本地 Linux VM → 打开 VM 画面 → 配置模型 API Key
→ 输入任务 → AI 自动操作虚拟机 → 用户接管 → 保存任务与文件
```

只要这条链路稳定，就拿到了具备 Muse 核心交互能力的本地产品。

---

## 11. 测试策略

| 层 | 手段 | 覆盖重点 |
|---|---|---|
| 单元 | `cargo test` + `vitest` | trait 实现、参数拼装、消息归一化、状态机转移 |
| 契约 | 对 `ComputerProvider` 跑同一套集成测试（`computer-fake` 与 `computer-qemu` 共用） | 创建 / 启动 / 暂停 / 快照 / 恢复 / 销毁 |
| Guest | 镜像启动后跑 smoke 套件：截图、点击、开浏览器、跑 Python | 镜像回归 |
| E2E | Playwright 驱动 Tauri 完成「创建 VM → 发任务 → 断言文件生成」 | 主链路 |
| 稳定性 | 长跑 24 小时任务，注入网络中断、Provider 429、VM 崩溃 | 恢复能力 |
| 安全 | 恶意提示词用例集、端口扫描验证、共享目录越权写入尝试 | 见 §9 |

CI 矩阵：`windows-latest`（必须）、`ubuntu-latest`（KVM）。macOS 在 M4 后加入。

---

## 12. 打包与分发

- **Sidecar 打包**：QEMU 及其依赖 DLL 放 `src-tauri/binaries/`，用 Tauri 的 externalBin 声明，运行时经 sidecar API 调用；Windows 上可执行文件需带 target triple 后缀。
- **安装包**：NSIS（Windows），需要一次提权以检测并启用虚拟化功能、写入防火墙规则。
- **体积控制**：精简构建的 QEMU 可压到约 40MB；镜像走首次使用时下载，不塞进安装包。
- **自动更新**：Tauri updater 加签名校验；镜像与 agentd 走独立更新通道。
- **日志**：`%APPDATA%/muse-local/logs/`，滚动保留 7 天，提供「导出诊断包」（环境检测结果、QEMU 日志尾部、schema 版本）。

---

## 13. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 用户机器不支持硬件虚拟化 | 中 | 高 | 明确环境检测与指引；提供 TCG 降级并标注极慢 |
| WHPX 在不同 Windows 版本行为不一致 | 中 | 高 | 抽象 `Accel`，保留 TCG 与 Hyper-V 分支；CI 覆盖多个 Windows 版本 |
| 镜像体积大导致首次体验差 | 高 | 中 | 分块下载加断点续传与后台预取；先给精简镜像快速可用 |
| ARM64 Mac 需要另一套镜像与参数 | 高 | 中 | 镜像与参数按 (os, arch) 分开维护，v1 不做兼容层 |
| 模型工具调用不稳定 | 高 | 中 | 参数 JSON Schema 校验、失败重试、明确错误回灌给模型 |
| 快照占满用户磁盘 | 中 | 中 | 快照配额、LRU 清理、UI 显示占用 |
| 长任务中断后体验差 | 中 | 中 | 任务事件重放加检查点机制，恢复时提示 |

---

## 14. 附录

### 14.1 环境变量与路径

| 名称 | 默认值 | 说明 |
|---|---|---|
| `MUSE_DATA_DIR` | `%APPDATA%/muse-local` | 数据根目录 |
| `MUSE_IMAGES_DIR` | `<data>/images` | 基础镜像 |
| `MUSE_COMPUTERS_DIR` | `<data>/computers` | 每台电脑的磁盘与运行时文件 |
| `MUSE_MAX_COMPUTERS` | 3 | 并发电脑上限 |
| `MUSE_TCG_FALLBACK` | true | 无硬件加速时是否允许 TCG |

### 14.2 工具清单（v1）

| 工具 | 参数 | 风险级 |
|---|---|---|
| `fs_read` / `fs_write` / `fs_list` | path, content | 低 |
| `shell_exec` | cmd, cwd, timeout | 中（按命令内容升级） |
| `python_exec` | code | 中 |
| `browser_goto` / `browser_click` / `browser_type` / `browser_screenshot` / `browser_extract` | url / selector / text | 低 |
| `gui_screenshot` / `gui_click` / `gui_type` / `gui_key` | coords / text / key | 中 |
| `clipboard_get` / `clipboard_set` | — | 低 |
| `host_share_read` / `host_share_write` | path | 高（默认 Ask） |
| `ask_user` | question, options | 低 |
| `task_finish` | summary, artifacts | 低 |

字段级定义见 `docs/TOOLS.md`。

### 14.3 后续路线

- v1.1：热快照、多显示器、文件拖拽双向传输；
- v1.2：WebRTC 画面（低延迟）、macOS 支持；
- v1.3：本地小模型旁路（简单工具调用不耗 API）；
- v2.0：可选常驻服务或远程执行节点，实现「关机后仍运行」，此时才需要额外算力资源。

---

*变更记录：v0.1 首版骨架，2026-10-30。*
