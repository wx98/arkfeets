<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CropRect } from "../types";

type Region = { x: number; y: number; width: number; height: number };
const props = withDefaults(defineProps<{
  imageUrl: string;
  crop?: CropRect | null;
  interactive?: boolean;
  animate?: boolean;
}>(), { crop: null, interactive: false, animate: false });

const stage = ref<HTMLElement>();
const stageSize = ref({ width: 1, height: 1 });
const imageSize = ref({ width: 1, height: 1 });
const progress = ref(props.animate && props.crop ? 0 : 1);
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
let observer: ResizeObserver | undefined;
let animationFrame = 0;
let drag: { x: number; y: number; panX: number; panY: number } | undefined;

const sourceWidth = computed(() => props.crop?.sourceWidth || imageSize.value.width);
const sourceHeight = computed(() => props.crop?.sourceHeight || imageSize.value.height);
const fullRegion = computed<Region>(() => ({ x: 0, y: 0, width: sourceWidth.value, height: sourceHeight.value }));
const targetRegion = computed<Region>(() => {
  const crop = props.crop;
  if (!crop) return fullRegion.value;
  const x = Math.max(0, crop.x - crop.width / 2);
  const y = Math.max(0, crop.y - crop.height / 2);
  const right = Math.min(sourceWidth.value, crop.x + crop.width * 1.5);
  const bottom = Math.min(sourceHeight.value, crop.y + crop.height * 1.5);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
});
const viewRegion = computed<Region>(() => {
  const full = fullRegion.value;
  const target = targetRegion.value;
  const t = progress.value;
  const width = (full.width + (target.width - full.width) * t) / zoom.value;
  const height = (full.height + (target.height - full.height) * t) / zoom.value;
  const cx = full.width / 2 + ((target.x + target.width / 2) - full.width / 2) * t + pan.value.x;
  const cy = full.height / 2 + ((target.y + target.height / 2) - full.height / 2) * t + pan.value.y;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
});
const imageLayout = computed(() => {
  const region = viewRegion.value;
  const scale = Math.min(stageSize.value.width / region.width, stageSize.value.height / region.height);
  const left = stageSize.value.width / 2 - (region.x + region.width / 2) * scale;
  const top = stageSize.value.height / 2 - (region.y + region.height / 2) * scale;
  return { scale, left, top };
});
const imageStyle = computed(() => ({
  width: `${sourceWidth.value * imageLayout.value.scale}px`,
  height: `${sourceHeight.value * imageLayout.value.scale}px`,
  left: `${imageLayout.value.left}px`,
  top: `${imageLayout.value.top}px`,
}));
const selectionStyle = computed(() => {
  if (!props.crop) return {};
  const { scale, left, top } = imageLayout.value;
  return {
    left: `${left + props.crop.x * scale}px`,
    top: `${top + props.crop.y * scale}px`,
    width: `${props.crop.width * scale}px`,
    height: `${props.crop.height * scale}px`,
  };
});

function startAnimation() {
  cancelAnimationFrame(animationFrame);
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
  if (!props.animate || !props.crop || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    progress.value = 1;
    return;
  }
  progress.value = 0;
  const started = performance.now();
  const duration = 1900;
  const tick = (now: number) => {
    const elapsed = Math.min(1, (now - started) / duration);
    progress.value = Math.log1p(24 * elapsed) / Math.log1p(24);
    if (elapsed < 1) animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
}

function zoomBy(factor: number) {
  if (!props.interactive) return;
  cancelAnimationFrame(animationFrame);
  progress.value = 1;
  zoom.value = Math.min(8, Math.max(props.crop ? 0.5 : 1, zoom.value * factor));
}

function resetView() {
  cancelAnimationFrame(animationFrame);
  progress.value = 1;
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
}

function handleWheel(event: WheelEvent) {
  if (!props.interactive) return;
  event.preventDefault();
  zoomBy(event.deltaY < 0 ? 1.18 : 1 / 1.18);
}

function startDrag(event: PointerEvent) {
  if (!props.interactive || event.button !== 0) return;
  cancelAnimationFrame(animationFrame);
  progress.value = 1;
  drag = { x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y };
  stage.value?.setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent) {
  if (!drag) return;
  pan.value = {
    x: drag.panX - (event.clientX - drag.x) / imageLayout.value.scale,
    y: drag.panY - (event.clientY - drag.y) / imageLayout.value.scale,
  };
}

function stopDrag() { drag = undefined; }

function handleImageLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  imageSize.value = { width: image.naturalWidth || 1, height: image.naturalHeight || 1 };
}

watch(() => [props.imageUrl, props.crop], startAnimation);
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    stageSize.value = { width: entry.contentRect.width || 1, height: entry.contentRect.height || 1 };
  });
  if (stage.value) observer.observe(stage.value);
  startAnimation();
});
onBeforeUnmount(() => { cancelAnimationFrame(animationFrame); observer?.disconnect(); });
defineExpose({ zoomBy, resetView });
</script>

<template>
  <div ref="stage" class="crop-image-canvas" :class="{ 'is-interactive': interactive }"
    @wheel="handleWheel" @pointerdown="startDrag" @pointermove="moveDrag"
    @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag">
    <img :src="imageUrl" :style="imageStyle" alt="" draggable="false" @load="handleImageLoad" />
    <div v-if="crop" class="crop-image-canvas__selection" :style="selectionStyle" />
  </div>
</template>
