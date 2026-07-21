# KunAI Studio

KunAI Studio 是面向个人创作者与企业团队的 AI 视觉创作工作台，提供图像生成、参考图编辑、多轮 Agent、联网搜索、资产管理、人民币计费、在线支付和管理后台。

本产品基于 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground) 的 MIT 许可代码进行二次开发。在原有图像创作能力之上，KunAI Studio 新增并维护品牌系统、平台账户、人民币计费、Dulupay 支付、多轮 Agent、Tavily 搜索、企业管理、生产部署与安全增强能力。

## 创作示例

![KunAI Studio 海岛人像创作示例](public/examples/beach-portrait.png)

> 海岛人像示例。示例素材仅用于展示产品能力；用于商业宣传前，应确保已经取得素材、人物肖像及生成内容所需的合法授权。

## 产品能力

- 图像创作：支持文生图、参考图编辑、1K / 2K / 4K 质量档位、格式选择和任务恢复。
- 智能 Agent：支持多轮对话、上下文图片引用、模型选择、分支重试和生成结果回流资产库。
- 联网搜索：Agent 模式可独立启用 Tavily 搜索，并按成功搜索次数计费。
- 账户与计费：生图次数、会员权益、对话余额、兑换码、账单和 Dulupay 支付。
- 企业管理：用户权限、商品定价、Agent 模型、兑换码和平台状态管理。
- 多端体验：桌面、平板与移动端自适应，支持浅色、星空深色主题和 PWA 安装。

## 技术架构

- 前端：React 19、Vite、TypeScript、Zustand、Tailwind CSS。
- 服务端：Node.js、SQLite、同源 API 中转、服务端 Session 和 CSRF 防护。
- 外部服务：OpenAI-compatible 图像/对话接口、Tavily、Dulupay、SMTP。

平台模式下，API 密钥、支付私钥与搜索密钥仅保存在服务端。浏览器只访问同源 `/api/platform/*` 接口。

## 本地开发

环境要求：Node.js 22 或更高版本、npm。

```bash
npm install
copy .env.example .env.local
npm run dev
```

默认访问地址：

- Web：`http://localhost:5173`
- 服务端：`http://localhost:3001`

请在 `.env.local` 中配置实际的上游接口、SMTP、Tavily 和 Dulupay 参数。不要提交该文件，也不要把任何服务端密钥写入 `VITE_*` 变量。

## 常用命令

```bash
npm run dev          # 同时启动前端与服务端
npm run build        # 类型检查并构建生产包
npm test             # 运行前端与服务端测试
npm run test:watch   # 监听前端测试
npm run licenses:generate # 更新生产依赖第三方许可清单
npm start            # 启动生产服务
```

## 生产部署

推荐使用仓库内的 Dockerfile：

```bash
docker build -f deploy/Dockerfile -t kunai-studio .
docker run -d \
  --name kunai-studio \
  --env-file .env.production \
  -p 8080:8080 \
  -v kunai-studio-data:/app/data \
  kunai-studio
```

生产环境必须持久化 SQLite 数据库与生成结果目录，并保证 SQLite 单实例运行。完整的环境变量、安全校验、反向代理和备份说明见 [平台部署文档](docs/platform-deployment.md)。

## 目录结构

```text
src/                  React 前端与状态管理
server/               账户、计费、支付、搜索和 API 中转
public/               PWA 与静态资源
deploy/               Docker 与反向代理配置
docs/                 部署和验收文档
scripts/              开发与测试辅助脚本
```

## 数据兼容

为避免已有用户升级后丢失账户、余额、任务和历史记录，部分早期数据库文件名、IndexedDB 名与 API 响应字段会继续兼容读取。这些标识不作为产品品牌对外展示。

## 许可与第三方声明

KunAI Studio 的产品品牌与新增业务实现由 KunAI Studio 维护。项目包含依据 MIT License 使用和修改的第三方代码，原始版权及许可文本保留在 [LICENSE](LICENSE)、[NOTICE](NOTICE) 与 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) 中，Web 发行包同时包含同内容的 `third-party-notices.txt`。
