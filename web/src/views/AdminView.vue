<script setup lang="ts">
import { AlertTriangle, ArrowLeft, CheckCircle2, Database, Download, FolderUp, ImagePlus, LogIn, LogOut, PackagePlus, Plus, Save, Scissors, Search, Trash2, Upload, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Cropper } from "vue-advanced-cropper";
import "vue-advanced-cropper/dist/style.css";
import { useRouter } from "vue-router";
import type { Difficulty } from "../types";

interface AdminQuestionInfo {
  title: string;
  answers: string[];
  hint: string;
  difficulty: Difficulty[];
  tags: string[];
  questionImg: string;
  answerRevealImg: string;
  enabled: boolean;
}

interface AdminQuestion {
  id: string;
  info: AdminQuestionInfo | null;
  questionImgUrl: string | null;
  answerRevealImgUrl: string | null;
  validation: { valid: boolean; errors: string[] };
}

interface AdminQuestionList {
  validCount: number;
  invalidCount: number;
  questions: AdminQuestion[];
}

const difficultyOptions: Array<{ value: Difficulty; label: string }> = [
  { value: "simple", label: "简单" }, { value: "medium", label: "中等" }, { value: "hard", label: "困难" }, { value: "hell", label: "地狱" },
];
const emptyInfo = (): AdminQuestionInfo => ({ title: "", answers: [""], hint: "", difficulty: ["simple", "medium", "hard", "hell"], tags: [], questionImg: "", answerRevealImg: "", enabled: false });

const router = useRouter();
const token = ref(sessionStorage.getItem("arkfeets:admin-token") ?? "");
const password = ref("");
const report = ref<AdminQuestionList | null>(null);
const selectedId = ref("");
const form = ref<AdminQuestionInfo>(emptyInfo());
const tagText = ref("");
const searchText = ref("");
const busy = ref(false);
const message = ref("");
const error = ref("");
const showCreate = ref(false);
const newTitle = ref("");
const cropper = ref<InstanceType<typeof Cropper>>();
const cropSource = ref("");
const cropAspect = ref<number | undefined>(16 / 9);
const pendingFullImage = ref<File>();
let objectUrl = "";

const selected = computed(() => report.value?.questions.find((question) => question.id === selectedId.value));
const filteredQuestions = computed<AdminQuestion[]>(() => {
  const needle = normalizeSearch(searchText.value);
  if (!needle) return report.value?.questions ?? [];
  return (report.value?.questions ?? []).filter((question) => normalizeSearch([
    question.id, question.info?.title, ...(question.info?.answers ?? []), ...(question.info?.tags ?? []),
  ].filter(Boolean).join(" ")).includes(needle));
});

onMounted(() => { if (token.value) void loadQuestions(); });
onBeforeUnmount(clearObjectUrl);

async function login() {
  await perform(async () => {
    const session = await api<{ token: string }>("/api/admin/login", { method: "POST", body: JSON.stringify({ password: password.value }) }, false);
    token.value = session.token;
    sessionStorage.setItem("arkfeets:admin-token", session.token);
    password.value = "";
    await loadQuestions();
  }, "管理终端已解锁");
}

async function loadQuestions(preferredId = selectedId.value) {
  try {
    report.value = await api<AdminQuestionList>("/api/admin/questions");
    const next = report.value.questions.find((question) => question.id === preferredId) ?? report.value.questions[0];
    if (next) selectQuestion(next);
    else selectedId.value = "";
  } catch (reason) { handleError(reason); }
}

function selectQuestion(question: AdminQuestion) {
  selectedId.value = question.id;
  form.value = question.info ? JSON.parse(JSON.stringify(question.info)) as AdminQuestionInfo : emptyInfo();
  if (form.value.answers.length === 0) form.value.answers = [""];
  tagText.value = form.value.tags.join("，");
  pendingFullImage.value = undefined;
  setCropSource(question.answerRevealImgUrl ?? "");
  message.value = "";
  error.value = "";
}

async function createDraft() {
  await perform(async () => {
    const result = await api<{ id: string }>("/api/admin/questions", { method: "POST", body: JSON.stringify({ title: newTitle.value.trim() }) });
    newTitle.value = "";
    showCreate.value = false;
    await loadQuestions(result.id);
  }, "新草稿已创建，请补充题目信息");
}

async function saveInfo() {
  await perform(async () => {
    const payload = {
      ...form.value,
      title: form.value.title.trim(),
      hint: form.value.hint.trim(),
      answers: form.value.answers.map((answer) => answer.trim()).filter(Boolean),
      tags: tagText.value.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean),
    };
    await api(`/api/admin/questions/${encodeURIComponent(selectedId.value)}/info`, { method: "PUT", body: JSON.stringify(payload) });
    await loadQuestions(selectedId.value);
  }, form.value.enabled ? "题目已保存并启用" : "草稿已保存");
}

function addAnswer() { form.value.answers.push(""); }
function removeAnswer(index: number) {
  form.value.answers.splice(index, 1);
  if (form.value.answers.length === 0) form.value.answers.push("");
}

function chooseFullImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  pendingFullImage.value = file;
  clearObjectUrl();
  objectUrl = URL.createObjectURL(file);
  cropSource.value = objectUrl;
  input.value = "";
}

async function applyImages() {
  if (!selectedId.value || !cropSource.value) { error.value = "请先上传或选择完整图"; return; }
  await perform(async () => {
    if (pendingFullImage.value) await uploadImage("reveal", pendingFullImage.value);
    const result = cropper.value?.getResult();
    if (!result?.canvas) throw new Error("请选择要作为题面的裁切区域");
    const blob = await canvasToBlob(result.canvas);
    await uploadImage("question", new File([blob], "question.png", { type: "image/png" }));
    pendingFullImage.value = undefined;
    await loadQuestions(selectedId.value);
  }, "完整图和裁切题面已保存");
}

async function uploadImage(kind: "question" | "reveal", file: File) {
  const data = new FormData();
  data.append("image", file);
  await api(`/api/admin/questions/${encodeURIComponent(selectedId.value)}/images/${kind}`, { method: "POST", body: data });
}

async function importArchive(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await perform(async () => {
    const data = new FormData();
    data.append("archive", file);
    const result = await api<{ importedIds: string[]; conflicts: string[] }>("/api/admin/questions/import-zip", { method: "POST", body: data });
    await loadQuestions(result.importedIds[0]);
    input.value = "";
    message.value = `导入 ${result.importedIds.length} 题，保留 ${result.conflicts.length} 个重复 ID`;
  });
}

async function exportArchive() {
  await perform(async () => {
    const link = document.createElement("a");
    link.href = "/api/admin/questions/export";
    link.click();
  }, "整库资源包已导出");
}

async function uploadFolder(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  await perform(async () => {
    const data = new FormData();
    data.append("paths", JSON.stringify(files.map((file) => file.webkitRelativePath || file.name)));
    for (const file of files) data.append("images", file);
    const result = await api<{ ids: string[] }>("/api/admin/questions/batch-images", { method: "POST", body: data });
    await loadQuestions(result.ids[0]);
    input.value = "";
    message.value = `已从文件夹创建 ${result.ids.length} 个待补全草稿`;
  });
}

async function logout() {
  try { await api("/api/admin/logout", { method: "POST" }); } catch { /* Local logout still applies. */ }
  token.value = "";
  report.value = null;
  sessionStorage.removeItem("arkfeets:admin-token");
}

async function perform(action: () => Promise<void>, successMessage = "") {
  busy.value = true; message.value = ""; error.value = "";
  try { await action(); if (successMessage) message.value = successMessage; }
  catch (reason) { handleError(reason); }
  finally { busy.value = false; }
}

function handleError(reason: unknown) {
  error.value = reason instanceof Error ? reason.message : "操作失败";
  if (error.value.includes("会话无效") || error.value.includes("已过期")) void logout();
}

async function api<T = unknown>(url: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (authenticated && token.value) headers.set("Authorization", `Bearer ${token.value}`);
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `请求失败 (${response.status})`);
  return body as T;
}

function setCropSource(source: string) { clearObjectUrl(); cropSource.value = source; }
function clearObjectUrl() { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ""; }
function normalizeSearch(value: string) { return value.replace(/\s/gu, "").toLocaleLowerCase(); }
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成裁切图片")), "image/png"));
}
</script>

<template>
  <main class="page-shell admin-page">
    <header class="topbar">
      <button class="icon-button" title="返回首页" @click="router.push('/')"><ArrowLeft :size="18" /></button>
      <div class="brand-mark">题库管理 <small>ARCHIVE CONTROL</small></div>
      <button v-if="token" class="icon-button admin-logout" title="退出后台" @click="logout"><LogOut :size="18" /></button>
    </header>

    <section v-if="!token" class="admin-login">
      <div class="admin-login__mark"><Database :size="46" /></div>
      <p class="eyebrow">AUTHORIZED PERSONNEL ONLY</p>
      <h1>档案终端</h1>
      <p>输入服务端配置的管理密码，访问题目档案。</p>
      <form class="admin-login__form" @submit.prevent="login">
        <input v-model="password" type="password" autocomplete="current-password" placeholder="管理密码" />
        <button class="button button--primary" :disabled="busy || !password"><LogIn :size="18" />进入后台</button>
      </form>
      <p v-if="error" class="error-text">{{ error }}</p>
    </section>

    <section v-else-if="report" class="admin-workbench">
      <aside class="admin-sidebar">
        <div class="admin-summary">
          <span><CheckCircle2 :size="16" />有效 <b>{{ report.validCount }}</b></span>
          <span><AlertTriangle :size="16" />草稿/异常 <b>{{ report.invalidCount }}</b></span>
        </div>
        <div class="admin-toolbar">
          <button class="icon-button" title="新增题目" @click="showCreate = !showCreate"><Plus :size="18" /></button>
          <label class="icon-button" title="导入题库"><PackagePlus :size="18" /><input type="file" accept=".zip,application/zip" :disabled="busy" @change="importArchive" /></label>
          <button class="icon-button" title="导出题库" :disabled="busy" @click="exportArchive"><Download :size="18" /></button>
          <label class="icon-button" title="批量上传完整图"><FolderUp :size="18" /><input v-bind="{ webkitdirectory: '' }" type="file" accept="image/*" multiple :disabled="busy" @change="uploadFolder" /></label>
        </div>
        <form v-if="showCreate" class="admin-create" @submit.prevent="createDraft">
          <input v-model="newTitle" autofocus maxlength="100" placeholder="新题目标题" />
          <button class="icon-button" title="创建草稿" :disabled="busy"><Plus :size="17" /></button>
          <button class="icon-button" type="button" title="取消" @click="showCreate = false"><X :size="17" /></button>
        </form>
        <div class="admin-search"><Search :size="16" /><input v-model="searchText" placeholder="搜索标题、答案或标签" /></div>
        <nav class="question-list" aria-label="题目列表">
          <button v-for="question in filteredQuestions" :key="question.id" :class="{ active: selectedId === question.id }" @click="selectQuestion(question)">
            <component :is="question.validation.valid ? CheckCircle2 : AlertTriangle" :size="15" />
            <span>{{ question.info?.title || question.id }}</span>
            <small>{{ question.info?.answers.join(' / ') || '待补充答案' }}</small>
          </button>
          <p v-if="filteredQuestions.length === 0" class="question-list__empty">没有匹配的题目</p>
        </nav>
      </aside>

      <article v-if="selected" class="admin-editor">
        <header>
          <div><p class="eyebrow">QUESTION ARCHIVE / {{ selected.id }}</p><h2>{{ form.title || '未命名草稿' }}</h2></div>
          <span :class="selected.validation.valid ? 'valid' : 'invalid'">{{ selected.validation.valid ? '校验通过' : '待补全' }}</span>
        </header>
        <div v-if="selected.validation.errors.length" class="validation-errors"><AlertTriangle :size="17" /><p>{{ selected.validation.errors.join('；') }}</p></div>

        <section class="admin-form-section">
          <div class="admin-section-title"><span>01</span><div><strong>基本信息</strong><small>METADATA</small></div></div>
          <div class="admin-form-grid">
            <label class="wide">标题<input v-model="form.title" maxlength="100" placeholder="输入题目标题" /></label>
            <label class="wide">提示<textarea v-model="form.hint" maxlength="300" rows="3" placeholder="可选提示" /></label>
            <div class="wide answer-fields">
              <div class="field-heading"><span>正确答案与别名</span><button class="icon-button" title="增加别名" @click="addAnswer"><Plus :size="15" /></button></div>
              <div v-for="(answer, index) in form.answers" :key="index" class="answer-row" :title="answer || `答案 ${index + 1}`">
                <input v-model="form.answers[index]" maxlength="100" :placeholder="index === 0 ? '主要答案' : `别名 ${index}`" />
                <button class="icon-button" title="删除答案" @click="removeAnswer(index)"><Trash2 :size="15" /></button>
              </div>
            </div>
            <label class="wide">标签<input v-model="tagText" placeholder="使用逗号分隔，例如：干员，六星" /></label>
            <fieldset class="wide difficulty-checks"><legend>适用难度</legend><label v-for="item in difficultyOptions" :key="item.value"><input v-model="form.difficulty" type="checkbox" :value="item.value" />{{ item.label }}</label></fieldset>
          </div>
        </section>

        <section class="admin-form-section image-workbench">
          <div class="admin-section-title"><span>02</span><div><strong>完整图与题面裁切</strong><small>IMAGE CROP</small></div></div>
          <div class="crop-toolbar">
            <label class="button"><ImagePlus :size="17" />选择完整图<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="chooseFullImage" /></label>
            <div class="crop-ratios"><button :class="{ active: cropAspect === 16 / 9 }" @click="cropAspect = 16 / 9">16:9</button><button :class="{ active: cropAspect === 1 }" @click="cropAspect = 1">1:1</button><button :class="{ active: !cropAspect }" @click="cropAspect = undefined">自由</button></div>
          </div>
          <Cropper v-if="cropSource" ref="cropper" class="question-cropper" :src="cropSource" :stencil-props="{ aspectRatio: cropAspect }" image-restriction="stencil" />
          <div v-else class="crop-empty"><Upload :size="32" /><strong>上传一张完整图</strong><span>完整图用于答案揭晓，框选区域会保存为游戏题面。</span></div>
          <div class="image-status"><span :class="{ ready: selected.answerRevealImgUrl }">完整图 {{ selected.answerRevealImgUrl ? '已就绪' : '缺失' }}</span><span :class="{ ready: selected.questionImgUrl }">题面 {{ selected.questionImgUrl ? '已就绪' : '缺失' }}</span></div>
          <button class="button button--primary crop-save" :disabled="busy || !cropSource" @click="applyImages"><Scissors :size="18" />保存完整图与当前裁切</button>
        </section>

        <section class="admin-publish">
          <label class="publish-toggle"><input v-model="form.enabled" type="checkbox" /><span class="publish-switch" /><span class="publish-copy"><strong>允许进入游戏题库</strong><small>只有信息和两张图片完整时才能启用</small></span></label>
          <button class="button button--primary" :disabled="busy" @click="saveInfo"><Save :size="17" />保存题目信息</button>
        </section>
        <p v-if="message" class="admin-message">{{ message }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>

      <article v-else class="admin-empty"><Database :size="42" /><h2>题库为空</h2><p>新建题目或导入资源包后，档案会出现在这里。</p></article>
    </section>
    <section v-else class="center-state">正在读取题库...</section>
  </main>
</template>
