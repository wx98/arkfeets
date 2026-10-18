import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

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

log("Compiling the standalone Windows executable...");
const bun = join(project, "node_modules", "bun", "bin", "bun.exe");
if (!existsSync(bun)) throw new Error("Bun build tool is missing. Run npm install on the build computer.");
const compiled = spawnSync(bun, ["build", "--compile", join(project, "scripts", "portable", "launcher.mjs"), "--outfile", join(target, "arkfeets.exe")], {
  cwd: project, stdio: "inherit", windowsHide: true,
});
if (compiled.status !== 0) throw new Error("Standalone executable compilation failed.");

log("Copying the compiled web app and creating an empty question library...");
for (const file of ["server/config.json", "web/dist"]) rootCopy(file);
const resource = join(target, "server", "resource");
mkdirSync(resource, { recursive: true });
writeFileSync(join(resource, "catalogue.json"), "[]\n");
writeFileSync(join(resource, "topic.json"), `${JSON.stringify([{ id: "脚", name: "脚", isDefault: true }], null, 2)}\n`);
for (const file of ["start.cmd", "stop.cmd"]) {
  copy(join(project, "scripts", "portable", file), join(target, file));
}
writeFileSync(join(target, "使用说明.txt"), [
  "粥粥图猜猜 Windows 独立发布版",
  "",
  "双击 start.cmd 启动并打开浏览器；双击 stop.cmd 停止本发布包的服务。",
  "无需安装 Node.js、Python、npm 或其他运行环境。",
  "默认地址：http://localhost:3000；局域网设备访问 http://主机IP:3000。",
  "需要更换端口时，在命令行设置 PORT 环境变量后运行 start.cmd。",
  "后台密码和直播设置位于 server/config.json，请在分享前检查。",
  "发布包不含题目与原图，请启动后在后台使用题库导入功能迁移。",
  "运行中的题库、用户访问配置和对局日志保存在此目录，请勿直接覆盖正在使用的发布包。",
  "",
].join("\r\n"), "utf8");

log("Creating ZIP archive...");
const zip = new AdmZip();
zip.addLocalFolder(target, name);
zip.writeZip(archive);
log(`Portable directory: ${target}`);
log(`ZIP archive: ${archive}`);
