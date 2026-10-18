# 粥批来猜∠

一款面向局域网的明日方舟同人猜图小游戏。项目包含单人限时挑战、多人抢答、外部答案接口和题库管理后台。

> 本项目为非官方同人作品，与上海鹰角网络科技有限公司无隶属或授权关系。请只使用你有权使用的图片资源。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- Windows、macOS 或 Linux 局域网主机
- Python 3 与 Pillow 仅用于历史模型/诊断脚本；游戏运行不需要

## 安装

项目使用 npm workspace。使用淘宝镜像安装依赖：

```powershell
npm install --registry=https://registry.npmmirror.com
```

若本机 npm 配置了已经失效的代理，请先修复代理配置；镜像地址仍保持为 `https://registry.npmmirror.com`。

主题缩略图由服务端按需裁切并编码为 WebP，缓存在系统临时目录，不修改原图或题目文件。

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

### Windows 便携发布包

在开发电脑安装依赖后，双击根目录的 `package.bat`，或运行 `npm run package:win`。打包会先编译前后端，再生成 `release/` 下的生产目录及同名 ZIP。构建电脑需要 Node.js/npm，并可通过淘宝镜像安装依赖；**使用发布包的电脑无需安装 Node.js、Python、npm 或其他依赖**。服务端代码与依赖被编译进 `arkfeets.exe`，目录不包含 `node_modules`、Node.js/Python 运行目录、题目、原图及已有对局日志。

解压 ZIP 后双击 `start.cmd`，它会运行 `arkfeets.exe` 拉起服务，健康检查通过后自动打开浏览器，并留在结果窗口；关闭这个窗口不会停止服务。双击 `stop.cmd` 只停止本发布包启动的服务，也会留窗显示结果。默认端口是 3000，后台日志在 `.runtime/`。首次启动后，通过后台的题库导入功能迁移题目和原图；新对局日志写入 `server/logs/games`。发布前检查随包 `server/config.json` 中的密码和直播间信息，不要把包含敏感配置的 ZIP 公开分发。

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
3. 在左侧切换“原图”和“题目”视图。原图视图展示素材及关联题目统计，题目视图展示 catalogue 中的全部题目。
4. 上传完整图或选择图片文件夹。图片进入 `full_data`，不会自动创建题目。
5. 展开一张原图并点击“新增题目”；同名 JSON 会预填答案、提示、难度和标签，标题保持为空。
6. 填写标题，在原图上框选谜面并点击“确认当前裁切”。标题和裁切未完成前不能提交。
7. 详情区同时预览完整谜底和裁切谜面；保存时只写题目字段与裁切坐标，不生成第二张图片。
8. 使用搜索框按文件名、标题、答案、别名、标签或原图查找；使用导入和导出按钮迁移整个题库。

每张完整图只保存一份。题目以原图像素坐标记录谜面区域，游戏答题阶段实时裁切，揭晓阶段恢复完整原图。详细格式见 [题库资源包格式](docs/题库资源包格式.md)。

题库索引位于 `server/resource/catalogue.json`，单题记录位于 `question_data`，原图及同名默认信息位于 `full_data`。编辑现有题目只原子替换对应单题文件。

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
