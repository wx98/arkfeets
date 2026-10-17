<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ImageOff } from "lucide-vue-next";

const props = defineProps<{ url: string | null; alt: string }>();
const emit = defineEmits<{ ready: [image: { url: string; aspect: number }]; clear: [] }>();
const root = ref<HTMLElement>();
const imageUrl = ref("");
const progress = ref<number | null>(null);
const state = ref<"idle" | "loading" | "ready" | "error">("idle");
let observer: IntersectionObserver | undefined;
let request: XMLHttpRequest | undefined;
let objectUrl = "";

function stop() {
  emit("clear");
  observer?.disconnect();
  observer = undefined;
  request?.abort();
  request = undefined;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = "";
  imageUrl.value = "";
  progress.value = null;
  state.value = "idle";
}

function load() {
  if (!props.url || state.value !== "idle") return;
  state.value = "loading";
  const xhr = new XMLHttpRequest();
  request = xhr;
  xhr.open("GET", props.url);
  xhr.responseType = "blob";
  xhr.onprogress = (event) => {
    if (request === xhr) progress.value = event.lengthComputable ? Math.min(99, Math.round(event.loaded / event.total * 100)) : null;
  };
  xhr.onload = () => {
    if (request !== xhr) return;
    request = undefined;
    if (xhr.status !== 200) { state.value = "error"; return; }
    objectUrl = URL.createObjectURL(xhr.response as Blob);
    imageUrl.value = objectUrl;
    progress.value = 100;
  };
  xhr.onerror = () => { if (request === xhr) { request = undefined; state.value = "error"; } };
  xhr.send();
}

function observe() {
  if (!props.url || !root.value) return;
  if (!("IntersectionObserver" in window)) { load(); return; }
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); observer = undefined; load(); }
  }, { rootMargin: "240px" });
  observer.observe(root.value);
}

function imageFailed() {
  emit("clear");
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = "";
  imageUrl.value = "";
  state.value = "error";
}

onMounted(observe);
watch(() => props.url, () => { stop(); observe(); });
onBeforeUnmount(stop);
function imageReady(event: Event) {
  state.value = "ready";
  const image = event.target as HTMLImageElement;
  emit("ready", { url: imageUrl.value, aspect: image.naturalWidth / image.naturalHeight });
}
</script>

<template>
  <span ref="root" class="topic-thumbnail">
    <img v-if="imageUrl" :src="imageUrl" :alt="alt" loading="lazy" @load="imageReady" @error="imageFailed" />
    <span v-if="state === 'loading'" class="topic-thumbnail__loading" role="progressbar" :aria-label="`加载 ${alt}`" :aria-valuenow="progress ?? undefined" aria-valuemin="0" aria-valuemax="100">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="topic-thumbnail__track" cx="20" cy="20" r="16" /><circle class="topic-thumbnail__arc" :class="{ 'topic-thumbnail__arc--pending': progress === null }" cx="20" cy="20" r="16" :style="{ strokeDashoffset: progress === null ? 72 : 100 - progress }" /></svg>
      <small>{{ progress === null ? '···' : `${progress}%` }}</small>
    </span>
    <ImageOff v-else-if="!url || state === 'error'" :size="20" aria-hidden="true" />
  </span>
</template>

<style scoped>
.topic-thumbnail { position: relative; width: 100%; height: 100%; display: grid; place-items: center; overflow: hidden; color: #7b847e; }
.topic-thumbnail img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
.topic-thumbnail__loading { width: 43px; height: 43px; position: relative; display: grid; place-items: center; color: #283126; }
.topic-thumbnail__loading svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.topic-thumbnail__loading circle { fill: none; stroke-width: 3; }
.topic-thumbnail__track { stroke: #c7d1c0; }
.topic-thumbnail__arc { stroke: #90ac34; stroke-linecap: square; stroke-dasharray: 100; transition: stroke-dashoffset .15s linear; }
.topic-thumbnail__arc--pending { transform-box: fill-box; transform-origin: center; animation: topic-thumbnail-spin 1.1s linear infinite; }
.topic-thumbnail__loading small { z-index: 1; font-size: 9px; font-weight: 800; }
@keyframes topic-thumbnail-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .topic-thumbnail__arc--pending { animation: none; } }
</style>
