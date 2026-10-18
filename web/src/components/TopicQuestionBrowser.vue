<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { LayoutGrid, Search } from "lucide-vue-next";
import { useRouter } from "vue-router";
import type { CropRect } from "../types";
import TopicQuestionThumbnail from "./TopicQuestionThumbnail.vue";

export interface TopicQuestionPreview {
  id: string;
  title: string;
  tags: string[];
  hint: string;
  originalImage: string;
  question: CropRect | null;
  thumbnailUrl: string | null;
  enabled: boolean;
}

const props = defineProps<{ questions: TopicQuestionPreview[]; loading: boolean; error: string; progress: { total: number; ready: number; failed: number } | null }>();
const router = useRouter();
type ViewMode = "extra" | "large" | "medium" | "small" | "list" | "details" | "tiles" | "content";
const modes: { value: ViewMode; label: string }[] = [
  { value: "extra", label: "超大图标" }, { value: "large", label: "大图标" },
  { value: "medium", label: "中等图标" }, { value: "small", label: "小图标" },
  { value: "list", label: "列表" }, { value: "details", label: "详细信息" },
  { value: "tiles", label: "平铺" }, { value: "content", label: "内容" },
];
const search = ref("");
const storedMode = localStorage.getItem("arkfeets:topic-view");
const mode = ref<ViewMode>(modes.some((item) => item.value === storedMode) ? storedMode as ViewMode : "medium");
const thumbnails = reactive(new Map<string, { url: string; aspect: number }>());
const hoveredQuestion = ref<TopicQuestionPreview | null>(null);
const pointer = ref({ x: 0, y: 0 });
const hoverImage = computed(() => hoveredQuestion.value ? thumbnails.get(hoveredQuestion.value.id) : undefined);
const hoverStyle = computed(() => {
  const gutter = 12;
  const offset = 18;
  const border = 6;
  const crop = hoveredQuestion.value?.question;
  const aspect = hoverImage.value?.aspect ?? (crop ? crop.width / crop.height : 320 / 260);
  const contentWidth = Math.min(320, window.innerWidth - gutter * 2 - border, (window.innerHeight - gutter * 2 - border) * aspect);
  const width = contentWidth + border;
  const height = contentWidth / aspect + border;
  const right = pointer.value.x + offset;
  const left = right + width <= window.innerWidth - gutter ? right : pointer.value.x - width - offset;
  return {
    width: `${width}px`, height: `${height}px`,
    left: `${Math.max(gutter, Math.min(left, window.innerWidth - width - gutter))}px`,
    top: `${Math.max(gutter, Math.min(pointer.value.y - height / 2, window.innerHeight - height - gutter))}px`,
  };
});
const filtered = computed(() => {
  const needle = normalize(search.value);
  return needle ? props.questions.filter((question) => normalize([question.title, ...question.tags].join(" ")).includes(needle)) : props.questions;
});
const progressPercent = computed(() => props.progress?.total ? Math.round(props.progress.ready / props.progress.total * 100) : 100);
function normalize(value: string) { return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, ""); }
function changeMode(event: Event) {
  mode.value = (event.target as HTMLSelectElement).value as ViewMode;
  localStorage.setItem("arkfeets:topic-view", mode.value);
}
function editUrl(id: string) { return router.resolve({ path: "/admin/questions", query: { question: id } }).href; }
function setThumbnail(id: string, image: { url: string; aspect: number }) { thumbnails.set(id, image); }
function clearThumbnail(id: string) { thumbnails.delete(id); }
function movePreview(event: MouseEvent) { pointer.value = { x: event.clientX, y: event.clientY }; }
function showPreview(question: TopicQuestionPreview, event: MouseEvent) {
  if (!question.thumbnailUrl) return;
  hoveredQuestion.value = question;
  movePreview(event);
}
function hidePreview() {
  hoveredQuestion.value = null;
}
watch([() => props.questions, search, mode], hidePreview);
onBeforeUnmount(hidePreview);
</script>

<template>
  <section class="topic-browser" aria-label="主题题目">
    <header class="topic-browser__toolbar">
      <div class="topic-browser__title"><strong>主题题目</strong><span>{{ filtered.length }} / {{ questions.length }}</span></div>
      <div v-if="progress?.total" class="topic-browser__progress" role="progressbar" :aria-label="`缩略图计算 ${progress.ready} / ${progress.total}`" :aria-valuenow="progress.ready" aria-valuemin="0" :aria-valuemax="progress.total">
        <div><span>缩略图计算 {{ progress.ready }} / {{ progress.total }}</span><span v-if="progress.failed" class="topic-browser__progress-error">失败 {{ progress.failed }}</span><span v-else>{{ progressPercent }}%</span></div>
        <span class="topic-browser__progress-track"><span :style="{ width: `${progressPercent}%` }" /></span>
      </div>
      <label class="topic-browser__search"><Search :size="16" /><input v-model="search" type="search" placeholder="搜索题目名称或标签" aria-label="搜索题目名称或标签" /></label>
      <label class="topic-browser__mode"><LayoutGrid :size="16" /><select :value="mode" aria-label="题目视图" @change="changeMode"><option v-for="item in modes" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
    </header>
    <div class="topic-browser__body" @scroll.passive="hidePreview">
      <p v-if="loading" class="topic-browser__empty">正在读取题目...</p>
      <p v-else-if="error" class="topic-browser__error" role="alert">{{ error }}</p>
      <p v-else-if="!filtered.length" class="topic-browser__empty">{{ search ? '没有匹配的题目' : '此主题暂无题目' }}</p>
      <div v-else :class="['topic-browser__items', `topic-browser__items--${mode}`]">
        <div v-if="mode === 'details'" class="topic-browser__columns" aria-hidden="true"><span>谜面 / 标题</span><span>标签</span><span>关联原图</span><span>状态</span></div>
        <a v-for="question in filtered" :key="question.id" :href="editUrl(question.id)" target="_blank" rel="noopener noreferrer" class="topic-browser__item" :aria-label="`在新标签页编辑 ${question.title}`" @mouseenter="showPreview(question, $event)" @mousemove="movePreview" @mouseleave="hidePreview">
              <span class="topic-browser__thumb">
                <TopicQuestionThumbnail :url="question.thumbnailUrl" :alt="`${question.title}的谜面`" @ready="setThumbnail(question.id, $event)" @clear="clearThumbnail(question.id)" />
              </span>
              <span class="topic-browser__copy"><strong>{{ question.title }}</strong><small v-if="mode === 'content'">{{ question.hint || '暂无提示' }}</small></span>
              <span class="topic-browser__tags">{{ question.tags.join(' · ') || '无标签' }}</span>
              <span class="topic-browser__source">{{ question.originalImage || '无原图' }}</span>
              <span class="topic-browser__status" :class="{ 'topic-browser__status--off': !question.enabled }">{{ question.enabled ? '已启用' : '未启用' }}</span>
        </a>
      </div>
    </div>
    <Teleport to="body">
      <div v-if="hoveredQuestion && hoverImage" class="topic-browser-preview" :style="hoverStyle" role="img" :aria-label="`${hoveredQuestion.title}的谜面预览`">
        <img :src="hoverImage.url" alt="" />
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.topic-browser { min-height: 0; display: flex; flex: 1; flex-direction: column; border-top: 1px solid #c8d0c8; background: #f8faf7; }
.topic-browser__toolbar { display: flex; align-items: center; gap: 10px; padding: 11px 18px; border-bottom: 1px solid #d3dad3; background: #fff; }
.topic-browser__title { display: flex; align-items: baseline; gap: 9px; margin-right: auto; white-space: nowrap; }.topic-browser__title strong { font-size: 14px; }.topic-browser__title span { color: #707a72; font-size: 11px; }
.topic-browser__progress { width: 168px; flex: 0 0 168px; display: grid; gap: 4px; color: #59655c; font-size: 10px; }.topic-browser__progress > div { display: flex; justify-content: space-between; gap: 6px; white-space: nowrap; }.topic-browser__progress-error { color: #ad5f35; }.topic-browser__progress-track { height: 5px; overflow: hidden; background: #dce4d8; }.topic-browser__progress-track > span { display: block; height: 100%; background: #90ac34; transition: width .25s ease; }
.topic-browser__search, .topic-browser__mode { height: 34px; display: flex; align-items: center; gap: 7px; padding: 0 9px; border: 1px solid #b8c3b8; color: #58635a; background: #fff; }
.topic-browser__search { width: min(280px, 38%); }.topic-browser__search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 12px; }.topic-browser__mode select { max-width: 115px; border: 0; outline: 0; background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.topic-browser__body { min-height: 0; flex: 1; overflow: auto; padding: 16px 18px 26px; }.topic-browser__empty, .topic-browser__error { margin: 25px 0; color: #68736c; font-size: 13px; }.topic-browser__error { color: #a83f35; }
.topic-browser__items { display: grid; align-content: start; gap: 10px; }.topic-browser__item { box-sizing: border-box; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: stretch; gap: 7px; padding: 7px; border: 1px solid transparent; color: #252d28; background: transparent; text-align: left; text-decoration: none; font: inherit; cursor: pointer; }.topic-browser__item:hover, .topic-browser__item:focus-visible { border-color: #a1b956; background: #eef5df; outline: 0; }
.topic-browser__thumb { position: relative; width: 100%; aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; color: #7b847e; background-color: #fff; background-image: linear-gradient(45deg,#e5e9e5 25%,transparent 25%),linear-gradient(-45deg,#e5e9e5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e9e5 75%),linear-gradient(-45deg,transparent 75%,#e5e9e5 75%); background-size: 18px 18px; background-position: 0 0,0 9px,9px -9px,-9px 0; }
.topic-browser__copy { min-width: 0; }.topic-browser__copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }.topic-browser__copy small { display: block; margin-top: 4px; color: #68736c; font-size: 11px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.topic-browser__tags, .topic-browser__source, .topic-browser__status { display: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #68736c; font-size: 11px; }
.topic-browser__items--extra { grid-template-columns: repeat(auto-fill,minmax(230px,1fr)); }.topic-browser__items--large { grid-template-columns: repeat(auto-fill,minmax(175px,1fr)); }.topic-browser__items--medium { grid-template-columns: repeat(auto-fill,minmax(125px,1fr)); }.topic-browser__items--small { grid-template-columns: repeat(auto-fill,minmax(88px,1fr)); }
.topic-browser__items--list, .topic-browser__items--details { display: block; }.topic-browser__items--list .topic-browser__item, .topic-browser__items--details .topic-browser__item { width: 100%; min-height: 40px; flex-direction: row; align-items: center; gap: 10px; padding: 4px 8px; border-bottom: 1px solid #e1e6df; }.topic-browser__items--list .topic-browser__thumb, .topic-browser__items--details .topic-browser__thumb { width: 30px; height: 30px; flex: 0 0 30px; }.topic-browser__items--list .topic-browser__copy { flex: 1; }
.topic-browser__columns, .topic-browser__items--details .topic-browser__item { display: grid; grid-template-columns: minmax(140px,2fr) minmax(90px,1fr) minmax(100px,1fr) 64px; gap: 12px; }.topic-browser__columns { padding: 7px 8px; color: #657066; border-bottom: 2px solid #b9c6b7; font-size: 11px; }.topic-browser__items--details .topic-browser__item { min-height: 47px; }.topic-browser__items--details .topic-browser__item::first-line { line-height: 1; }.topic-browser__items--details .topic-browser__copy { min-width: 0; }.topic-browser__items--details .topic-browser__thumb { float: left; margin-right: 9px; }.topic-browser__items--details .topic-browser__tags, .topic-browser__items--details .topic-browser__source, .topic-browser__items--details .topic-browser__status { display: block; }.topic-browser__items--details .topic-browser__item { grid-template-columns: minmax(140px,2fr) minmax(90px,1fr) minmax(100px,1fr) 64px; }.topic-browser__items--details .topic-browser__thumb { grid-column: 1; grid-row: 1; }.topic-browser__items--details .topic-browser__copy { grid-column: 1; grid-row: 1; padding-left: 40px; }
.topic-browser__items--tiles { grid-template-columns: repeat(auto-fill,minmax(240px,1fr)); }.topic-browser__items--tiles .topic-browser__item, .topic-browser__items--content .topic-browser__item { flex-direction: row; align-items: center; gap: 12px; }.topic-browser__items--tiles .topic-browser__thumb { width: 78px; flex: 0 0 78px; }.topic-browser__items--tiles .topic-browser__copy, .topic-browser__items--content .topic-browser__copy { flex: 1; }.topic-browser__items--tiles .topic-browser__tags { display: block; max-width: 95px; }
.topic-browser__items--content { grid-template-columns: repeat(auto-fill,minmax(310px,1fr)); }.topic-browser__items--content .topic-browser__item { padding: 10px; border-bottom: 1px solid #d9e0d8; }.topic-browser__items--content .topic-browser__thumb { width: 120px; flex: 0 0 120px; }.topic-browser__items--content .topic-browser__tags { display: block; max-width: 120px; }
.topic-browser__status--off { color: #a36c4a; }
.topic-browser-preview { position: fixed; z-index: 100; display: grid; place-items: center; overflow: hidden; border: 3px solid var(--signal); background-color: #f2f4f3; background-image: conic-gradient(#d5d9d7 25%, #f2f4f3 0 50%, #d5d9d7 0 75%, #f2f4f3 0); background-size: 18px 18px; box-shadow: 8px 8px 0 rgba(0,0,0,.35); pointer-events: none; }
.topic-browser-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
@media (hover: none) { .topic-browser-preview { display: none; } }
@media (max-width: 1050px) { .topic-browser__toolbar { flex-wrap: wrap; }.topic-browser__title { flex: 1 1 140px; margin-right: 0; }.topic-browser__progress { flex: 1 1 168px; }.topic-browser__search { flex: 1 1 190px; width: auto; } }
@media (max-width: 740px) { .topic-browser__toolbar { flex-wrap: wrap; }.topic-browser__title { width: 100%; }.topic-browser__progress { flex: 1 1 100%; width: 100%; }.topic-browser__search { flex: 1; width: auto; }.topic-browser__columns, .topic-browser__items--details .topic-browser__item { grid-template-columns: minmax(110px,2fr) minmax(80px,1fr) 55px; }.topic-browser__columns span:nth-child(3), .topic-browser__items--details .topic-browser__source { display: none; }.topic-browser__items--details .topic-browser__status { display: block; } }
</style>
