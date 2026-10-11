<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface Coordinates { left: number; top: number; width: number; height: number }
interface CropResult { coordinates: Coordinates; image: { width: number; height: number } }
type DragMode = "pan" | "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e";

const props = defineProps<{ src: string; aspectRatio?: number }>();
const emit = defineEmits<{ ready: []; change: [result: CropResult] }>();
const viewport = ref<HTMLElement>();
const viewportSize = ref({ width: 1, height: 1 });
const imageSize = ref({ width: 0, height: 0 });
const coordinates = ref<Coordinates>({ left: 0, top: 0, width: 1, height: 1 });
const zoomLevel = ref(1);
const pan = ref({ x: 0, y: 0 });
const dragging = ref(false);
let observer: ResizeObserver | undefined;
let lastPointer: { x: number; y: number } | undefined;
let drag: { pointerId: number; mode: DragMode; x: number; y: number; scale: number; pan: { x: number; y: number }; crop: Coordinates } | undefined;

const baseScale = computed(() => imageSize.value.width && imageSize.value.height
  ? Math.min(viewportSize.value.width * .9 / imageSize.value.width, viewportSize.value.height * .9 / imageSize.value.height)
  : 1);
const scale = computed(() => baseScale.value * zoomLevel.value);
const imageLeft = computed(() => (viewportSize.value.width - imageSize.value.width * scale.value) / 2 + pan.value.x);
const imageTop = computed(() => (viewportSize.value.height - imageSize.value.height * scale.value) / 2 + pan.value.y);
const imageStyle = computed(() => ({
  left: `${imageLeft.value}px`, top: `${imageTop.value}px`,
  width: `${imageSize.value.width * scale.value}px`, height: `${imageSize.value.height * scale.value}px`,
}));
const frameStyle = computed(() => ({
  left: `${imageLeft.value + coordinates.value.left * scale.value}px`,
  top: `${imageTop.value + coordinates.value.top * scale.value}px`,
  width: `${coordinates.value.width * scale.value}px`,
  height: `${coordinates.value.height * scale.value}px`,
}));

function clamp(value: number, min: number, max: number) { return Math.min(Math.max(value, min), max); }

function setCoordinates(next: Coordinates) {
  const { width: sourceWidth, height: sourceHeight } = imageSize.value;
  if (!sourceWidth || !sourceHeight) return;
  const width = clamp(next.width, 1, sourceWidth);
  const height = clamp(next.height, 1, sourceHeight);
  coordinates.value = {
    left: clamp(next.left, 0, sourceWidth - width),
    top: clamp(next.top, 0, sourceHeight - height),
    width, height,
  };
  emit("change", getResult());
}

function getResult(): CropResult {
  return { coordinates: { ...coordinates.value }, image: { ...imageSize.value } };
}

function zoom(factor: number, clientX?: number, clientY?: number) {
  const element = viewport.value;
  if (!element || !imageSize.value.width || drag) return;
  const next = clamp(zoomLevel.value * factor, .5, 8);
  if (next === zoomLevel.value) return;
  const bounds = element.getBoundingClientRect();
  const focusX = clamp((clientX ?? lastPointer?.x ?? bounds.left + bounds.width / 2) - bounds.left, 0, bounds.width);
  const focusY = clamp((clientY ?? lastPointer?.y ?? bounds.top + bounds.height / 2) - bounds.top, 0, bounds.height);
  const sourceX = (focusX - imageLeft.value) / scale.value;
  const sourceY = (focusY - imageTop.value) / scale.value;
  const nextScale = baseScale.value * next;
  pan.value = {
    x: focusX - sourceX * nextScale - (viewportSize.value.width - imageSize.value.width * nextScale) / 2,
    y: focusY - sourceY * nextScale - (viewportSize.value.height - imageSize.value.height * nextScale) / 2,
  };
  zoomLevel.value = next;
}

function resetView() {
  zoomLevel.value = 1;
  pan.value = { x: 0, y: 0 };
}

function onWheel(event: WheelEvent) {
  event.preventDefault();
  zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
}

function startDrag(event: PointerEvent, mode: DragMode) {
  if (event.button !== 0 || !imageSize.value.width) return;
  event.preventDefault();
  viewport.value?.setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId, mode, x: event.clientX, y: event.clientY, scale: scale.value,
    pan: { ...pan.value }, crop: { ...coordinates.value },
  };
  dragging.value = true;
}

function moveDrag(event: PointerEvent) {
  lastPointer = { x: event.clientX, y: event.clientY };
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (drag.mode === "pan") {
    pan.value = { x: drag.pan.x + dx, y: drag.pan.y + dy };
    return;
  }
  const x = dx / drag.scale;
  const y = dy / drag.scale;
  const start = drag.crop;
  if (drag.mode === "move") {
    setCoordinates({ ...start, left: start.left + x, top: start.top + y });
    return;
  }
  const west = drag.mode.includes("w");
  const east = drag.mode.includes("e");
  const north = drag.mode.includes("n");
  const south = drag.mode.includes("s");
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  let left = west ? clamp(start.left + x, 0, right - 8) : start.left;
  let top = north ? clamp(start.top + y, 0, bottom - 8) : start.top;
  let width = west ? right - left : east ? clamp(start.width + x, 8, imageSize.value.width - start.left) : start.width;
  let height = north ? bottom - top : south ? clamp(start.height + y, 8, imageSize.value.height - start.top) : start.height;
  if (props.aspectRatio && (west || east) && (north || south)) {
    const ratio = props.aspectRatio;
    if (Math.abs(y) * ratio > Math.abs(x)) width = height * ratio;
    width = clamp(width, 8, Math.min(west ? right : imageSize.value.width - left, (north ? bottom : imageSize.value.height - top) * ratio));
    height = width / ratio;
    if (west) left = right - width;
    if (north) top = bottom - height;
  }
  setCoordinates({ left, top, width, height });
}

function stopDrag(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) {
    drag = undefined;
    dragging.value = false;
  }
}

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  imageSize.value = { width: image.naturalWidth, height: image.naturalHeight };
  if (!image.naturalWidth || !image.naturalHeight) return;
  zoomLevel.value = 1;
  pan.value = { x: 0, y: 0 };
  setCoordinates({
    left: image.naturalWidth * .1, top: image.naturalHeight * .1,
    width: image.naturalWidth * .8, height: image.naturalHeight * .8,
  });
  emit("ready");
}

watch(() => props.aspectRatio, (ratio) => {
  if (!ratio || !imageSize.value.width) return;
  const current = coordinates.value;
  const width = Math.min(current.width, imageSize.value.width, imageSize.value.height * ratio);
  const height = width / ratio;
  setCoordinates({ left: current.left + (current.width - width) / 2, top: current.top + (current.height - height) / 2, width, height });
});

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    viewportSize.value = { width: entry.contentRect.width || 1, height: entry.contentRect.height || 1 };
  });
  if (viewport.value) observer.observe(viewport.value);
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({ getResult, setCoordinates, zoom, resetView });
</script>

<template>
  <div ref="viewport" class="image-crop-editor" :class="{ 'is-panning': dragging && drag?.mode === 'pan' }"
    @wheel="onWheel" @pointerdown="startDrag($event, 'pan')" @pointermove="moveDrag"
    @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag">
    <img :src="src" :style="imageStyle" alt="" draggable="false" @load="onImageLoad" />
    <div v-if="imageSize.width" class="image-crop-editor__frame" :style="frameStyle"
      @pointerdown.stop="startDrag($event, 'move')">
      <span v-for="side in ['n', 'e', 's', 'w']" v-show="!aspectRatio" :key="side"
        :class="`image-crop-editor__edge image-crop-editor__edge--${side}`" @pointerdown.stop="startDrag($event, side as DragMode)" />
      <span v-for="corner in ['nw', 'ne', 'sw', 'se']" :key="corner"
        :class="`image-crop-editor__handle image-crop-editor__handle--${corner}`" @pointerdown.stop="startDrag($event, corner as DragMode)" />
    </div>
  </div>
</template>
