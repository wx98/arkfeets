<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface Coordinates { left: number; top: number; width: number; height: number }
interface CropResult { coordinates: Coordinates; image: { width: number; height: number } }

const props = defineProps<{ src: string; aspectRatio?: number }>();
const emit = defineEmits<{ ready: []; change: [result: CropResult] }>();
const viewport = ref<HTMLElement>();
const viewportWidth = ref(0);
const viewportHeight = ref(0);
const sourceWidth = ref(0);
const sourceHeight = ref(0);
const zoomLevel = ref(1);
const coordinates = ref<Coordinates>({ left: 0, top: 0, width: 1, height: 1 });
let observer: ResizeObserver | undefined;
let drag: { pointerId: number; mode: string; x: number; y: number; start: Coordinates } | undefined;

const baseScale = computed(() => sourceWidth.value && sourceHeight.value
  ? Math.min(viewportWidth.value * .9 / sourceWidth.value, viewportHeight.value * .9 / sourceHeight.value)
  : 1);
const displayScale = computed(() => baseScale.value * zoomLevel.value);
const imageWidth = computed(() => sourceWidth.value * displayScale.value);
const imageHeight = computed(() => sourceHeight.value * displayScale.value);
const stageWidth = computed(() => Math.max(viewportWidth.value, imageWidth.value));
const stageHeight = computed(() => Math.max(viewportHeight.value, imageHeight.value));
const imageLeft = computed(() => (stageWidth.value - imageWidth.value) / 2);
const imageTop = computed(() => (stageHeight.value - imageHeight.value) / 2);
const imageStyle = computed(() => ({
  width: `${imageWidth.value}px`, height: `${imageHeight.value}px`,
  left: `${imageLeft.value}px`, top: `${imageTop.value}px`,
}));
const frameStyle = computed(() => ({
  left: `${imageLeft.value + coordinates.value.left * displayScale.value}px`,
  top: `${imageTop.value + coordinates.value.top * displayScale.value}px`,
  width: `${coordinates.value.width * displayScale.value}px`,
  height: `${coordinates.value.height * displayScale.value}px`,
}));

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function setCoordinates(next: Coordinates) {
  if (!sourceWidth.value || !sourceHeight.value) return;
  const width = clamp(next.width, 1, sourceWidth.value);
  const height = clamp(next.height, 1, sourceHeight.value);
  coordinates.value = {
    left: clamp(next.left, 0, sourceWidth.value - width),
    top: clamp(next.top, 0, sourceHeight.value - height),
    width, height,
  };
  emit("change", getResult());
}

function getResult(): CropResult {
  return { coordinates: { ...coordinates.value }, image: { width: sourceWidth.value, height: sourceHeight.value } };
}

async function zoom(factor: number, clientX?: number, clientY?: number) {
  const element = viewport.value;
  if (!element || !sourceWidth.value) return;
  const next = clamp(zoomLevel.value * factor, 1, 6);
  if (next === zoomLevel.value) return;
  const bounds = element.getBoundingClientRect();
  const screenX = clientX === undefined ? viewportWidth.value / 2 : clamp(clientX - bounds.left, 0, viewportWidth.value);
  const screenY = clientY === undefined ? viewportHeight.value / 2 : clamp(clientY - bounds.top, 0, viewportHeight.value);
  const sourceX = clientX === undefined
    ? coordinates.value.left + coordinates.value.width / 2
    : (element.scrollLeft + screenX - imageLeft.value) / displayScale.value;
  const sourceY = clientY === undefined
    ? coordinates.value.top + coordinates.value.height / 2
    : (element.scrollTop + screenY - imageTop.value) / displayScale.value;
  zoomLevel.value = next;
  await nextTick();
  element.scrollTo({
    left: imageLeft.value + sourceX * displayScale.value - screenX,
    top: imageTop.value + sourceY * displayScale.value - screenY,
  });
}

function onWheel(event: WheelEvent) {
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight.value : 1);
  void zoom(Math.exp(clamp(-delta * .0015, -.25, .25)), event.clientX, event.clientY);
}

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  sourceWidth.value = image.naturalWidth;
  sourceHeight.value = image.naturalHeight;
  if (!sourceWidth.value || !sourceHeight.value) return;
  const width = sourceWidth.value * .6;
  const height = props.aspectRatio ? Math.min(sourceHeight.value, width / props.aspectRatio) : sourceHeight.value * .6;
  setCoordinates({ left: (sourceWidth.value - width) / 2, top: (sourceHeight.value - height) / 2, width, height });
  emit("ready");
}

function startDrag(event: PointerEvent, mode: string) {
  if (!event.isPrimary) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag = { pointerId: event.pointerId, mode, x: event.clientX, y: event.clientY, start: { ...coordinates.value } };
}

function moveDrag(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = (event.clientX - drag.x) / displayScale.value;
  const dy = (event.clientY - drag.y) / displayScale.value;
  const start = drag.start;
  if (drag.mode === "move") {
    setCoordinates({ ...start, left: start.left + dx, top: start.top + dy });
    return;
  }
  const west = drag.mode.includes("w");
  const north = drag.mode.includes("n");
  const anchorX = west ? start.left + start.width : start.left;
  const anchorY = north ? start.top + start.height : start.top;
  const maxWidth = west ? anchorX : sourceWidth.value - anchorX;
  const maxHeight = north ? anchorY : sourceHeight.value - anchorY;
  let width = clamp(start.width + (west ? -dx : dx), 8, maxWidth);
  let height = clamp(start.height + (north ? -dy : dy), 8, maxHeight);
  if (props.aspectRatio) {
    if (Math.abs(dy) * props.aspectRatio > Math.abs(dx)) width = height * props.aspectRatio;
    width = clamp(width, 8, Math.min(maxWidth, maxHeight * props.aspectRatio));
    height = width / props.aspectRatio;
  }
  setCoordinates({ left: west ? anchorX - width : anchorX, top: north ? anchorY - height : anchorY, width, height });
}

function stopDrag(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) drag = undefined;
}

watch(() => props.aspectRatio, (ratio) => {
  if (!ratio || !sourceWidth.value) return;
  const current = coordinates.value;
  const width = Math.min(current.width, sourceWidth.value, sourceHeight.value * ratio);
  const height = width / ratio;
  setCoordinates({ left: current.left + (current.width - width) / 2, top: current.top + (current.height - height) / 2, width, height });
});

onMounted(() => {
  observer = new ResizeObserver(() => {
    viewportWidth.value = viewport.value?.clientWidth ?? 0;
    viewportHeight.value = viewport.value?.clientHeight ?? 0;
  });
  if (viewport.value) observer.observe(viewport.value);
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({ getResult, setCoordinates, zoom });
</script>

<template>
  <div ref="viewport" class="image-crop-editor" @wheel.prevent="onWheel">
    <div class="image-crop-editor__stage" :style="{ width: `${stageWidth}px`, height: `${stageHeight}px` }">
      <img :src="src" :style="imageStyle" draggable="false" alt="" @load="onImageLoad" />
      <div v-if="sourceWidth && sourceHeight" class="image-crop-editor__frame" :style="frameStyle"
        @pointerdown="startDrag($event, 'move')" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag">
        <span v-for="corner in ['nw', 'ne', 'sw', 'se']" :key="corner" :class="`image-crop-editor__handle image-crop-editor__handle--${corner}`"
          @pointerdown.stop="startDrag($event, corner)" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag" />
      </div>
    </div>
  </div>
</template>
