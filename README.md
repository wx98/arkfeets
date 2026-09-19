# 粥批来猜∠

一款面向局域网的明日方舟同人猜图小游戏。项目包含单人限时挑战、多人抢答、外部答案接口和题库管理后台。

> 本项目为非官方同人作品，与上海鹰角网络科技有限公司无隶属或授权关系。请只使用你有权使用的图片资源。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- Windows、macOS 或 Linux 局域网主机

## 安装

项目使用 npm workspace。使用淘宝镜像安装依赖：

```powershell
npm install --registry=https://registry.npmmirror.com
```

若本机 npm 配置了已经失效的代理，请先修复代理配置；镜像地址仍保持为 `https://registry.npmmirror.com`。

## 配置

编辑 `server/config.json`：

```json
{
  "adminPassword": "arkfeets-admin",
  "adminSessionHours": 8
}
```

- `adminPassword`：题库管理后台密码。首次运行前应改成自己的密码。
- `adminSessionHours`：后台令牌有效小时数。服务重启后，所有令牌自动失效。

配置文件中的密码不会发送到前端。本项目仅按可信局域网环境设计，不建议直接暴露到公网。

## 启动

开发模式会分别启动 Express 和 Vite：

```powershell
npm run dev
```

生产模式由 Express 同时托管前端、接口和图片：

```powershell
npm run build
npm start
```

默认监听 `0.0.0.0:3000`。本机访问 `http://localhost:3000`；同一局域网的其他设备访问 `http://主机局域网IP:3000`。如其他设备无法连接，请允许 Node.js 通过系统防火墙的专用网络，或放行 TCP 3000 端口。

可用环境变量：

```powershell
$env:HOST="0.0.0.0"
$env:PORT="3000"
npm start
```

## 游戏模式

- 单人：四档难度，初始 10 点生命；超时或跳过扣 1 点，剩余时间不少于 80% 时答对恢复 1 点，生命上限 10。
- 多人网页抢答：房主创建房间，最多 20 人；首个正确答案得分，同分进入加时赛。
- 多人外部接口：房主选择“外部接口”，启动后通过下列接口提交答案。一个服务实例同一时间只允许一个活动接口房间。

```http
POST /api/game/submit-answer
Content-Type: application/json

{ "userName": "玩家名", "answer": "答案" }
```

## 维护题库

1. 在首页进入“题库管理”。
2. 使用 `server/config.json` 中的密码登录。
3. 使用“新增题目”创建禁用草稿，填写标题、答案与别名、提示、难度和标签。
4. 上传完整图，在裁切工作台中框选游戏题面；完整图会用于答案揭晓。
5. 使用搜索框按标题、答案、别名或标签查找题目。
6. 使用“批量上传完整图”选择文件夹。每张图片会生成一个禁用草稿，标题取图片文件名，标签记录文件夹名。
7. 使用导入和导出按钮迁移整个现有题库。导入采用并集策略，已有 ID 会保留并在结果中报告，不会被覆盖。

每题直接维护两张图片：一张由维护者自行裁切的问题图，一张用于揭晓的完整图。游戏运行时不会自动裁切。详细格式见 [题库资源包格式](docs/题库资源包格式.md)。

题库文件位于 `server/resource/question`。草稿会注册到 `catalogue.json`，但在信息和两张图片补齐并启用前不会进入游戏。

## 验证命令

```powershell
npm test
npm run build
```

健康检查：`GET /api/health`。题库公开校验报告：`GET /api/questions/validation`。

## 常用脚本

- `npm run dev`：启动前后端开发服务器。
- `npm run build`：构建服务端和前端。
- `npm start`：启动生产服务。
- `npm test`：运行服务端测试。
