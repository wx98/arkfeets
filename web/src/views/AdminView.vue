<script setup lang="ts">
import { AlertTriangle, ArrowLeft, CheckCircle2, Database, LogIn, LogOut, PackagePlus, Save, Upload } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

interface AdminQuestion {
  id: string;
  info: Record<string, unknown> | null;
  validation: { valid: boolean; errors: string[] };
}

interface AdminQuestionList {
  validCount: number;
  invalidCount: number;
  questions: AdminQuestion[];
}

const router = useRouter();
const token = ref(sessionStorage.getItem("arkfeets:admin-token") ?? "");
const password = ref("");
const report = ref<AdminQuestionList | null>(null);
const selectedId = ref("");
const editor = ref("");
const busy = ref(false);
const message = ref("");
const error = ref("");
const selected = computed(() => report.value?.questions.find((question) => question.id === selectedId.value));

onMounted(() => {
  if (token.value) void loadQuestions();
});

async function login() {
  await perform(async () => {
    const session = await api<{ token: string }>("/api/admin/login", { method: "POST", body: JSON.stringify({ password: password.value }) }, false);
    token.value = session.token;
    sessionStorage.setItem("arkfeets:admin-token", session.token);
    password.value = "";
    await loadQuestions();
  }, "管理终端已解锁");
}

async function loadQuestions() {
  try {
    report.value = await api<AdminQuestionList>("/api/admin/questions");
    if (!selectedId.value && report.value.questions.length) selectQuestion(report.value.questions[0]);
  } catch (reason) {
    handleError(reason);
  }
}

function selectQuestion(question: AdminQuestion) {
  selectedId.value = question.id;
  editor.value = JSON.stringify(question.info ?? {}, null, 2);
  message.value = "";
  error.value = "";
}

async function saveInfo() {
  await perform(async () => {
    const parsed = JSON.parse(editor.value);
    await api(`/api/admin/questions/${encodeURIComponent(selectedId.value)}/info`, { method: "PUT", body: JSON.stringify(parsed) });
    await loadQuestions();
    const refreshed = report.value?.questions.find((question) => question.id === selectedId.value);
    if (refreshed) selectQuestion(refreshed);
  }, "题目信息已保存并重新载入");
}

async function uploadImage(event: Event, kind: "question" | "reveal") {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await perform(async () => {
    const form = new FormData();
    form.append("image", file);
    await api(`/api/admin/questions/${encodeURIComponent(selectedId.value)}/images/${kind}`, { method: "POST", body: form });
    await loadQuestions();
    const refreshed = report.value?.questions.find((question) => question.id === selectedId.value);
    if (refreshed) selectQuestion(refreshed);
    input.value = "";
  }, kind === "question" ? "题图已替换" : "完整图已替换");
}

async function importArchive(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await perform(async () => {
    const form = new FormData();
    form.append("archive", file);
    const result = await api<{ importedIds: string[]; conflicts: string[] }>("/api/admin/questions/import-zip", { method: "POST", body: form });
    await loadQuestions();
    input.value = "";
    message.value = `导入 ${result.importedIds.length} 题，保留 ${result.conflicts.length} 个重复 ID`;
  });
}

async function logout() {
  try { await api("/api/admin/logout", { method: "POST" }); } catch { /* Local logout still applies. */ }
  token.value = "";
  report.value = null;
  sessionStorage.removeItem("arkfeets:admin-token");
}

async function perform(action: () => Promise<void>, successMessage = "") {
  busy.value = true;
  message.value = "";
  error.value = "";
  try {
    await action();
    if (successMessage) message.value = successMessage;
  } catch (reason) {
    handleError(reason);
  } finally {
    busy.value = false;
  }
}

function handleError(reason: unknown) {
  error.value = reason instanceof Error ? reason.message : "操作失败";
  if (error.value.includes("会话无效") || error.value.includes("已过期")) logout();
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
          <span><AlertTriangle :size="16" />异常 <b>{{ report.invalidCount }}</b></span>
        </div>
        <label class="button button--quiet admin-import">
          <PackagePlus :size="17" />导入资源包
          <input type="file" accept=".zip,application/zip" :disabled="busy" @change="importArchive" />
        </label>
        <nav class="question-list" aria-label="题目列表">
          <button v-for="question in report.questions" :key="question.id" :class="{ active: selectedId === question.id }" @click="selectQuestion(question)">
            <component :is="question.validation.valid ? CheckCircle2 : AlertTriangle" :size="15" />
            <span>{{ question.id }}</span>
            <small>{{ question.info?.title || '未命名题目' }}</small>
          </button>
        </nav>
      </aside>

      <article v-if="selected" class="admin-editor">
        <header>
          <div><p class="eyebrow">QUESTION ARCHIVE</p><h2>{{ selected.id }}</h2></div>
          <span :class="selected.validation.valid ? 'valid' : 'invalid'">{{ selected.validation.valid ? '校验通过' : '需要修复' }}</span>
        </header>
        <div v-if="selected.validation.errors.length" class="validation-errors">
          <AlertTriangle :size="17" />
          <p>{{ selected.validation.errors.join('；') }}</p>
        </div>
        <label class="json-editor-label" for="question-json">INFO.JSON</label>
        <textarea id="question-json" v-model="editor" spellcheck="false" />
        <div class="admin-editor__actions">
          <button class="button button--primary" :disabled="busy" @click="saveInfo"><Save :size="17" />保存信息</button>
          <label class="button"><Upload :size="17" />替换题图<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" :disabled="busy" @change="uploadImage($event, 'question')" /></label>
          <label class="button"><Upload :size="17" />替换完整图<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" :disabled="busy" @change="uploadImage($event, 'reveal')" /></label>
        </div>
        <p v-if="message" class="admin-message">{{ message }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>
    </section>
    <section v-else class="center-state">正在读取题库...</section>
  </main>
</template>
