# Image Studio 平台模式部署

平台模式由当前仓库独立提供账户、邮箱验证、权限、余额、账本和图片中转，不需要安装、启动或连接 KunAI-NewAPI。KunAI 仅曾作为 SMTP 配置命名的参考，不是运行时组件。

```text
Browser
  ├─ /api/platform/*  注册、登录、权限、余额、支付回调
  └─ /api-proxy/*     图片与 Agent 请求
          │
          ▼
Image Studio Node BFF
  ├─ SQLite           用户、Session、验证码、余额、生成任务、账本
  ├─ Result directory 已结算图片响应，用于幂等重放与断线恢复
  ├─ SMTP             注册与密码重置验证码
  └─ server-only key  第三方 OpenAI-compatible 中转
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
IMAGE_UPSTREAM_API_KEY=server-only-api-key
PLATFORM_IMAGE_MODEL=gpt-image-2
IMAGE_UNIT_PRICE=0.07
```

`IMAGE_UPSTREAM_BASE_URL` 填写第三方中转的 API 根地址，例如 `https://relay.example.com/v1`。BFF 会按请求追加 `images/generations`、`images/edits` 或 `responses`，并使用 Bearer API Key。中转必须兼容对应的 OpenAI 请求和响应格式；图片接口还必须支持 `response_format=b64_json`，平台模式会强制固定模型、`n=1` 和非流式返回。

`IMAGE_UPSTREAM_API_KEY` 只由 Node 服务读取，不得使用 `VITE_*` 变量，也不会写入浏览器、SQLite 或响应日志。未配置中转时，账户与管理页面仍可使用，但图片生成入口会显示“生成服务待配置”。

中转按分辨率提供不同模型时，可配置 `PLATFORM_IMAGE_MODEL_1K`、`PLATFORM_IMAGE_MODEL_2K` 和 `PLATFORM_IMAGE_MODEL_4K`。服务端根据请求尺寸的总像素自动选择对应档位，并继续忽略浏览器传入的模型名；未配置的档位会向下回退，最终使用 `PLATFORM_IMAGE_MODEL`。

## 邮箱验证

SMTP 使用 Nodemailer，由 Image Studio 直接连接邮件服务器：

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@example.com
SMTP_PASS=smtp-password
SMTP_FROM=Image Studio <no-reply@example.com>
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

## 按成功图片计费

金额全部使用整数微美元存储，`IMAGE_UNIT_PRICE=0.07` 对应 `70000` 微美元。每个图片请求执行以下流程：

1. 服务端强制固定模型、`n=1`、`stream=false` 和 `b64_json`。
2. SQLite 事务检查可用余额并冻结一张图片的单价。
3. BFF 使用服务端 API Key 调用第三方中转。
4. 只有 HTTP 2xx 且图片可完整解码为 PNG、JPEG 或 WebP、像素数不超过 `PLATFORM_MAX_IMAGE_PIXELS` 时，才把规范化响应原子写入 `PLATFORM_RESULT_DIR`。
5. 结果文件完成 flush 和重命名后记录 SHA-256；SQLite 事务随后释放冻结额、扣除余额并写入唯一账本。
6. 非 2xx、超时、空结果、损坏图片或格式错误均释放冻结额，不产生图片扣费。

浏览器为每个单图请求生成幂等标识，并随任务持久化到 IndexedDB。若提交后的响应丢失，页面会使用 `GET /api/platform/generations/:id` 查询；页面刷新或重试也会复用原标识。已结算任务直接返回 `PLATFORM_RESULT_DIR` 中保存且通过哈希校验的结果，不会再次调用上游或重复扣费。服务进程重启时，尚未完成结算的任务会标记失败并释放冻结额度。

`PLATFORM_RESULT_DIR` 不是临时缓存：删除结果文件会导致已结算任务无法恢复。该目录必须与 `PLATFORM_DB_PATH` 一起放在持久卷中，并纳入一致的备份和恢复流程。BFF 在调用上游前和落盘前检查可用空间；低于 `PLATFORM_RESULT_MIN_FREE_MB`（默认 512 MB）时返回 507，不冻结或扣除额度。`PLATFORM_MAX_IMAGE_PIXELS` 默认 40000000，用于限制解码图片的像素数。

SQLite 部署应保持单实例；多实例部署需要把账户、任务和账本迁移到 PostgreSQL 等共享数据库，同时把结果文件迁移到所有实例可访问且支持原子写入的共享存储。

## 计费：会员 / 次数 / 余额

平台支持三种计费方式，生成图片时按以下优先级消费：

1. **会员（membership）**：有效期内不限次生成，完全免费；到期后停用。
2. **次数包（credits）**：独立的「次数」钱包，每张成功图片扣 1 次。
3. **USD 余额（balance）**：以上都没有时，按 `IMAGE_UNIT_PRICE` 从余额扣费（原按量模式）。

会员套餐与次数包为**商品（products）**，由管理员在账户菜单的「商品与定价」后台增删改价，无需改环境变量。每个商品含：`id`、`kind`（`membership` 或 `credits`）、名称、价格（USD）、会员天数（`duration_days`）或赠送次数（`credits`）、上下架开关。用户在「账户与账单」弹窗中看到已上架商品并购买。管理员也可在「用户与权限」中为单个用户手动开通会员 / 赠送次数 / 调整余额。

金额仍以整数微美元存储；会员/次数的授予记入账本（`membership_payment`、`credits_payment`、`membership_grant`、`credit_grant`）。

## 支付回调

`PAYMENT_URL` 是账单页的支付入口。购买商品时前端跳转到 `PAYMENT_URL?product_id=<商品ID>&user_id=<用户ID>`。第三方支付完成后调用签名回调：

```http
POST /api/platform/payment/webhook
X-Payment-Signature: <hex hmac-sha256 of raw body>
Content-Type: application/json
```

购买会员 / 次数包（推荐）——带 `product_id`，金额由商品定义决定：

```json
{
  "provider": "internal",
  "order_id": "order-1001",
  "product_id": "pro-monthly",
  "user_id": 42,
  "currency": "USD",
  "status": "paid"
}
```

`user_id` 可用 `email` 代替。不带 `product_id` 时按 `amount` 充值 USD 余额（兼容旧流程）：

```json
{
  "provider": "internal",
  "order_id": "order-1002",
  "email": "user@example.com",
  "amount": "10.00",
  "currency": "USD",
  "status": "paid"
}
```

签名密钥为 `PAYMENT_WEBHOOK_SECRET`。`provider + order_id` 在数据库中唯一，支付平台重试同一事件不会重复开通或充值。

## 生产部署

```bash
npm ci
npm run build
npm start
```

生产环境必须配置：

- `APP_ORIGIN=https://studio.example.com`
- 至少 32 字符随机 `PLATFORM_AUTH_SECRET`
- 完整 SMTP 配置
- HTTPS `IMAGE_UPSTREAM_BASE_URL` 与服务端 API Key
- 持久化且定期备份的 `PLATFORM_DB_PATH`、`PLATFORM_RESULT_DIR`
- 为结果卷设置监控，并按容量规划调整 `PLATFORM_RESULT_MIN_FREE_MB`

Docker 示例：

```bash
docker build -f deploy/Dockerfile -t image-studio .
docker run --rm -p 8080:8080 \
  --env-file .env.production \
  -v image-studio-data:/app/data \
  image-studio
```

入口代理需要传递 `X-Forwarded-Proto` 和原始 Host。只有代理会覆盖并清洗客户端转发头时，才设置 `PLATFORM_TRUST_PROXY=true`。

## BYOK 模式

原有纯前端模式仍保留：

```dotenv
VITE_PLATFORM_MODE=false
```

BYOK 模式不启动本地账户、统一权限、余额或服务端计费。
