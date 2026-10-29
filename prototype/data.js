/* ══════════════════════════════════════════════════
   Muse Local · 原型数据（全部为本地模拟数据）
   ══════════════════════════════════════════════════ */

const PROVIDERS = [
  { id:'anthropic', name:'Anthropic', short:'A', kind:'anthropic',
    base:'https://api.anthropic.com', key:'sk-ant-•••••••••••••3f2a',
    models:['claude-fable-5-1','claude-opus-5-5','claude-sonnet-5-5'], on:true },
  { id:'openai', name:'OpenAI', short:'O', kind:'openai',
    base:'https://api.openai.com/v1', key:'sk-•••••••••••••91c4',
    models:['gpt-5.1','gpt-5-mini'], on:true },
  { id:'deepseek', name:'DeepSeek', short:'D', kind:'openai-compatible',
    base:'https://api.deepseek.com', key:'',
    models:['deepseek-chat','deepseek-reasoner'], on:false }
];

/* 只有一台电脑，软件启动时创建好，所有对话共用。无图形桌面。 */
const COMPUTER = {
  id:'vm', name:'ubuntu-01', status:'running',
  desktop:false,
  spec:{ vcpu:2, mem:8192, disk:150, accel:'WHPX' },
  base:'ubuntu-24.04.5 LTS', created:'今天 09:02',
  ports:{ ssh:22001, agent:22002, vnc:22003 }
};

/* 电脑的实查清单 */
const MACHINE = {
  sys:[
    ['系统','Ubuntu 24.04.5 LTS · x86_64'],
    ['内核','Linux 7.0.0-39-generic'],
    ['CPU','2 核 · AMD EPYC 9D64'],
    ['内存','7.7 GB'],
    ['磁盘','主目录 150 GB（149 GB 可用）· /tmp 512 MB'],
    ['Shell','bash 5.2.21 · zsh 5.9 · tmux'],
    ['桌面','没有图形桌面，只转播应用窗口']
  ],
  groups:[
    { g:'开发语言与构建', items:['Python 3.12.3','pip 24.0','Node.js 24.22.1','npm 10.9.4','Bun 1.4.4','GCC 13.3.0','G++ 13.3.0','Make 4.3','CMake 3.28.3','Git 2.43.0'] },
    { g:'媒体与网络', items:['ffmpeg 8.1.2','ffprobe 8.1.2','curl 8.5.0','wget 1.21.4','jq 1.7','sqlite3 3.45.1','rsync 3.2.7','ssh / scp','tar / zip / unzip'] },
    { g:'Python 库', items:['numpy 1.26.4','pandas 2.1.4','SciPy 1.11.4','sympy 1.12','matplotlib 3.6.3','seaborn','plotly 5.15.0','openpyxl 3.1.2','python-docx 1.1.0','Pillow 10.2.0','lxml 5.2.1','requests 2.31.0','PyYAML 6.0.1'] }
  ],
  missing:['Go','Rust','Java','Docker','kubectl','Terraform','AWS / Azure / GCP CLI'],
  services:['Gmail','Google 日历','Google 文档','Google 云端硬盘','Google 表格','Google 幻灯片','Google 任务',
    'Outlook 邮件','Outlook 日历','Outlook 联系人','GitHub','Slack','Notion','Dropbox','Box','Evernote',
    'Figma','Canva','Spotify','Instagram','Facebook','Threads','Messenger','Meta 广告','Duffel 机票',
    'FlightAware','Ticketmaster','OpenTable','Shopify','Shop Pay','Stripe','Plaid','QuickBooks',
    '1Password','Tailscale','Apple Health','Peloton','Philips Hue'],
  skills:[
    'advertising-campaigns','app-creation','business-finance','customer-outreach','device-data',
    'documents','email-management','event-tickets','file-hosting','financial-planning','fitness-tracking',
    'flight-booking','flight-tracking','form-design','generate_podcast','goals','groceries','health-review',
    'home-control','home-search','hotel-booking','image-search','knowledge-organization','marketplaces',
    'media-library','meeting-follow-up','messaging','mortgage-comparison','music-discovery','place-discovery',
    'restaurant-reservations','scheduling','shopping','social-content-performance','social-publishing',
    'spoken-audio','store-operations','style-tryon','subscription-status','task-management','translation',
    'trip-planning','trip-transport','wearables-comms','wide-research','workout-planning'
  ]
};

/* 工具权限：allow=直接执行 / ask=每次确认 / deny=禁止 */
const TOOL_POLICY = [
  { tool:'fs_read',          desc:'读取电脑上的文件',            lv:'allow' },
  { tool:'fs_write',         desc:'写入电脑上的文件',            lv:'allow' },
  { tool:'browser_*',        desc:'浏览器操作（真实 Chromium）',  lv:'allow' },
  { tool:'clipboard_*',      desc:'读写剪贴板',                  lv:'allow' },
  { tool:'shell_exec',       desc:'执行 Shell 命令',             lv:'ask'   },
  { tool:'python_exec',      desc:'执行 Python 代码',            lv:'ask'   },
  { tool:'host_share_write', desc:'写入宿主共享目录',            lv:'ask'   },
  { tool:'rm_recursive',     desc:'递归删除（rm -rf）',          lv:'deny'  }
];

const DOMAINS = ['news.ycombinator.com','www.google.com','github.com','*.githubusercontent.com','pypi.org','docs.python.org'];

const TASKS = [
  { id:'t-1043', title:'打开浏览器并整理 Hacker News 今日 AI 新闻', status:'running',
    model:'claude-fable-5-1', dur:'2m 14s', tok:'48.2k', cost:'$0.42', when:'刚刚' },
  { id:'t-1042', title:'在 GitHub 搜索 Tauri 2 + QEMU 示例并总结差异', status:'done',
    model:'claude-fable-5-1', dur:'6m 02s', tok:'112.4k', cost:'$0.96', when:'今天 09:41' },
  { id:'t-1041', title:'把这周的发票 PDF 合并成一张汇总表', status:'done',
    model:'gpt-5.1', dur:'3m 28s', tok:'64.1k', cost:'$0.51', when:'昨天 18:20' },
  { id:'t-1040', title:'登录供应商后台下载对账单', status:'waiting',
    model:'claude-fable-5-1', dur:'1m 09s', tok:'22.8k', cost:'$0.19', when:'昨天 17:55' },
  { id:'t-1039', title:'批量重命名工作区里的图片文件', status:'failed',
    model:'claude-sonnet-5-5', dur:'0m 41s', tok:'9.3k', cost:'$0.04', when:'昨天 15:12' }
];

const TASK_STATS = [
  { k:'任务总数', v:'128', u:'次' },
  { k:'成功率',  v:'96',  u:'%' },
  { k:'本月 Token', v:'3.42', u:'M' },
  { k:'本月费用', v:'38.20', u:'USD' }
];

const SNAPSHOTS = [
  { id:'s1', name:'Google 首页加载完成', tm:'今天 09:12', kind:'窗口快照' },
  { id:'s2', name:'初始干净状态',        tm:'昨天 20:03', kind:'基础快照' }
];

const ENV_CHECKS = [
  { name:'CPU 虚拟化支持', val:'Intel VT-x 已开启', st:'ok' },
  { name:'虚拟化平台功能', val:'HypervisorPlatform = Enabled', st:'ok' },
  { name:'可用内存',       val:'15.6 GB 可用（需要 8 GB）', st:'ok' },
  { name:'磁盘空间',       val:'D: 剩余 214 GB（需要 150 GB）', st:'ok' },
  { name:'QEMU 后端',      val:'qemu-system-x86_64 8.2.0 · WHPX 可用', st:'ok' },
  { name:'回环端口池',     val:'22001-22003 可用', st:'ok' }
];

const SUGGESTS = [
  '打开浏览器访问 Google 首页，看看能不能正常显示',
  '帮我在 Hacker News 上整理今天最热的 5 条 AI 新闻，存成 Excel',
  '用 ffmpeg 把工作区里的视频压到 720p，顺便加字幕',
  '在 GitHub 上找 3 个 Tauri 2 插件示例并总结它们做了什么'
];

/* ── 演示任务脚本 ── */
const DEMO = {
  title:'打开浏览器并整理 Hacker News 今日 AI 新闻',
  steps:[
    { t:'assistant', think:800, text:'好的。这台电脑没有桌面，我先打开浏览器，窗口会直接出现在右边。' },

    { t:'tool', tool:'browser_open', screen:'chrome-loading', dur:1100,
      args:{ url:'https://news.ycombinator.com' },
      result:'Chromium 已启动 · 窗口画面开始转播' },

    { t:'note', text:'窗口出现后，画面会实时同步到右侧' },

    { t:'tool', tool:'browser_goto', screen:'chrome-hn', dur:1200, cursor:{x:640,y:300},
      args:{ url:'https://news.ycombinator.com' },
      result:'HTTP 200 · 地址 news.ycombinator.com · 标题「Hacker News」· 加载 412 ms' },

    { t:'snapshot', screen:'chrome-hn', caption:'浏览器窗口快照' },

    { t:'tool', tool:'browser_extract', screen:'chrome-hn', dur:1000,
      args:{ selector:'.titleline', fields:['title','points'] },
      result:'提取到 30 条条目，已按热度排序' },

    { t:'assistant', think:600, text:'抓到 30 条，其中 5 条与 AI 直接相关。写表格前需要装一个 Excel 库。' },

    { t:'approval', id:'a1', tool:'shell_exec', risk:'中',
      args:{ cmd:'pip install --user openpyxl' },
      reason:'shell_exec 被设置为每次确认。安装 Python 包会修改这台电脑的运行环境。',
      onAllow:[
        { t:'exec', tool:'shell_exec', dur:5200, cmd:'pip install --user openpyxl',
          out:'Collecting openpyxl\n  Downloading openpyxl-3.1.2-py2.py3-none-any.whl (250 kB)\nSuccessfully installed et-xmlfile-2.0.0 openpyxl-3.1.2' }
      ],
      onDeny:[
        { t:'assistant', think:400, text:'好的，那我不装新库，改用标准库直接生成 CSV。' },
        { t:'exec', tool:'python_exec', dur:1400, cmd:'python3 scrape.py --format csv',
          out:'写入 hn-ai-news.csv\n✓ /home/muse/workspace/hn-ai-news.csv · 5 行' }
      ]
    },

    { t:'exec', tool:'python_exec', dur:2200, cmd:'python3 scrape.py',
      out:'读取 news.ycombinator.com …\n筛出 5 条 AI 相关条目\n\n  1  Anthropic 发布新的 Agent 沙箱隔离规范        412\n  2  Show HN: 用 Rust 重写一个本地虚拟机管理器     356\n  3  关于提示注入攻击的最新研究综述               298\n  4  Playwright 2.0 发布：原生支持视觉定位        241\n  5  轻量级 Linux 桌面在 AI Agent 场景下的取舍    187\n\n✓ /home/muse/workspace/hn-ai-news.xlsx · 11.2 KB' },

    { t:'assistant', think:700, text:'表格生成好了。我想同时放一份到你的桌面，这样不打开软件也能看到 —— 这需要写入宿主共享目录。' },

    { t:'approval', id:'a2', tool:'host_share_write', risk:'高',
      args:{ path:'/mnt/host/Desktop/hn-ai-news.xlsx' },
      reason:'写入宿主共享目录会影响软件之外的文件系统，默认只读，因此需要你确认。',
      onAllow:[
        { t:'exec', tool:'host_share_write', dur:900,
          cmd:'cp hn-ai-news.xlsx /mnt/host/Desktop/',
          out:'✓ 已写入宿主桌面 · 11.2 KB' },
        { t:'assistant', think:300, text:'已经放一份到你的桌面了。' }
      ],
      onDeny:[
        { t:'assistant', think:400, text:'好的，我只保存在电脑的工作区里。' }
      ]
    },

    { t:'exec', tool:'fs_write', dur:700, cmd:'ls -lh ~/workspace',
      out:'-rw-r--r-- 1 muse muse 11468 hn-ai-news.xlsx\n-rw-r--r-- 1 muse muse  1436 scrape.py\n-rw-r--r-- 1 muse muse   820 notes.md' },

    { t:'summary', dur:'2m 14s', tokIn:48200, tokOut:3120, cost:'$0.42',
      artifacts:[
        { name:'hn-ai-news.xlsx', path:'/home/muse/workspace/', size:'11.2 KB' }
      ] }
  ]
};

/* 短任务：只把浏览器打开停在 Google 首页，方便接管后自己点 */
const DEMO_GOOGLE = {
  title:'打开浏览器访问 Google 首页',
  steps:[
    { t:'assistant', think:600, text:'好的，我在电脑里打开浏览器。窗口会出现在右边，加载完你就能看到 Google 首页。' },
    { t:'tool', tool:'browser_open', screen:'chrome-loading', dur:1000,
      args:{ url:'https://www.google.com' },
      result:'Chromium 已启动 · 窗口画面开始转播' },
    { t:'tool', tool:'browser_goto', screen:'chrome-google', dur:1100, cursor:{x:300,y:120},
      args:{ url:'https://www.google.com' },
      result:'HTTP 200 · 地址 www.google.com · 标题「Google」' },
    { t:'snapshot', screen:'chrome-google', caption:'浏览器窗口快照' },
    { t:'note', text:'点右上角「接管窗口」，就能自己在画面里点击和输入' },
    { t:'summary', dur:'0m 12s', tokIn:8200, tokOut:640, cost:'$0.06', artifacts:[] }
  ]
};
