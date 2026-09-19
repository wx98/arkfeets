<script setup lang="ts">
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Database, Download, FilePlus2,
  FolderOpen, FolderUp, Image as ImageIcon, Images, ListTree, LogIn, LogOut, Plus,
  Save, Scissors, Search, Trash2, Upload,
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Cropper } from "vue-advanced-cropper";
import "vue-advanced-cropper/dist/style.css";
import { useRouter } from "vue-router";
import type { CropRect, Difficulty } from "../types";

interface ImageMetadata {
  name: string;
  answers: string[];
  hint: string;
  difficulty: Difficulty[];
  tags: string[];
}
interface LibraryImage {
  fileName: string;
  url: string;
  metadata: ImageMetadata;
  questionIds: string[];
  validCount: number;
  invalidCount: number;
  totalCount: number;
}
interface QuestionRecord {
  id: string;
  title: string;
  answers: string[];
  hint: string;
  difficulty: Difficulty[];
  tags: string[];
  originalImage: string;
  question: CropRect | null;
  enabled: boolean;
}
interface LibraryQuestion {
  id: string;
  info: QuestionRecord | null;
  originalImageUrl: string | null;
  validation: { valid: boolean; errors: string[] };
}
interface Library {
  validCount: number;
  invalidCount: number;
  images: LibraryImage[];
  questions: LibraryQuestion[];
}

const difficultyOptions: Array<{ value: Difficulty; label: string }> = [
  { value: "simple", label: "简单" }, { value: "medium", label: "中等" },
  { value: "hard", label: "困难" }, { value: "hell", label: "地狱" },
];
const router = useRouter();
const token = ref(sessionStorage.getItem("arkfeets:admin-token") ?? "");
const password = ref("");
const library = ref<Library>();
const mode = ref<"images" | "questions">("images");
const searchText = ref("");
const selectedImageName = ref("");
const expandedImageName = ref("");
const selectedQuestionId = ref("");
const isNew = ref(false);
const form = ref<QuestionRecord>(emptyQuestion());
const tagText = ref("");
const metadataForm = ref<ImageMetadata>(emptyMetadata());
const metadataTagText = ref("");
const cropper = ref<InstanceType<typeof Cropper>>();
const cropAspect = ref<number | undefined>();
const cropConfirmed = ref(false);
const busy = ref(false);
const message = ref("");
const error = ref("");

const selectedImage = computed(() => library.value?.images.find((image) => image.fileName === selectedImageName.value));
const selectedQuestion = computed(() => library.value?.questions.find((question) => question.id === selectedQuestionId.value));
const currentImageUrl = computed(() => {
  if (selectedQuestionId.value || isNew.value) return library.value?.images.find((image) => image.fileName === form.value.originalImage)?.url ?? "";
  return selectedImage.value?.url ?? "";
});
const relatedQuestions = (image: LibraryImage) => library.value?.questions.filter((question) => image.questionIds.includes(question.id)) ?? [];
const normalizedNeedle = computed(() => normalizeSearch(searchText.value));
const filteredImages = computed(() => (library.value?.images ?? []).filter((image) => {
  if (!normalizedNeedle.value) return true;
  const related = relatedQuestions(image);
  return normalizeSearch([
    image.fileName, image.metadata.name, image.metadata.hint, ...image.metadata.answers, ...image.metadata.tags,
    ...related.flatMap((question) => [question.info?.title ?? "", ...(question.info?.answers ?? [])]),
  ].join(" ")).includes(normalizedNeedle.value);
}));
const filteredQuestions = computed(() => (library.value?.questions ?? []).filter((question) => {
  if (!normalizedNeedle.value) return true;
  return normalizeSearch([
    question.id, question.info?.title, question.info?.originalImage, question.info?.hint,
    ...(question.info?.answers ?? []), ...(question.info?.tags ?? []),
  ].filter(Boolean).join(" ")).includes(normalizedNeedle.value);
}));
const modeStats = computed(() => mode.value === "images"
  ? { total: library.value?.images.length ?? 0, valid: (library.value?.images ?? []).reduce((sum, image) => sum + image.validCount, 0), invalid: (library.value?.images ?? []).reduce((sum, image) => sum + image.invalidCount, 0) }
  : { total: library.value?.questions.length ?? 0, valid: library.value?.validCount ?? 0, invalid: library.value?.invalidCount ?? 0 });
const canSaveQuestion = computed(() => Boolean(form.value.title.trim() && form.value.question && form.value.originalImage));
const previewStyle = computed(() => {
  const crop = form.value.question;
  if (!crop) return {};
  return {
    width: `${(crop.sourceWidth / crop.width) * 100}%`,
    height: `${(crop.sourceHeight / crop.height) * 100}%`,
    left: `${-(crop.x / crop.width) * 100}%`,
    top: `${-(crop.y / crop.height) * 100}%`,
  };
});
const previewRatio = computed(() => form.value.question ? `${form.value.question.width} / ${form.value.question.height}` : "16 / 9");

onMounted(() => {
  if (token.value) void loadLibrary().catch(handleError);
});
onBeforeUnmount(() => undefined);

async function login() {
  await perform(async () => {
    const session = await api<{ token: string }>("/api/admin/login", { method: "POST", body: JSON.stringify({ password: password.value }) }, false);
    token.value = session.token;
    sessionStorage.setItem("arkfeets:admin-token", session.token);
    password.value = "";
    await loadLibrary();
  }, "管理终端已解锁");
}

async function loadLibrary(preferredQuestion = selectedQuestionId.value, preferredImage = selectedImageName.value) {
  library.value = await api<Library>("/api/admin/library");
  if (preferredQuestion) {
    const question = library.value.questions.find((item) => item.id === preferredQuestion);
    if (question) { await selectQuestion(question); return; }
  }
  const image = library.value.images.find((item) => item.fileName === preferredImage) ?? library.value.images[0];
  if (image) selectImage(image);
}

function selectImage(image: LibraryImage) {
  selectedImageName.value = image.fileName;
  selectedQuestionId.value = "";
  isNew.value = false;
  metadataForm.value = clone(image.metadata);
  metadataTagText.value = image.metadata.tags.join("，");
  message.value = "";
  error.value = "";
}

function toggleImage(image: LibraryImage) {
  selectImage(image);
  expandedImageName.value = expandedImageName.value === image.fileName ? "" : image.fileName;
}

async function selectQuestion(question: LibraryQuestion) {
  if (!question.info) return;
  message.value = "";
  error.value = "";
  selectedQuestionId.value = question.id;
  selectedImageName.value = question.info.originalImage;
  isNew.value = false;
  form.value = clone(question.info);
  if (!form.value.answers.length) form.value.answers = [""];
  tagText.value = form.value.tags.join("，");
  cropConfirmed.value = Boolean(form.value.question);
  await nextTick();
  restoreCrop();
}

function beginQuestion(image: LibraryImage) {
  selectImage(image);
  selectedQuestionId.value = "";
  isNew.value = true;
  form.value = {
    ...emptyQuestion(),
    answers: image.metadata.answers.length ? [...image.metadata.answers] : [""],
    hint: image.metadata.hint,
    difficulty: [...image.metadata.difficulty],
    tags: [...image.metadata.tags],
    originalImage: image.fileName,
  };
  tagText.value = form.value.tags.join("，");
  cropConfirmed.value = false;
  cropAspect.value = undefined;
  message.value = "";
  error.value = "";
}

function restoreCrop() {
  const crop = form.value.question;
  if (!crop) return;
  const instance = cropper.value as unknown as { setCoordinates?: (coordinates: { left: number; top: number; width: number; height: number }) => void };
  instance?.setCoordinates?.({ left: crop.x, top: crop.y, width: crop.width, height: crop.height });
}

function confirmCrop() {
  const result = cropper.value?.getResult() as { coordinates?: { left: number; top: number; width: number; height: number }; image?: { width: number; height: number } } | undefined;
  if (!result?.coordinates || !result.image) { error.value = "请先在原图上框选谜面"; return; }
  form.value.question = {
    x: Math.round(result.coordinates.left),
    y: Math.round(result.coordinates.top),
    width: Math.round(result.coordinates.width),
    height: Math.round(result.coordinates.height),
    sourceWidth: Math.round(result.image.width),
    sourceHeight: Math.round(result.image.height),
  };
  cropConfirmed.value = true;
  message.value = "当前裁切已确认，保存题目后生效";
}

async function saveQuestion() {
  if (!canSaveQuestion.value) { error.value = "请先填写标题并确认谜面裁切"; return; }
  await perform(async () => {
    const payload = {
      ...form.value,
      title: form.value.title.trim(),
      answers: form.value.answers.map((answer) => answer.trim()).filter(Boolean),
      hint: form.value.hint.trim(),
      tags: tagText.value.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean),
    };
    if (isNew.value) {
      const result = await api<{ id: string }>("/api/admin/questions", { method: "POST", body: JSON.stringify(payload) });
      await loadLibrary(result.id, payload.originalImage);
    } else {
      await api(`/api/admin/questions/${encodeURIComponent(selectedQuestionId.value)}`, { method: "PUT", body: JSON.stringify(payload) });
      await loadLibrary(selectedQuestionId.value, payload.originalImage);
    }
  }, form.value.enabled ? "题目已保存并启用" : "题目已保存");
}

async function saveMetadata() {
  if (!selectedImage.value) return;
  await perform(async () => {
    const payload = {
      ...metadataForm.value,
      answers: metadataForm.value.answers.map((answer) => answer.trim()).filter(Boolean),
      tags: metadataTagText.value.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean),
    };
    await api(`/api/admin/images/${encodeURIComponent(selectedImage.value!.fileName)}/metadata`, { method: "PUT", body: JSON.stringify(payload) });
    await loadLibrary("", selectedImage.value!.fileName);
  }, "原图默认信息已保存");
}

function addAnswer(target: QuestionRecord | ImageMetadata) { target.answers.push(""); }
function removeAnswer(target: QuestionRecord | ImageMetadata, index: number) {
  target.answers.splice(index, 1);
  if (!target.answers.length) target.answers.push("");
}

async function uploadImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  await perform(async () => {
    const data = new FormData();
    data.append("paths", JSON.stringify(files.map((file) => file.webkitRelativePath || file.name)));
    for (const file of files) data.append("images", file);
    const result = await api<{ added: string[]; conflicts: string[] }>("/api/admin/questions/batch-images", { method: "POST", body: data });
    await loadLibrary("", result.added[0]);
    input.value = "";
    message.value = `新增 ${result.added.length} 张原图，跳过 ${result.conflicts.length} 个同名文件`;
  });
}

async function importArchive(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await perform(async () => {
    const data = new FormData();
    data.append("archive", file);
    const result = await api<{ importedIds: string[]; conflicts: string[] }>("/api/admin/questions/import-zip", { method: "POST", body: data });
    await loadLibrary(result.importedIds[0]);
    input.value = "";
    message.value = `导入 ${result.importedIds.length} 题，保留 ${result.conflicts.length} 个重复 ID`;
  });
}

function exportArchive() {
  const link = document.createElement("a");
  link.href = "/api/admin/questions/export";
  link.click();
  message.value = "整库资源包已开始导出";
}

async function logout() {
  try { await api("/api/admin/logout", { method: "POST" }); } catch { /* Local logout still applies. */ }
  token.value = "";
  library.value = undefined;
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

function emptyMetadata(): ImageMetadata {
  return { name: "", answers: [""], hint: "", difficulty: ["simple", "medium", "hard", "hell"], tags: [] };
}
function emptyQuestion(): QuestionRecord {
  return { id: "", title: "", answers: [""], hint: "", difficulty: ["simple", "medium", "hard", "hell"], tags: [], originalImage: "", question: null, enabled: false };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function normalizeSearch(value: string) { return value.replace(/\s/gu, "").toLocaleLowerCase(); }
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

    <section v-else-if="library" class="admin-workbench">
      <aside class="admin-sidebar">
        <div class="admin-view-tabs">
          <button :class="{ active: mode === 'images' }" @click="mode = 'images'"><Images :size="16" />原图</button>
          <button :class="{ active: mode === 'questions' }" @click="mode = 'questions'"><ListTree :size="16" />题目</button>
        </div>
        <div class="admin-summary admin-summary--three">
          <span><FolderOpen :size="15" />总数 <b>{{ modeStats.total }}</b></span>
          <span><CheckCircle2 :size="15" />有效 <b>{{ modeStats.valid }}</b></span>
          <span><AlertTriangle :size="15" />异常 <b>{{ modeStats.invalid }}</b></span>
        </div>
        <div class="admin-toolbar">
          <label class="icon-button" title="上传原图或文件夹"><FolderUp :size="18" /><input v-bind="{ webkitdirectory: '' }" type="file" accept="image/*" multiple :disabled="busy" @change="uploadImages" /></label>
          <label class="icon-button" title="导入题库"><Upload :size="18" /><input type="file" accept=".zip,application/zip" :disabled="busy" @change="importArchive" /></label>
          <button class="icon-button" title="导出题库" :disabled="busy" @click="exportArchive"><Download :size="18" /></button>
        </div>
        <div class="admin-search"><Search :size="16" /><input v-model="searchText" :placeholder="mode === 'images' ? '搜索文件、默认信息或关联题目' : '搜索标题、答案、标签或原图'" /></div>

        <nav v-if="mode === 'images'" class="asset-list" aria-label="原图列表">
          <div v-for="image in filteredImages" :key="image.fileName" class="asset-group" :class="{ active: selectedImageName === image.fileName }">
            <button class="asset-row" @click="toggleImage(image)">
              <ImageIcon :size="16" />
              <span>{{ image.fileName }}</span>
              <small>{{ image.validCount }}/{{ image.totalCount }}</small>
              <ChevronDown :size="15" :class="{ open: expandedImageName === image.fileName }" />
              <span class="asset-hover-preview"><img :src="image.url" :alt="image.fileName" /></span>
            </button>
            <div v-if="expandedImageName === image.fileName" class="asset-questions">
              <button class="asset-add-question" title="基于此原图新增题目" @click="beginQuestion(image)"><Plus :size="15" />新增题目</button>
              <button v-for="question in relatedQuestions(image)" :key="question.id" @click="selectQuestion(question)">
                <component :is="question.validation.valid ? CheckCircle2 : AlertTriangle" :size="13" />
                <span>{{ question.info?.title || question.id }}</span>
              </button>
              <p v-if="!relatedQuestions(image).length">尚无关联题目</p>
            </div>
          </div>
          <p v-if="!filteredImages.length" class="question-list__empty">没有匹配的原图</p>
        </nav>

        <nav v-else class="question-list" aria-label="题目列表">
          <button v-for="question in filteredQuestions" :key="question.id" :class="{ active: selectedQuestionId === question.id }" @click="selectQuestion(question)">
            <component :is="question.validation.valid ? CheckCircle2 : AlertTriangle" :size="15" />
            <span>{{ question.info?.title || question.id }}</span>
            <small>{{ question.info?.originalImage || '未关联原图' }}</small>
            <span v-if="question.info?.question && question.originalImageUrl" class="asset-hover-preview crop-thumb" :style="{ aspectRatio: `${question.info.question.width}/${question.info.question.height}` }">
              <img :src="question.originalImageUrl" :style="{ width: `${question.info.question.sourceWidth / question.info.question.width * 100}%`, height: `${question.info.question.sourceHeight / question.info.question.height * 100}%`, left: `${-question.info.question.x / question.info.question.width * 100}%`, top: `${-question.info.question.y / question.info.question.height * 100}%` }" alt="" />
            </span>
          </button>
        </nav>
      </aside>

      <article v-if="selectedQuestionId || isNew" class="admin-editor">
        <header>
          <div><p class="eyebrow">QUESTION RECORD / {{ isNew ? 'NEW' : selectedQuestionId }}</p><h2>{{ form.title || '未命名题目' }}</h2></div>
          <span :class="selectedQuestion?.validation.valid ? 'valid' : 'invalid'">{{ isNew ? '未提交' : selectedQuestion?.validation.valid ? '校验通过' : '待修正' }}</span>
        </header>
        <div v-if="selectedQuestion?.validation.errors.length" class="validation-errors"><AlertTriangle :size="17" /><p>{{ selectedQuestion.validation.errors.join('；') }}</p></div>

        <section class="admin-form-section">
          <div class="admin-section-title"><span>01</span><div><strong>题目信息</strong><small>QUESTION DATA</small></div></div>
          <div class="admin-form-grid">
            <label class="wide">标题<input v-model="form.title" maxlength="100" placeholder="必填，输入题目标题" /></label>
            <label class="wide">关联原图<input :value="form.originalImage" disabled /></label>
            <label class="wide">提示<textarea v-model="form.hint" maxlength="300" rows="2" placeholder="可选提示" /></label>
            <div class="wide answer-fields">
              <div class="field-heading"><span>正确答案与别名</span><button class="icon-button" title="增加别名" @click="addAnswer(form)"><Plus :size="15" /></button></div>
              <div v-for="index in form.answers.length" :key="index" class="answer-row">
                <input v-model="form.answers[index - 1]" maxlength="100" :placeholder="index > 1 ? `别名 ${index - 1}` : '主要答案'" />
                <button class="icon-button" title="删除答案" @click="removeAnswer(form, index - 1)"><Trash2 :size="15" /></button>
              </div>
            </div>
            <label class="wide">标签<input v-model="tagText" placeholder="使用逗号分隔" /></label>
            <fieldset class="wide difficulty-checks"><legend>适用难度</legend><label v-for="item in difficultyOptions" :key="item.value"><input v-model="form.difficulty" type="checkbox" :value="item.value" />{{ item.label }}</label></fieldset>
          </div>
        </section>

        <section class="admin-form-section">
          <div class="admin-section-title"><span>02</span><div><strong>谜底与谜面</strong><small>ORIGINAL / CROP</small></div></div>
          <div class="image-dual-preview">
            <figure><figcaption>谜底 · 完整原图</figcaption><img :src="currentImageUrl" alt="完整原图" /></figure>
            <figure><figcaption>谜面 · 实时裁切</figcaption><div v-if="form.question" class="crop-preview" :style="{ aspectRatio: previewRatio }"><img :src="currentImageUrl" :style="previewStyle" alt="谜面预览" /></div><div v-else class="crop-preview crop-preview--empty">尚未确认裁切</div></figure>
          </div>
          <div class="crop-ratios">
            <button :class="{ active: cropAspect === 16 / 9 }" @click="cropAspect = 16 / 9">16:9</button>
            <button :class="{ active: cropAspect === 1 }" @click="cropAspect = 1">1:1</button>
            <button :class="{ active: !cropAspect }" @click="cropAspect = undefined">自由</button>
          </div>
          <Cropper v-if="currentImageUrl" ref="cropper" class="question-cropper" :src="currentImageUrl" :stencil-props="{ aspectRatio: cropAspect }" image-restriction="stencil" @ready="restoreCrop" />
          <button class="button crop-confirm" :disabled="busy" @click="confirmCrop"><Scissors :size="18" />确认当前裁切</button>
        </section>

        <section class="admin-publish">
          <label class="publish-toggle"><input v-model="form.enabled" type="checkbox" /><span class="publish-switch" /><span class="publish-copy"><strong>允许进入游戏题库</strong><small>启用时答案和裁切必须完整</small></span></label>
          <button class="button button--primary" :disabled="busy || !canSaveQuestion || !cropConfirmed" @click="saveQuestion"><Save :size="17" />{{ isNew ? '创建题目' : '保存题目' }}</button>
        </section>
        <p v-if="message" class="admin-message">{{ message }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>

      <article v-else-if="selectedImage" class="admin-editor asset-editor">
        <header><div><p class="eyebrow">SOURCE IMAGE / FULL DATA</p><h2>{{ selectedImage.fileName }}</h2></div><button class="button button--primary" @click="beginQuestion(selectedImage)"><FilePlus2 :size="17" />新增题目</button></header>
        <div class="asset-overview">
          <img :src="selectedImage.url" :alt="selectedImage.fileName" />
          <dl><div><dt>有效问题</dt><dd>{{ selectedImage.validCount }}</dd></div><div><dt>异常问题</dt><dd>{{ selectedImage.invalidCount }}</dd></div><div><dt>总问题</dt><dd>{{ selectedImage.totalCount }}</dd></div></dl>
        </div>
        <section class="admin-form-section">
          <div class="admin-section-title"><span>01</span><div><strong>原图默认信息</strong><small>IMAGE METADATA</small></div></div>
          <div class="admin-form-grid">
            <label class="wide">素材名称<input v-model="metadataForm.name" maxlength="100" /></label>
            <label class="wide">默认提示<textarea v-model="metadataForm.hint" rows="2" maxlength="300" /></label>
            <div class="wide answer-fields">
              <div class="field-heading"><span>默认答案与别名</span><button class="icon-button" title="增加别名" @click="addAnswer(metadataForm)"><Plus :size="15" /></button></div>
              <div v-for="index in metadataForm.answers.length" :key="index" class="answer-row"><input v-model="metadataForm.answers[index - 1]" /><button class="icon-button" title="删除答案" @click="removeAnswer(metadataForm, index - 1)"><Trash2 :size="15" /></button></div>
            </div>
            <label class="wide">默认标签<input v-model="metadataTagText" placeholder="使用逗号分隔" /></label>
            <fieldset class="wide difficulty-checks"><legend>默认难度</legend><label v-for="item in difficultyOptions" :key="item.value"><input v-model="metadataForm.difficulty" type="checkbox" :value="item.value" />{{ item.label }}</label></fieldset>
          </div>
          <button class="button button--primary metadata-save" :disabled="busy" @click="saveMetadata"><Save :size="17" />保存默认信息</button>
        </section>
        <p v-if="message" class="admin-message">{{ message }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>

      <article v-else class="admin-empty"><Database :size="42" /><h2>题库为空</h2><p>上传原图后即可开始创建题目。</p></article>
    </section>
    <section v-else class="center-state">正在读取题库...</section>
  </main>
</template>
