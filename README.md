# WaveChat — 实时聊天网站

一个功能完整的实时聊天应用，支持用户注册登录、好友系统、实时私聊/群聊、独立管理员后台。界面参考 Telegram 设计。

## 功能特性

- **用户系统**：注册、登录、JWT 身份验证、个人资料修改
- **好友系统**：用户名搜索、发送好友申请、接受/拒绝、好友列表
- **实时聊天**：基于 Socket.io 的实时私聊和群聊，支持多设备同步
- **群聊管理**：创建群聊、邀请成员、移除成员、退出群聊、成员列表
- **消息历史**：所有消息持久化存储到数据库，支持历史记录加载
- **管理员后台**：独立 `/admin` 页面，支持用户封禁/解封、群聊删除、消息审计、操作日志
- **安全机制**：密码 bcrypt 加密、JWT Token 认证、服务端权限校验、管理员操作审计

## 技术栈

- **后端**：Node.js + Express + Socket.io
- **数据库**：SQLite（better-sqlite3），数据持久化存储
- **认证**：JWT (jsonwebtoken) + bcryptjs
- **前端**：原生 HTML/CSS/JavaScript（无框架依赖，加载快）

## 本地运行

```bash
npm install
node server.js
```

访问：
- 聊天应用：http://localhost:3000
- 管理后台：http://localhost:3000/admin

默认管理员账号：`admin` / `WaveChatAdmin2026!`
演示用户：`alex`、`kexin`、`xiaoyu`、`mia`，密码均为 `demo1234`

## 项目结构

```
wavechat/
├── server.js              # 主服务器（Express + Socket.io）
├── db.js                  # 数据库初始化与表结构
├── middleware/
│   └── auth.js            # JWT 认证中间件
├── routes/
│   ├── auth.js            # 注册/登录/资料
│   ├── users.js           # 用户搜索
│   ├── friends.js         # 好友申请与管理
│   ├── groups.js          # 群聊创建与成员管理
│   ├── messages.js        # 消息历史与发送
│   └── admin.js           # 管理员 API
├── public/
│   ├── index.html         # 聊天应用页面
│   ├── admin.html         # 管理员后台页面
│   ├── css/style.css      # 样式
│   └── js/
│       ├── app.js         # 聊天应用逻辑
│       └── admin.js       # 管理员后台逻辑
├── data/                  # SQLite 数据库文件目录
├── render.yaml            # Render 一键部署配置
├── railway.json           # Railway 部署配置
└── package.json
```

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 用户注册 |
| POST | /api/auth/login | 用户登录 |
| GET | /api/auth/me | 获取当前用户 |
| PUT | /api/auth/me | 更新个人资料 |
| GET | /api/users/search | 搜索用户 |
| GET | /api/friends | 好友列表 |
| GET | /api/friends/requests | 好友申请列表 |
| POST | /api/friends/request | 发送好友申请 |
| POST | /api/friends/accept/:id | 接受好友申请 |
| POST | /api/friends/reject/:id | 拒绝好友申请 |
| GET | /api/groups | 我的群聊 |
| POST | /api/groups | 创建群聊 |
| GET | /api/groups/:id | 群聊详情与成员 |
| POST | /api/groups/:id/members | 添加成员 |
| DELETE | /api/groups/:id/members/:userId | 移除成员 |
| GET | /api/messages/direct/:userId | 私聊历史 |
| GET | /api/messages/group/:groupId | 群聊历史 |
| GET | /api/admin/stats | 管理员统计 |
| GET | /api/admin/users | 用户列表 |
| POST | /api/admin/users/:id/ban | 封禁用户 |
| POST | /api/admin/users/:id/unban | 解封用户 |
| GET | /api/admin/groups | 所有群聊 |
| DELETE | /api/admin/groups/:id | 删除群聊 |
| GET | /api/admin/logs | 操作日志 |

## 部署到云平台

### 方案一：Render.com（推荐，最简单）

Render 支持 Node.js + WebSocket，可添加持久化磁盘保存 SQLite 数据。

1. **注册 Render 账号**：访问 https://render.com ，用 GitHub 账号登录
2. **将代码推送到 GitHub**：
   ```bash
   cd wavechat
   git init
   git add .
   git commit -m "WaveChat initial commit"
   git branch -M main
   # 在 GitHub 创建新仓库后执行：
   git remote add origin https://github.com/你的用户名/wavechat.git
   git push -u origin main
   ```
3. **在 Render 部署**：
   - 登录 Render 后点击「New +」→「Web Service」
   - 选择你刚创建的 GitHub 仓库
   - 配置：
     - Name: `wavechat`（或任意名称）
     - Runtime: `Node`
     - Build Command: `npm install`
     - Start Command: `node server.js`
     - Plan: Free（免费）
   - 点击「Advanced」→ 添加环境变量：
     - `NODE_ENV` = `production`
     - `JWT_SECRET` = 点击「Generate」生成随机密钥
     - `ADMIN_USERNAME` = `admin`
     - `ADMIN_PASSWORD` = 设置一个强密码
     - `DB_PATH` = `/opt/render/project/src/data/wavechat.db`
   - 点击「Create Web Service」
4. **添加持久化磁盘**（重要，否则数据会在重启后丢失）：
   - 进入服务页面 →「Disks」→「Add Disk」
   - Name: `wavechat-data`
   - Mount Path: `/opt/render/project/src/data`
   - Size: `1 GB`（每月约 $1）
5. 等待部署完成，Render 会给你一个网址，如 `https://wavechat-xxxx.onrender.com`

### 方案二：Railway.app

Railway 提供免费试用额度，支持直接从本地部署。

1. 注册 https://railway.app
2. 安装 Railway CLI：`npm i -g @railway/cli`
3. 登录：`railway login`
4. 部署：
   ```bash
   cd wavechat
   railway init
   railway up
   ```
5. 在 Railway 面板中添加环境变量：`JWT_SECRET`、`ADMIN_PASSWORD`
6. 添加 Volume（持久化存储）挂载到 `/app/data`
7. 开启「Generate Domain」获取公网网址

### 方案三：其他支持 Node.js 的平台

任何支持 Node.js 18+、WebSocket、持久化存储的平台均可：
- Vercel（需搭配外部数据库，Serverless 对 WebSocket 支持有限）
- Heroku
- DigitalOcean App Platform
- 阿里云/腾讯云服务器（自行部署）

## 部署后必做

1. **修改管理员密码**：登录管理后台后，通过数据库或 API 修改默认管理员密码
2. **修改 JWT_SECRET**：确保使用强随机密钥，不要使用默认值
3. **配置 HTTPS**：Render/Railway 默认提供 HTTPS
4. **定期备份数据库**：SQLite 文件位于 data/ 目录

## 安全说明

- 所有密码使用 bcrypt 哈希存储，不明文保存
- 用户认证使用 JWT Token，有效期 7 天
- 管理员接口在服务端校验角色权限，前端无法绕过
- 封禁用户无法登录、无法发送消息
- 所有管理员操作记录审计日志（操作人、时间、详情、IP）
- 群聊消息仅群成员可访问，私聊消息仅对话双方可访问
