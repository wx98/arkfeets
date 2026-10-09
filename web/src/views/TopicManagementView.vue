<script setup lang="ts">
import { ArrowLeft, Check, Layers3, Plus, Save, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

interface Topic { id: string; name: string; isDefault: boolean; questionCount: number }
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
const selected = computed(() => topics.value.find((topic) => topic.id === selectedId.value));

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `请求失败 (${response.status})`);
  return body as T;
}

async function loadTopics(preferredId = selectedId.value) {
  topics.value = await request<Topic[]>("/api/admin/topics");
  choose(topics.value.find((topic) => topic.id === preferredId) ?? topics.value[0]);
}

function choose(topic?: Topic) {
  selectedId.value = topic?.id ?? "";
  editedName.value = topic?.name ?? "";
  error.value = "";
  message.value = "";
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
      <aside>
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
        <div class="topic-detail__heading"><small>TOPIC / {{ selected.id }}</small><h2>{{ selected.name }}</h2></div>
        <div class="topic-detail__stats"><div><span>关联题目</span><strong>{{ selected.questionCount }}</strong></div><div><span>默认主题</span><strong>{{ selected.isDefault ? '是' : '否' }}</strong></div></div>
        <form class="topic-detail__form" @submit.prevent="updateTopic(false)"><label for="topic-edit-name">主题名称</label><input id="topic-edit-name" v-model="editedName" maxlength="60" required /><button :disabled="busy || !editedName.trim() || editedName.trim() === selected.name"><Save :size="17" />保存名称</button></form>
        <div class="topic-detail__actions">
          <button v-if="!selected.isDefault" :disabled="busy" @click="updateTopic(true)"><Check :size="17" />设为默认</button>
          <button class="danger" :disabled="busy || topics.length === 1 || selected.isDefault || selected.questionCount > 0" @click="deleteTopic"><Trash2 :size="17" />删除主题</button>
        </div>
        <p v-if="message" class="topic-page__message" role="status">{{ message }}</p>
        <p v-if="error" class="topic-page__error" role="alert">{{ error }}</p>
      </section>
      <section v-else class="topic-detail"><p v-if="error" class="topic-page__error" role="alert">{{ error }}</p></section>
    </div>
  </main>
</template>

<style scoped>
.topic-page { min-height: 100dvh; color: #262c2c; background: #f1f3ef; }
.topic-page__header { min-height: 70px; display: flex; align-items: center; gap: 14px; padding: 10px 24px; color: #fff; background: #25292b; }
.topic-page__header button { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid #6b7470; color: inherit; background: transparent; cursor: pointer; }
.topic-page__header h1 { margin: 0; font-size: 21px; }.topic-page__header small { margin-left: auto; color: #acb8b0; font-size: 10px; }
.topic-page__state { padding: 30px; }.topic-page__login { max-width: 400px; margin: 70px auto; padding: 24px; background: #fff; border-top: 3px solid #a4bc4b; }
.topic-page__login h2 { margin: 0 0 24px; font-size: 20px; }.topic-page__login form { display: grid; gap: 10px; }.topic-page__login label, .topic-create label, .topic-detail__form label { color: #66716b; font-size: 12px; }
.topic-page__login input, .topic-create input, .topic-detail__form input { min-width: 0; width: 100%; height: 42px; padding: 0 10px; border: 1px solid #b8c1bb; color: #25292b; background: #fff; font: inherit; }
.topic-page__login button, .topic-detail__form button { min-height: 42px; display: flex; align-items: center; justify-content: center; gap: 7px; border: 0; color: #25292b; background: #d9ef72; font: inherit; font-weight: 700; cursor: pointer; }
.topic-page button:disabled { opacity: .48; cursor: not-allowed; }
.topic-workbench { width: min(1100px,100%); min-height: calc(100dvh - 70px); display: grid; grid-template-columns: minmax(260px,320px) minmax(0,1fr); margin: auto; }
.topic-workbench aside { min-width: 0; padding: 24px 16px; color: #fff; background: #202526; }.topic-workbench__label { display: flex; justify-content: space-between; margin-bottom: 15px; color: #bfc9c2; font-size: 13px; }
.topic-workbench nav { display: grid; max-height: 54dvh; overflow-y: auto; border-top: 2px solid #d9ef72; }.topic-workbench nav button { min-width: 0; min-height: 48px; display: flex; align-items: center; gap: 8px; padding: 10px; border: 0; border-bottom: 1px solid #414a47; color: #e2e9e3; background: transparent; text-align: left; cursor: pointer; }.topic-workbench nav button.active { color: #25292b; background: #d9ef72; }.topic-workbench nav button span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.topic-workbench nav small { font-size: 10px; }.topic-workbench nav b { min-width: 28px; text-align: right; font-size: 12px; }
.topic-create { display: grid; gap: 8px; margin-top: 24px; }.topic-create label { color: #c1cbc4; }.topic-create div { display: grid; grid-template-columns: 1fr 42px; }.topic-create button { display: grid; place-items: center; border: 0; color: #25292b; background: #d9ef72; cursor: pointer; }
.topic-detail { min-width: 0; padding: 42px 38px; }.topic-detail__heading { padding-bottom: 18px; border-bottom: 1px solid #c4cdc5; }.topic-detail__heading small { color: #6a746e; font-size: 10px; }.topic-detail__heading h2 { margin: 8px 0 0; font-size: 27px; }.topic-detail__stats { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1px; margin: 20px 0 36px; background: #c6cec7; }.topic-detail__stats div { display: grid; gap: 10px; padding: 18px; background: #fff; }.topic-detail__stats span { color: #6b766e; font-size: 12px; }.topic-detail__stats strong { font-size: 25px; }
.topic-detail__form { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px 12px; }.topic-detail__form label { grid-column: 1 / -1; }.topic-detail__form button { padding: 0 16px; }.topic-detail__actions { display: flex; gap: 8px; margin-top: 26px; }.topic-detail__actions button { min-height: 40px; display: flex; align-items: center; gap: 7px; padding: 0 12px; border: 1px solid #8d9b8d; background: #fff; cursor: pointer; }.topic-detail__actions .danger { color: #a83f35; border-color: #cfaba6; }
.topic-page__error, .topic-page__message { margin-top: 18px; padding: 10px 12px; font-size: 12px; }.topic-page__error { color: #a83f35; background: #fff0ec; }.topic-page__message { color: #586c3b; background: #eaf3cf; }
@media (max-width: 680px) { .topic-page__header { padding-inline: 12px; }.topic-page__header small { display: none; }.topic-page__login { margin: 40px 16px; }.topic-workbench { display: block; }.topic-workbench aside { padding: 16px; }.topic-workbench nav { max-height: 240px; }.topic-detail { padding: 24px 16px; }.topic-detail__form { grid-template-columns: 1fr; } }
</style>
