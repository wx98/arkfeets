<script setup lang="ts">
import { ArrowLeft, Check, Layers3, Plus, Save, Trash2 } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import TopicQuestionBrowser, { type TopicQuestionPreview } from "../components/TopicQuestionBrowser.vue";

interface Topic { id: string; name: string; isDefault: boolean; questionCount: number }
interface ThumbnailProgress { total: number; ready: number; failed: number }
const router = useRouter();
const checking = ref(true);
const authenticated = ref(false);
const busy = ref(false);
const error = ref("");
const message = ref("");
const password = ref("");
const topics = ref<Topic[]>([]);
const selectedId = ref("");
const editedName = ref("");
const newName = ref("");
const questions = ref<TopicQuestionPreview[]>([]);
const questionsLoading = ref(false);
const questionsError = ref("");
const thumbnailProgress = ref<ThumbnailProgress | null>(null);
let questionRequest = 0;
let progressTimer: ReturnType<typeof setInterval> | undefined;
const selected = computed(() => topics.value.find((topic) => topic.id === selectedId.value));

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `请求失败 (${response.status})`);
  return body as T;
}

async function loadTopics(preferredId = selectedId.value) {
  topics.value = await request<Topic[]>("/api/admin/topics");
  await choose(topics.value.find((topic) => topic.id === preferredId) ?? topics.value[0]);
}

async function choose(topic?: Topic) {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = undefined;
  thumbnailProgress.value = null;
  selectedId.value = topic?.id ?? "";
  editedName.value = topic?.name ?? "";
  error.value = "";
  message.value = "";
  questions.value = [];
  questionsError.value = "";
  const requestId = ++questionRequest;
  if (!topic) return;
  questionsLoading.value = true;
  try {
    const result = await request<TopicQuestionPreview[]>(`/api/admin/topics/${encodeURIComponent(topic.id)}/questions`);
    if (requestId === questionRequest) {
      questions.value = result;
      const progress = await refreshThumbnailProgress(topic.id, requestId);
      if (progress && progress.ready + progress.failed < progress.total) {
        progressTimer = setInterval(() => { void refreshThumbnailProgress(topic.id, requestId); }, 1_500);
      }
    }
  } catch (cause) {
    if (requestId === questionRequest) questionsError.value = cause instanceof Error ? cause.message : "题目读取失败";
  } finally {
    if (requestId === questionRequest) questionsLoading.value = false;
  }
}

async function refreshThumbnailProgress(topicId: string, requestId: number): Promise<ThumbnailProgress | null> {
  try {
    const progress = await request<ThumbnailProgress>(`/api/admin/topics/${encodeURIComponent(topicId)}/thumbnail-progress`);
    if (requestId !== questionRequest) return null;
    thumbnailProgress.value = progress;
    if (progress.ready + progress.failed >= progress.total && progressTimer) {
      clearInterval(progressTimer);
      progressTimer = undefined;
    }
    return progress;
  } catch {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = undefined;
    return null;
  }
}


onMounted(async () => {
  try {
    await request("/api/admin/session");
    authenticated.value = true;
    await loadTopics();
  } catch (cause) {
    if (authenticated.value) error.value = cause instanceof Error ? cause.message : "主题列表读取失败";
  }
  finally { checking.value = false; }
});
onBeforeUnmount(() => { if (progressTimer) clearInterval(progressTimer); });

async function login() {
  busy.value = true; error.value = "";
  try {
    const session = await request<{ token: string }>("/api/admin/login", { method: "POST", body: JSON.stringify({ password: password.value }) });
    sessionStorage.setItem("arkfeets:admin-token", session.token);
    password.value = "";
    authenticated.value = true;
    await loadTopics();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "登录失败"; }
  finally { busy.value = false; }
}

async function createTopic() {
  if (!newName.value.trim()) return;
  busy.value = true; error.value = ""; message.value = "";
  try {
    const topic = await request<Topic>("/api/admin/topics", { method: "POST", body: JSON.stringify({ name: newName.value.trim() }) });
    newName.value = "";
    await loadTopics(topic.id);
    message.value = "主题已创建";
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "创建失败"; }
  finally { busy.value = false; }
}

async function updateTopic(makeDefault = false) {
  if (!selected.value) return;
  busy.value = true; error.value = ""; message.value = "";
  try {
    const topic = selected.value;
    await request(`/api/admin/topics/${encodeURIComponent(topic.id)}`, {
      method: "PUT", body: JSON.stringify({ name: editedName.value.trim(), isDefault: makeDefault || topic.isDefault }),
    });
    await loadTopics(topic.id);
    message.value = makeDefault ? "默认主题已更新" : "主题已保存";
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "保存失败"; }
  finally { busy.value = false; }
}

async function deleteTopic() {
  if (!selected.value || !window.confirm(`确定删除主题“${selected.value.name}”吗？`)) return;
  busy.value = true; error.value = ""; message.value = "";
  try {
    await request(`/api/admin/topics/${encodeURIComponent(selected.value.id)}`, { method: "DELETE" });
    await loadTopics("");
    message.value = "主题已删除";
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "删除失败"; }
  finally { busy.value = false; }
}
</script>

<template>
  <main class="topic-page">
    <header class="topic-page__header">
      <button title="返回后台管理" aria-label="返回后台管理" @click="router.push('/admin')"><ArrowLeft :size="20" /></button>
      <Layers3 :size="22" /><h1>主题管理</h1><small>TOPIC CONTROL</small>
    </header>
    <section v-if="checking" class="topic-page__state">正在验证管理会话...</section>
    <section v-else-if="!authenticated" class="topic-page__login">
      <h2>管理员验证</h2>
      <form @submit.prevent="login"><label for="topic-password">后台密码</label><input id="topic-password" v-model="password" type="password" autocomplete="current-password" required /><button :disabled="busy">进入主题管理</button></form>
      <p v-if="error" role="alert" class="topic-page__error">{{ error }}</p>
    </section>
    <div v-else class="topic-workbench">
      <aside class="topic-workbench__sidebar">
        <div class="topic-workbench__label"><strong>主题列表</strong><span>{{ topics.length }}</span></div>
        <nav aria-label="主题列表">
          <button v-for="topic in topics" :key="topic.id" :class="{ active: selectedId === topic.id }" @click="choose(topic)">
            <span>{{ topic.name }}</span><small v-if="topic.isDefault">默认</small><b>{{ topic.questionCount }}</b>
          </button>
        </nav>
        <form class="topic-create" @submit.prevent="createTopic">
          <label for="topic-new-name">新增主题</label>
          <div><input id="topic-new-name" v-model="newName" maxlength="60" placeholder="主题名称" /><button title="新增主题" aria-label="新增主题" :disabled="busy || !newName.trim()"><Plus :size="18" /></button></div>
        </form>
      </aside>
      <section v-if="selected" class="topic-detail">
        <div class="topic-detail__top">
          <div class="topic-detail__overview">
            <div class="topic-detail__heading"><small>TOPIC / {{ selected.id }}</small><h2>{{ selected.name }}</h2></div>
            <div class="topic-detail__stats"><span>关联题目 <strong>{{ selected.questionCount }}</strong></span><span :class="{ default: selected.isDefault }">{{ selected.isDefault ? '默认主题' : '普通主题' }}</span></div>
          </div>
          <div class="topic-detail__controls">
            <form class="topic-detail__form" @submit.prevent="updateTopic(false)"><label for="topic-edit-name">主题名称</label><input id="topic-edit-name" v-model="editedName" maxlength="60" required /><button :disabled="busy || !editedName.trim() || editedName.trim() === selected.name" title="保存名称"><Save :size="17" /><span>保存</span></button></form>
            <div class="topic-detail__actions">
              <button v-if="!selected.isDefault" :disabled="busy" @click="updateTopic(true)"><Check :size="17" />设为默认</button>
              <button class="danger" :disabled="busy || topics.length === 1 || selected.isDefault || selected.questionCount > 0" @click="deleteTopic"><Trash2 :size="17" />删除</button>
            </div>
          </div>
          <p v-if="message" class="topic-page__message" role="status">{{ message }}</p>
          <p v-if="error" class="topic-page__error" role="alert">{{ error }}</p>
        </div>
        <TopicQuestionBrowser :questions="questions" :loading="questionsLoading" :error="questionsError" :progress="thumbnailProgress" />
      </section>
      <section v-else class="topic-detail"><p v-if="error" class="topic-page__error" role="alert">{{ error }}</p></section>
    </div>
  </main>
</template>

<style scoped>
.topic-page { min-height: 100dvh; color: #262c2c; background: #f1f3ef; }
.topic-page__header { height: 70px; display: flex; align-items: center; gap: 14px; padding: 10px 24px; color: #fff; background: #25292b; }
.topic-page__header button { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid #6b7470; color: inherit; background: transparent; cursor: pointer; }
.topic-page__header h1 { margin: 0; font-size: 21px; }.topic-page__header small { margin-left: auto; color: #acb8b0; font-size: 10px; }
.topic-page__state { padding: 30px; }.topic-page__login { max-width: 400px; margin: 70px auto; padding: 24px; background: #fff; border-top: 3px solid #a4bc4b; }
.topic-page__login h2 { margin: 0 0 24px; font-size: 20px; }.topic-page__login form { display: grid; gap: 10px; }.topic-page__login label, .topic-create label, .topic-detail__form label { color: #66716b; font-size: 12px; }
.topic-page__login input, .topic-create input, .topic-detail__form input { min-width: 0; width: 100%; height: 36px; padding: 0 10px; border: 1px solid #b8c1bb; color: #25292b; background: #fff; font: inherit; }
.topic-page__login button, .topic-detail__form button { min-height: 36px; display: flex; align-items: center; justify-content: center; gap: 7px; border: 0; color: #25292b; background: #d9ef72; font: inherit; font-weight: 700; cursor: pointer; }
.topic-page button:disabled { opacity: .48; cursor: not-allowed; }
.topic-workbench { width: 100%; height: calc(100dvh - 70px); min-height: 460px; display: grid; grid-template-columns: minmax(240px,280px) minmax(0,1fr); }
.topic-workbench__sidebar { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 18px 14px; color: #fff; background: #202526; }.topic-workbench__label { display: flex; justify-content: space-between; margin-bottom: 12px; color: #bfc9c2; font-size: 13px; }
.topic-workbench nav { min-height: 0; display: block; flex: 1; overflow-y: auto; border-top: 2px solid #d9ef72; }.topic-workbench nav button { width: 100%; min-width: 0; min-height: 43px; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 0; border-bottom: 1px solid #414a47; color: #e2e9e3; background: transparent; text-align: left; cursor: pointer; }.topic-workbench nav button.active { color: #25292b; background: #d9ef72; }.topic-workbench nav button span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.topic-workbench nav small { font-size: 10px; }.topic-workbench nav b { min-width: 28px; text-align: right; font-size: 12px; }
.topic-create { display: grid; gap: 7px; margin-top: 15px; }.topic-create label { color: #c1cbc4; }.topic-create div { display: grid; grid-template-columns: 1fr 36px; }.topic-create button { display: grid; place-items: center; border: 0; color: #25292b; background: #d9ef72; cursor: pointer; }
.topic-detail { min-width: 0; min-height: 0; display: flex; flex-direction: column; }.topic-detail__top { flex: 0 0 auto; padding: 16px 20px 14px; background: #f1f3ef; }
.topic-detail__overview { display: flex; align-items: end; justify-content: space-between; gap: 15px; }.topic-detail__heading { min-width: 0; }.topic-detail__heading small { color: #6a746e; font-size: 10px; }.topic-detail__heading h2 { margin: 3px 0 0; font-size: 23px; line-height: 1.2; overflow-wrap: anywhere; }.topic-detail__stats { display: flex; align-items: center; gap: 8px; white-space: nowrap; }.topic-detail__stats span { padding: 6px 9px; border: 1px solid #c8d0c8; background: #fff; color: #59655b; font-size: 11px; }.topic-detail__stats strong { padding-left: 6px; color: #25292b; font-size: 14px; }.topic-detail__stats .default { border-color: #b8cc71; color: #3e571e; background: #e9f5c4; }
.topic-detail__controls { display: flex; align-items: end; gap: 12px; margin-top: 12px; }.topic-detail__form { min-width: 0; max-width: 470px; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 6px; flex: 1; }.topic-detail__form label { grid-column: 1 / -1; }.topic-detail__form button { padding: 0 12px; }.topic-detail__actions { display: flex; flex-wrap: wrap; gap: 6px; }.topic-detail__actions button { min-height: 36px; display: flex; align-items: center; gap: 5px; padding: 0 10px; border: 1px solid #8d9b8d; background: #fff; font: inherit; font-size: 12px; cursor: pointer; }.topic-detail__actions .danger { color: #a83f35; border-color: #cfaba6; }
.topic-page__error, .topic-page__message { margin: 9px 0 0; padding: 7px 10px; font-size: 12px; }.topic-page__error { color: #a83f35; background: #fff0ec; }.topic-page__message { color: #586c3b; background: #eaf3cf; }
@media (max-width: 740px) { .topic-page__header { padding-inline: 12px; }.topic-page__header small { display: none; }.topic-page__login { margin: 40px 16px; }.topic-workbench { height: auto; display: flex; flex-direction: column; }.topic-workbench__sidebar { height: 230px; padding: 12px; }.topic-create { margin-top: 8px; }.topic-detail { height: calc(100dvh - 70px); min-height: 460px; }.topic-detail__top { padding: 12px; }.topic-detail__overview { align-items: start; flex-direction: column; gap: 8px; }.topic-detail__controls { align-items: stretch; flex-direction: column; gap: 8px; }.topic-detail__form { max-width: none; }.topic-detail__actions { justify-content: flex-end; } }
</style>
