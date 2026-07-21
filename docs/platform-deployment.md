# KunAI Studio 平台模式部署

平台模式由当前仓库独立提供账户、邮箱验证、权限、人民币余额、账本和上游中转，不需要安装、启动或连接 KunAI-NewAPI。KunAI 仅曾作为 SMTP 配置命名的参考，不是运行时组件。

```text
Browser
  ├─ /api/platform/*              注册、登录、模型目录、Tavily 搜索、余额、支付回调
  ├─ /api-proxy/images/*          图片生成与编辑
  └─ /api-proxy/responses         Agent Responses 请求
                  │
                  ▼
KunAI Studio Node BFF
  ├─ SQLite           用户、Session、验证码、人民币余额、计费轮次、生成任务、账本
  ├─ Result directory 已结算图片响应，用于幂等重放与断线恢复
  ├─ SMTP             注册与密码重置验证码
  ├─ Image upstream   OpenAI-compatible 图片接口
  ├─ Agent upstream   独立 OpenAI-compatible Responses API 与 /models 目录
  └─ Tavily           独立 search_web 搜索
```

## 本地运行

要求 Node.js 22 或更高版本：

```bash
npm install
npm run dev
```

开发服务器同时启动前端 `http://localhost:5173` 和 BFF `http://localhost:3001`。不配置 SMTP 时，验证码只会在非生产环境返回给页面并自动填入；这条开发路径在 `NODE_ENV=production` 下不可用。

复制 `.env.example` 为 `.env.local` 后至少修改：

```dotenv
APP_ORIGIN=http://localhost:5173
PLATFORM_AUTH_SECRET=replace-with-a-random-secret-at-least-32-characters
PLATFORM_ADMIN_EMAILS=admin@example.com

IMAGE_UPSTREAM_BASE_URL=https://relay.example.com/v1
IMAGE_UPSTREAM_API_KEY=
PLATFORM_IMAGE_MODEL=gpt-image-2

AGENT_UPSTREAM_BASE_URL=https://agent-relay.example.com/v1
AGENT_UPSTREAM_API_KEY=
PLATFORM_AGENT_MODEL=gpt-5.5
PLATFORM_AGENT_MAX_OUTPUT_TOKENS=4096
PLATFORM_AGENT_INPUT_PRICE_CNY_PER_M=15
PLATFORM_AGENT_CACHED_INPUT_PRICE_CNY_PER_M=1.5
PLATFORM_AGENT_OUTPUT_PRICE_CNY_PER_M=120
PLATFORM_AGENT_MAX_STEP_RESERVE_CNY=100
PLATFORM_AGENT_AUTO_ENABLE_MODELS=gpt-5.5
PLATFORM_AGENT_INPUT_TOKEN_OVERHEAD=8192
PLATFORM_AGENT_ROUND_STEP_LIMIT=16
PLATFORM_MAX_AGENT_BODY_MB=4

TAVILY_API_KEY=
PLATFORM_SEARCH_PRICE_CNY=0.10
PLATFORM_SEARCH_ROUND_LIMIT=12
```

`IMAGE_UPSTREAM_BASE_URL` 只承载图片生成与编辑。BFF 会追加 `images/generations` 或 `images/edits` 并使用服务端 Bearer API Key；上游必须支持 `response_format=b64_json`。平台会固定图片模型、`n=1` 和非流式返回。

`AGENT_UPSTREAM_BASE_URL` 是独立的 OpenAI-compatible Agent 上游，BFF 使用它的 `/responses` 处理对话，并从 `/models` 动态发现模型。图片与 Agent 可以使用不同供应商、地址和密钥；生产环境启用 Agent 时应显式配置 `AGENT_UPSTREAM_BASE_URL` 与 `AGENT_UPSTREAM_API_KEY`，不要依赖旧版与图片上游共用配置的兼容回退。

`IMAGE_UPSTREAM_API_KEY`、`AGENT_UPSTREAM_API_KEY` 和 `TAVILY_API_KEY` 都只由 Node 服务读取，不得使用 `VITE_*` 变量，也不会写入浏览器、SQLite 或响应日志。文档示例故意将密钥留空；请通过部署环境或 Secret Manager 注入，禁止提交到仓库。

中转按分辨率提供不同模型时，可配置 `PLATFORM_IMAGE_MODEL_1K`、`PLATFORM_IMAGE_MODEL_2K` 和 `PLATFORM_IMAGE_MODEL_4K`。服务端根据请求尺寸的总像素自动选择对应档位，并继续忽略浏览器传入的模型名；未配置的档位会向下回退，最终使用 `PLATFORM_IMAGE_MODEL`。成功响应还会核验实际图片宽高至少达到请求宽高的 90%，并限制宽高比偏差不超过 12%；低档图片冒充 2K/4K 时任务失败并释放预留次数，不会扣费。

## Agent 模型目录与 token 计费

Agent 模型不再维护为前端静态列表。BFF 从独立 Agent 上游的 `GET /models` 获取目录，只接受合法的 `gpt-*` 模型；若上游提供 `supported_endpoint_types`，还必须包含 `openai`。目录默认缓存 10 分钟，刷新失败时可继续使用最近一次成功快照。

发现模型后，管理员在「Agent 模型与定价」后台决定是否启用、排序及默认模型，并分别配置。上游目录刷新时已消失的模型会自动变为不可选并取消默认状态；其历史配置和已锁定会话记录仍保留，重新发现后才能再次启用：

- 普通输入 token 单价；
- 缓存输入 token 单价；
- 输出 token 单价；
- 单次 Responses 调用的预留金额硬上限。

前三项价格单位均为“人民币元 / 百万 token”，金额在数据库中以整数微人民币存储。只有启用且四项价格完整的模型才可供用户选择；一个会话首次选定模型后会锁定该模型，避免后续轮次切换价格策略。

模型发现本身不会授权使用。`PLATFORM_AGENT_INPUT_PRICE_CNY_PER_M`、`PLATFORM_AGENT_CACHED_INPUT_PRICE_CNY_PER_M`、`PLATFORM_AGENT_OUTPUT_PRICE_CNY_PER_M` 和 `PLATFORM_AGENT_MAX_STEP_RESERVE_CNY` 只是首次发现时使用的统一初始定价；只有四项都已配置，并且新模型的完整 ID 明确列入逗号分隔的 `PLATFORM_AGENT_AUTO_ENABLE_MODELS` 白名单，该模型才会在首次入库时自动启用。白名单留空时不自动启用任何新模型；未命中的新模型保持禁用且不带价格，已入库模型之后仍由管理员显式定价和启用。示例把 `gpt-5.5` 列入白名单，并把单步硬上限设为 ¥100；生产环境应按实际供应商价格和可接受风险逐个配置。

Agent 请求使用独立于图片中转的大小限制，`PLATFORM_MAX_AGENT_BODY_MB=4` 表示 JSON 请求体默认最多 4 MB；图片请求仍使用单独的 `PLATFORM_MAX_RELAY_BODY_MB`。前端优先使用持久化缩略图，并按“当前轮、最近轮优先”把每次 Agent 请求中的图片 data URL 控制在约 2 MiB；被裁剪的引用会显式标记为不可用，不会打乱引用编号。不要仅为了容纳无限增长的历史上下文而随意提高 Agent 上限。

每次 Responses 调用不会直接冻结完整的单步上限。服务端按规范化 JSON 的字节数、`PLATFORM_AGENT_INPUT_TOKEN_OVERHEAD` 输入 token 安全余量，以及受 `PLATFORM_AGENT_MAX_OUTPUT_TOKENS` 约束的最大输出 token，使用普通输入与缓存输入价格中的较高者动态计算保守预留。估算值超过该模型已保存的单步硬上限时，请求会在调用上游前被拒绝；否则只预留估算值。`PLATFORM_AGENT_MAX_STEP_RESERVE_CNY` 是新模型首次发现时写入该上限的种子值，不会覆盖管理员后续的逐模型配置。成功响应必须带可核验的 `usage.input_tokens`、`usage.input_tokens_details.cached_tokens` 和 `usage.output_tokens`，实际费用按“非缓存输入 + 缓存输入 + 输出”三部分分别计算后结算，多余预留立即释放；失败、超时、缺少可核验 usage 或实际费用异常超过预留时不向用户结算。

同一用户可见轮次内的 Agent Responses 调用还有独立硬上限，默认 `PLATFORM_AGENT_ROUND_STEP_LIMIT=16`。明确失败并释放预留的调用不占成功步骤额度，因此前端可用新幂等键重试；但总尝试次数仍被限制为步骤上限的两倍，不能通过持续更换步骤 ID 绕过。Agent 对话本身不消耗生图次数，只有 Agent 实际调用图片工具并成功生成图片时才进入下文的生图次数规则。

## Tavily 独立搜索与按次计费

平台模式开启网络搜索后，Agent 使用自定义 `search_web` 工具，由 BFF 通过 `TAVILY_API_KEY` 调用 Tavily，不再把平台搜索交给 Responses 上游的内置 `web_search`。服务端固定 Tavily `basic` 搜索、最多 5 条结果，并关闭生成答案、原始网页正文、图片和自动参数，避免模型改变搜索档位或扩大响应。

每次搜索先从人民币余额预留 `PLATFORM_SEARCH_PRICE_CNY`，只有 Tavily 成功返回且结果完成安全解析时才按该固定单价结算；失败会释放预留。搜索调用使用 `call_id` 幂等，同一调用重放不会再次搜索或重复扣费。同一可见轮次最多搜索 `PLATFORM_SEARCH_ROUND_LIMIT` 次，默认硬上限为 12；达到上限后，本轮后续新搜索会被拒绝。默认每用户 10 次/分钟、100 次/日，全局并发 8，可通过 `PLATFORM_SEARCH_MINUTE_LIMIT`、`PLATFORM_SEARCH_DAILY_LIMIT`、`PLATFORM_SEARCH_MAX_CONCURRENT` 调整。搜索费用与 Tavily 返回的 API credits 会同时记入 Agent 计费轮次，但用户侧扣费仍以配置的人民币单次价格为准。

## 邮箱验证

SMTP 使用 Nodemailer，由 KunAI Studio 直接连接邮件服务器：

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@example.com
SMTP_PASS=smtp-password
SMTP_FROM=KunAI Studio <no-reply@example.com>
```

为了迁移已有环境变量，也接受 `SMTP_SERVER`、`SMTP_ACCOUNT`、`SMTP_TOKEN` 和 `SMTP_SSL_ENABLED` 别名。这些别名只做本地配置映射，不会连接 KunAI 服务。TLS 证书始终校验，不提供跳过证书验证的选项。

验证码保存在 SQLite 中，只保存带服务端密钥的 HMAC。验证码绑定注册或密码重置用途，默认 10 分钟有效、60 秒重发冷却、最多尝试 5 次，并在成功后单次消费。

可选配置 Cloudflare Turnstile：

```dotenv
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

两个值必须同时配置，每次登录、发码、注册或重置密码都会独立校验。

## 权限模型

- `role >= 1`：普通用户，默认允许图片生成。
- `role >= PLATFORM_AGENT_MIN_ROLE`：允许 Agent。
- `role >= 10`：管理员，可从账户菜单进入“用户与权限”，调整角色、状态、用户组和余额。
- `status = 0`：停用；服务端立即撤销该用户全部 Session。
- `PLATFORM_ALLOWED_GROUPS`：可选用户组白名单，留空时允许所有组。

管理员身份只通过 `PLATFORM_ADMIN_EMAILS` 显式授予，不会把首个注册用户自动提升为管理员。该列表中的既有账户会在服务启动时提升为管理员并撤销旧 Session。角色、状态和用户组以服务端 SQLite 当前值为准，前端字段不参与授权。

Session Cookie 是 256-bit 随机 opaque token，数据库只保存 SHA-256。生产环境使用 `Secure; HttpOnly; SameSite=Lax`，所有状态修改和中转请求还会校验固定 Origin 与 CSRF token。

## 按成功图片消费次数

图片生成不再从人民币余额按张扣款。新用户需要购买或获赠生图次数；仍在有效期内的历史会员保留不限次生图资格。每个图片请求执行以下流程：

1. 服务端强制固定模型、`n=1`、`stream=false` 和 `b64_json`。
2. SQLite 事务检查历史会员资格；非会员冻结 1 次生图次数。没有次数时直接拒绝，不使用人民币余额兜底。
3. BFF 使用服务端 API Key 调用第三方中转。
4. 只有 HTTP 2xx 且图片可完整解码为 PNG、JPEG 或 WebP、像素数不超过 `PLATFORM_MAX_IMAGE_PIXELS` 时，才把规范化响应原子写入 `PLATFORM_RESULT_DIR`。
5. 结果文件完成 flush 和重命名后记录 SHA-256；SQLite 事务随后扣除已冻结的 1 次并写入唯一账本。历史会员生成只记录成功次数，不扣余额或次数。
6. 非 2xx、超时、空结果、损坏图片或格式错误均释放冻结次数，不产生消费。

浏览器为每个单图请求生成幂等标识，并随任务持久化到 IndexedDB。若提交后的响应丢失，页面会使用 `GET /api/platform/generations/:id` 查询；页面刷新或重试也会复用原标识。已结算任务直接返回 `PLATFORM_RESULT_DIR` 中保存且通过哈希校验的结果，不会再次调用上游或重复扣费。服务进程重启时，尚未完成结算的任务会标记失败并释放冻结额度。

`PLATFORM_RESULT_DIR` 不是临时缓存：删除结果文件会导致已结算任务无法恢复。该目录必须与 `PLATFORM_DB_PATH` 一起放在持久卷中，并纳入一致的备份和恢复流程。BFF 在调用上游前和落盘前检查可用空间；低于 `PLATFORM_RESULT_MIN_FREE_MB`（默认 512 MB）时返回 507，不冻结或扣除额度。`PLATFORM_MAX_IMAGE_PIXELS` 默认 40000000，用于限制解码图片的像素数。

SQLite 部署必须保持单实例：同一 `PLATFORM_DB_PATH` 和 `PLATFORM_RESULT_DIR` 只能由一个 KunAI Studio Node 进程或容器副本提供服务，即使底层是共享卷也不能让多个副本同时打开同一 SQLite 数据库。应用的启动恢复、余额预留、轮次硬上限和部分限流状态都按单实例设计。需要滚动发布时，应先停止旧副本再启动新副本；需要水平扩容时，必须先把账户、余额、计费轮次、任务、幂等记录和账本迁移到支持并发事务的共享数据库，同时把结果文件迁移到所有实例可访问且支持原子写入的共享存储，并补齐跨实例协调。

## 计费边界：余额、次数与历史会员

三类权益用途彼此隔离：

1. **人民币余额**：只用于 Agent token 费用、Tavily 搜索费用及其他明确标注的现金计费项，不用于生图兜底。
2. **生图次数**：每张成功图片扣 1 次，是当前唯一可购买的生图商品。次数不能抵扣 Agent 或搜索费用。
3. **历史会员**：旧系统中尚未过期的会员只映射为不限次生图资格；不免除 Agent token 费用，也不免除 Tavily 搜索费用。会员商品已停止销售，到期后需购买生图次数。

生图次数包由管理员在「商品与定价」后台维护，商品价格单位为人民币，上架商品价格必须大于 `0`。商品发布后，价格、次数、类型和有效期等结算条款不可修改；调价或调整次数时应创建新的商品 ID，再下架旧商品。删除操作只会软下架并保留原条款，以便下架前已经创建且仍在有效期内的结算意向按原价安全结算。新建或上架会员商品会被拒绝；既有会员商品在迁移时下架。管理员仍可为兼容历史业务查看或调整用户的会员到期时间，也可赠送次数或调整人民币余额，但三者用途仍遵循上面的隔离规则。

所有现金金额以整数微人民币存储，`1` 元对应 `1,000,000` 微人民币。生图次数是独立整数钱包，不与现金金额互转。

### 旧 USD 数据的一次性迁移

数据库首次升级到人民币计费版本时，会在单个 SQLite 事务中按固定汇率 `1 USD = 7.2 CNY` 转换旧余额、冻结额、累计用量、历史任务价格、账本、支付事件、商品价格和兑换码余额。迁移完成后写入 `platform_metadata` 标记，后续启动不会重复换算；该汇率只用于这次历史数据迁移，不是持续汇率或支付换汇功能。

旧会员不会折算为人民币余额或生图次数，只在原到期日前继续提供生图资格；Agent 与搜索从迁移后的人民币余额正常计费。升级前应备份 `PLATFORM_DB_PATH`，升级后不要用旧版本程序打开已经迁移的数据库。

## Dulupay V2 支付

当前支付通道对接 Dulupay V2，使用 `application/x-www-form-urlencoded`、RSA `SHA256WithRSA` 签名和人民币元金额。商户私钥只保存在服务端；平台公钥用于验签 Dulupay 的下单响应、主动查单响应和异步通知。

生产环境配置：

```dotenv
DULUPAY_ENABLED=true
DULUPAY_API_BASE=https://api.dulupay.com
DULUPAY_PID=<商户 ID>
DULUPAY_MERCHANT_PRIVATE_KEY=<PKCS#8 商户私钥>
DULUPAY_PLATFORM_PUBLIC_KEY=<X.509 平台公钥>
DULUPAY_NOTIFY_URL=https://image.kunai.one/api/platform/payment/dulupay/notify
DULUPAY_RETURN_URL=https://image.kunai.one/
DULUPAY_METHOD=qrcode
PLATFORM_RECHARGE_MIN_CNY=1
PLATFORM_RECHARGE_MAX_CNY=5000
```

`DULUPAY_NOTIFY_URL` 必须能被 Dulupay 从公网访问，生产环境必须使用 HTTPS。商户后台还需要把正式站点加入授权支付域名。启用通道但缺少 PID、商户私钥、平台公钥或回调地址时，服务会拒绝启动，避免带着残缺支付配置上线。

购买次数包时，前端以当前 Session、同源校验和 CSRF 令牌调用：

```http
POST /api/platform/payment/checkout
Content-Type: application/json
X-CSRF-Token: <当前 Session 的 CSRF token>

{"product_id":"credits-100","pay_type":"wxpay"}
```

余额充值使用同一个接口，但只提交两位小数以内的人民币金额：

```http
POST /api/platform/payment/checkout
Content-Type: application/json
X-CSRF-Token: <当前 Session 的 CSRF token>

{"amount":"20.00","pay_type":"alipay"}
```

`pay_type` 只允许 `wxpay` 或 `alipay`。服务端先创建 30 分钟有效的随机结算意向：次数包会快照用户、商品、名称、精确人民币价格和次数；余额充值会快照用户与充值金额。随后服务端以该不可猜测的意向 ID 作为 Dulupay `out_trade_no`，签名调用 `POST https://api.dulupay.com/api/pay/create`，并默认使用 `method=qrcode`。验签后的 `pay_type=qrcode/scan` 响应会把 `pay_info` 作为二维码内容；若商户后台只返回 `pay_type=jump/h5`，则校验 HTTPS 收银台地址并将该地址生成二维码。前端只拿到二维码展示内容与本地结算意向，拿不到商户私钥、签名原文或用户邮箱。

用户在站内支付弹窗扫码，弹窗每 2.5 秒调用一次主动查单，页面隐藏、弹窗关闭、订单过期或支付完成后停止查询。Dulupay 平台订单号、本站订单号、支付渠道、金额、商品快照和状态保存在服务端；浏览器不能把订单直接改成已支付。

Dulupay 支付成功后 GET：

```http
GET /api/platform/payment/dulupay/notify?...&trade_status=TRADE_SUCCESS&sign_type=RSA&sign=...
```

回调处理顺序固定为：

1. 使用 Dulupay 平台公钥验签全部非空字段，并兼容平台新增扩展字段。
2. 校验 `pid`、`sign_type=RSA`、10 位时间戳偏差及 `trade_status=TRADE_SUCCESS`。
3. 用 `out_trade_no` 查找本站结算意向，逐分比对金额和用户归属。
4. 在同一个 SQLite 事务中写入支付事件、发放生图次数或增加人民币余额，并标记意向已支付。
5. 成功或同一订单的合法重试返回纯文本 `success`；无效通知返回 `fail`。

`provider + trade_no` 在数据库中唯一，相同订单重复通知不会重复到账；同一个结算意向也不能换一个平台订单号再次入账。浏览器从 Dulupay 返回本站后，会使用结算意向调用 `POST /api/platform/payment/recheck` 主动查询 `POST https://api.dulupay.com/api/pay/query`，只接受经过平台公钥验签且 PID、订单号、金额均匹配的已支付结果。因此异步通知短暂延迟时仍可安全补单，浏览器回跳参数本身不会直接触发入账。

`PAYMENT_URL` 与 `PAYMENT_WEBHOOK_SECRET` 仅用于兼容旧的自建支付页；使用 Dulupay 时应保持为空，避免两个支付通道同时开放。

## 兑换码

兑换码由管理员在「管理中心 → 兑换码」创建，可组合发放生图次数、人民币余额和历史会员兼容权益，并配置批量数量、每码可使用次数、有效期和启停状态。只有 `role >= 10` 的账户可以调用管理接口，普通用户只能在「账户与账单」兑换。

`redemption_records` 以兑换码和用户建立唯一记录；兑换时使用 SQLite 立即事务，原子校验启用状态、有效期、总使用次数和当前用户历史，再写入兑换记录、账本与账户权益。同一用户重试不会重复到账，并发请求不能突破兑换码总使用次数。已经产生兑换记录的兑换码只允许停用，不提供物理删除或核心权益修改接口。

## 生产部署

```bash
npm ci
npm run build
npm start
```

生产环境必须配置：

- `APP_ORIGIN=https://image.kunai.one`
- 至少 32 字符随机 `PLATFORM_AUTH_SECRET`
- 完整 SMTP 配置
- HTTPS `IMAGE_UPSTREAM_BASE_URL` 与服务端图片 API Key
- 启用 Agent 时，HTTPS `AGENT_UPSTREAM_BASE_URL`、独立服务端 API Key，以及至少一个已启用且定价完整的 `gpt-*` 模型
- 明确审核 `PLATFORM_AGENT_AUTO_ENABLE_MODELS`，确认 4 MB Agent 请求上限、动态预留参数、单步金额上限及每轮 Agent/Search 硬上限符合预算
- 启用平台网络搜索时，服务端 `TAVILY_API_KEY` 与明确的人民币单次价格
- 启用支付时，完整的 Dulupay PID、商户私钥、平台公钥、公网 HTTPS 通知地址和回跳地址，并在商户后台配置授权支付域名
- 单个 Node 进程或容器副本，以及持久化且定期备份的 `PLATFORM_DB_PATH`、`PLATFORM_RESULT_DIR`
- 为结果卷设置监控，并按容量规划调整 `PLATFORM_RESULT_MIN_FREE_MB`

Docker 示例：

```bash
docker build -f deploy/Dockerfile -t kunai-studio .
docker run --rm -p 8080:8080 \
  --env-file .env.production \
  -v kunai-studio-data:/app/data \
  kunai-studio
```

入口代理需要传递 `X-Forwarded-Proto` 和原始 Host。只有代理会覆盖并清洗客户端转发头时，才设置 `PLATFORM_TRUST_PROXY=true`。

## BYOK 模式

原有纯前端模式仍保留：

```dotenv
VITE_PLATFORM_MODE=false
```

BYOK 模式不启动本地账户、统一权限、余额或服务端计费。
