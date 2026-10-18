import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("The portable package currently targets Windows only.");

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(project, "package.json"), "utf8")).version;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const name = `arkfeets-${version}-win-${stamp}`;
const release = join(project, "release");
const target = join(release, name);
const archive = join(release, `${name}.zip`);
if (existsSync(target) || existsSync(archive)) throw new Error(`Release already exists: ${name}`);

const copy = (source, destination) => {
  if (!existsSync(source)) throw new Error(`Missing build input: ${source}`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
};
const rootCopy = (source, destination = source) => copy(join(project, source), join(target, destination));
const log = (message) => process.stdout.write(`${message}\n`);
mkdirSync(target, { recursive: true });

log("Installing production dependencies from the npm cache...");
for (const file of ["package.json", "package-lock.json", "server/package.json", "web/package.json"]) rootCopy(file);
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmArgs = [npmCli, "ci", "--omit=dev", "--registry=https://registry.npmmirror.com", "--no-audit", "--no-fund"];
let install = spawnSync(process.execPath, [...npmArgs, "--offline"], { cwd: target, stdio: "inherit", windowsHide: true });
if (install.status !== 0) {
  log("Local npm cache is incomplete; retrying with the Taobao mirror...");
  install = spawnSync(process.execPath, npmArgs, { cwd: target, stdio: "inherit", windowsHide: true });
}
if (install.status !== 0) throw new Error("Production dependency installation failed.");

log("Bundling Node.js and Python/Pillow...");
copy(process.execPath, join(target, "runtime", "node", "node.exe"));
const pythonCommand = process.env.ARKFEETS_PYTHON || "python";
const pythonInfo = JSON.parse(execFileSync(pythonCommand, ["-c", "import json,sys,PIL; print(json.dumps({'prefix':sys.base_prefix,'executable':sys.executable,'pillow':PIL.__file__}))"], { encoding: "utf8", windowsHide: true }));
const pythonRoot = join(target, "runtime", "python");
mkdirSync(pythonRoot, { recursive: true });
for (const file of readdirSync(pythonInfo.prefix)) {
  if (file === "python.exe" || file === "LICENSE.txt" || file.toLowerCase().endsWith(".dll")) {
    copy(join(pythonInfo.prefix, file), join(pythonRoot, file));
  }
}
const skipCache = (path) => !path.split(sep).includes("__pycache__");
cpSync(join(pythonInfo.prefix, "Lib"), join(pythonRoot, "Lib"), {
  recursive: true,
  filter: (path) => skipCache(path) && !path.split(sep).includes("site-packages"),
});
copy(join(pythonInfo.prefix, "DLLs"), join(pythonRoot, "DLLs"));
const pillowDirectory = dirname(pythonInfo.pillow);
mkdirSync(join(pythonRoot, "Lib", "site-packages"), { recursive: true });
cpSync(pillowDirectory, join(pythonRoot, "Lib", "site-packages", "PIL"), { recursive: true, filter: skipCache });
for (const file of readdirSync(join(pythonInfo.prefix, "Lib", "site-packages"))) {
  if (/^pillow-.+\.dist-info$/i.test(file)) copy(join(pythonInfo.prefix, "Lib", "site-packages", file), join(pythonRoot, "Lib", "site-packages", file));
}
const pythonDll = readdirSync(pythonInfo.prefix).find((file) => /^python\d+\.dll$/i.test(file));
if (!pythonDll) throw new Error("Cannot locate the Python runtime DLL.");
writeFileSync(join(pythonRoot, `${basename(pythonDll, ".dll")}._pth`), ".\nLib\nDLLs\nLib\\site-packages\nimport site\n");
execFileSync(join(pythonRoot, "python.exe"), ["-c", "from PIL import Image, ImageOps; import json; print(json.dumps({'pillow':Image.__version__}))"], { windowsHide: true });

log("Copying application and creating an empty question library...");
for (const file of ["server/dist", "server/config.json", "server/scripts/render_topic_thumbnail.py", "web/dist"]) rootCopy(file);
const resource = join(target, "server", "resource");
mkdirSync(resource, { recursive: true });
writeFileSync(join(resource, "catalogue.json"), "[]\n");
writeFileSync(join(resource, "topic.json"), `${JSON.stringify([{ id: "脚", name: "脚", isDefault: true }], null, 2)}\n`);
for (const file of ["start.cmd", "stop.cmd", "start.mjs", "stop.mjs"]) {
  copy(join(project, "scripts", "portable", file), join(target, file));
}
writeFileSync(join(target, "使用说明.txt"), [
  "粥粥图猜猜 Windows 便携版",
  "",
  "双击 start.cmd 启动并打开浏览器；双击 stop.cmd 停止本发布包的服务。",
  "默认地址：http://localhost:3000；局域网设备访问 http://主机IP:3000。",
  "需要更换端口时，在命令行设置 PORT 环境变量后运行 start.cmd。",
  "后台密码和直播设置位于 server/config.json，请在分享前检查。",
  "发布包不含题目与原图，请启动后在后台使用题库导入功能迁移。",
  "运行中的题库、用户访问配置和对局日志保存在此目录，请勿直接覆盖正在使用的发布包。",
  "已有对局日志不随发布包复制；新日志会写入 server/logs/games。",
  "",
].join("\r\n"), "utf8");

log("Creating ZIP archive...");
const zipScript = [
  "from pathlib import Path",
  "from zipfile import ZipFile, ZIP_DEFLATED",
  "import sys",
  "root, archive = Path(sys.argv[1]), Path(sys.argv[2])",
  "with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=6, allowZip64=True) as output:",
  "    for path in root.rglob('*'):",
  "        if path.is_file(): output.write(path, str(Path(root.name) / path.relative_to(root)))",
].join("\n");
const zipped = spawnSync(join(pythonRoot, "python.exe"), ["-c", zipScript, target, archive], { stdio: "inherit", windowsHide: true });
if (zipped.status !== 0) throw new Error("ZIP creation failed; the unpacked portable directory is still available.");
log(`Portable directory: ${target}`);
log(`ZIP archive: ${archive}`);
