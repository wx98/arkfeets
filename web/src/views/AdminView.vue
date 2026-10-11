<script setup lang="ts">
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Database, Download, FilePlus2,
  Eye, FolderOpen, FolderUp, Image as ImageIcon, Images, Layers3, ListTree, LoaderCircle, LogIn, LogOut, Maximize2,
  PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, Save, Scissors, Search, Trash2, Upload, X, ZoomIn, ZoomOut,
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Cropper } from "vue-advanced-cropper";
import "vue-advanced-cropper/dist/style.css";
import { useRouter } from "vue-router";
import CropImageCanvas from "../components/CropImageCanvas.vue";
import type { CropRect, Difficulty } from "../types";

interface ImageMetadata {
  name: string;
  answers: string[];
  hint: string;
  difficulty: Difficulty[];
  tags: Array<Record<string, string>>;
}
interface MetadataTagRow { key: string; value: string }
interface LibraryImage {
  fileName: string;
  url: string;
  metadata: ImageMetadata;
  questionIds: string[];
  validCount: number;
  invalidCount: number;
  totalCount: number;
  topicIds: string[];
}
interface Topic { id: string; name: string; isDefault: boolean }
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
  topic: string[];
}
interface LibraryQuestion {
  id: string;
  info: Omit<QuestionRecord, "topic"> | null;
  topic: string[];
  originalImageUrl: string | null;
  validation: { valid: boolean; errors: string[] };
}
interface TrashedQuestion {
  trashId: string;
  id: string;
  info: Omit<QuestionRecord, "topic">;
  topic: string[];
  originalImageUrl: string;
}
interface Library {
  validCount: number;
  invalidCount: number;
  images: LibraryImage[];
  topics: Topic[];
  questions: LibraryQuestion[];
  trash?: TrashedQuestion[];
}

const difficultyOptions: Array<{ value: Difficulty; label: string }> = [
  { value: "simple", label: "简单" }, { value: "medium", label: "中等" },
  { value: "hard", label: "困难" }, { value: "hell", label: "地狱" },
];
const router = useRouter();
const token = ref(sessionStorage.getItem("arkfeets:admin-token") ?? "");
const checkingSession = ref(true);
const password = ref("");
const library = ref<Library>();
const isAuthenticated = computed(() => Boolean(token.value || library.value));
const mode = ref<"images" | "questions" | "trash">("images");
const searchText = ref("");
const activeTopicId = ref("");
const onlyWithoutQuestions = ref(false);
const onlyAvailableInTopic = ref(false);
const toolsExpanded = ref(localStorage.getItem("arkfeets:admin-tools-expanded") === "1");
const sidebarCollapsed = ref(false);
const selectedImageName = ref("");
const expandedImageName = ref("");
const selectedQuestionId = ref("");
const selectedTrashId = ref("");
const isNew = ref(false);
const form = ref<QuestionRecord>(emptyQuestion());
const tagText = ref("");
const metadataForm = ref<ImageMetadata>(emptyMetadata());
const metadataTagRows = ref<MetadataTagRow[]>([]);
const workbench = ref<HTMLElement>();
const adminEditor = ref<HTMLElement>();
const cropper = ref<InstanceType<typeof Cropper>>();
const viewerCanvas = ref<InstanceType<typeof CropImageCanvas>>();
const cropAspect = ref<number | undefined>();
const cropConfirmed = ref(false);
const cropDialogOpen = ref(false);
const cropReady = ref(false);
const cropZoom = ref(1);
const draftCrop = ref<CropRect | null>(null);
const imageViewer = ref<"original" | "crop" | null>(null);
const hoveredImage = ref<LibraryImage>();
const imagePreviewPosition = ref({ x: 0, y: 0 });
const hoveredQuestion = ref<LibraryQuestion>();
const questionPreviewPosition = ref({ x: 0, y: 0 });
const busy = ref(false);
const message = ref("");
const error = ref("");
const transferLabel = ref("");
const transferProgress = ref<number | null>(null);
// 关联原图自定义下拉：名称居左、扩展名靠右置灰，用户只能按名称选择原图。
const imageSelectOpen = ref(false);
const imageSelectQuery = ref("");
const imageSelectRoot = ref<HTMLElement>();
// 标题自动预填值：标题为空或仍等于预填值时，换图后标题跟随新图名；用户手动改过则不覆盖。
const autoFilledTitle = ref("");
let previousBodyOverflow = "";

const selectedImage = computed(() => library.value?.images.find((image) => image.fileName === selectedImageName.value));
const selectedQuestion = computed(() => library.value?.questions.find((question) => question.id === selectedQuestionId.value));
const trashedQuestions = computed(() => library.value?.trash ?? []);
const selectedTrash = computed(() => trashedQuestions.value.find((question) => question.trashId === selectedTrashId.value));
const currentImageUrl = computed(() => {
  if (selectedQuestionId.value || isNew.value) return library.value?.images.find((image) => image.fileName === form.value.originalImage)?.url ?? "";
  return selectedImage.value?.url ?? "";
});
// 题目按原图分组只计算一次，避免搜索和列表渲染中 O(原图数 × 题目数) 的重复过滤。
const questionsByImage = computed(() => {
  const groups = new Map<string, LibraryQuestion[]>();
  for (const question of library.value?.questions ?? []) {
    const name = question.info?.originalImage;
    if (!name) continue;
    const group = groups.get(name) ?? [];
    group.push(question);
    groups.set(name, group);
  }
  return groups;
});
const relatedQuestions = (image: LibraryImage) => questionsByImage.value.get(image.fileName) ?? [];
const defaultTopic = computed(() => library.value?.topics.find((topic) => topic.isDefault));
const activeTopic = computed(() => library.value?.topics.find((topic) => topic.id === activeTopicId.value));
const topicOccupant = (image: LibraryImage) => relatedQuestions(image).find((question) => question.topic.includes(activeTopicId.value));
const normalizedNeedle = computed(() => normalizeSearch(searchText.value));
const filteredImages = computed(() => (library.value?.images ?? []).filter((image) => {
  if (onlyWithoutQuestions.value && image.totalCount > 0) return false;
  if (onlyAvailableInTopic.value && activeTopicId.value && image.topicIds.includes(activeTopicId.value)) return false;
  if (!normalizedNeedle.value) return true;
  const related = relatedQuestions(image);
  return normalizeSearch([
    image.fileName, image.metadata.name, image.metadata.hint, ...image.metadata.answers,
    ...image.metadata.tags.flatMap((tag) => Object.entries(tag).flat()),
    ...related.flatMap((question) => [question.info?.title ?? "", ...(question.info?.answers ?? [])]),
  ].join(" ")).includes(normalizedNeedle.value);
}));
const filteredQuestions = computed(() => (library.value?.questions ?? []).filter((question) => {
  if (activeTopicId.value && !question.topic.includes(activeTopicId.value)) return false;
  if (!normalizedNeedle.value) return true;
  return normalizeSearch([
    question.id, question.info?.title, question.info?.originalImage, question.info?.hint,
    ...(question.info?.answers ?? []), ...(question.info?.tags ?? []),
  ].filter(Boolean).join(" ")).includes(normalizedNeedle.value);
}));
const filteredTrash = computed(() => trashedQuestions.value.filter((question) => {
  if (!normalizedNeedle.value) return true;
  return normalizeSearch([
    question.id, question.info.title, question.info.originalImage, question.info.hint,
    ...question.info.answers, ...question.info.tags,
  ].join(" ")).includes(normalizedNeedle.value);
}));
const imagePreview = computed(() => hoveredImage.value ? {
  image: hoveredImage.value,
  style: floatingPreviewStyle(imagePreviewPosition.value, 280, 220),
} : undefined);
const questionPreview = computed(() => {
  const question = hoveredQuestion.value;
  const crop = question?.info?.question;
  if (!question || !crop || !question.originalImageUrl) return undefined;
  return { crop, imageUrl: question.originalImageUrl, style: questionPreviewStyle(question) };
});
const modeStats = computed(() => mode.value === "images"
  ? { total: library.value?.images.length ?? 0, valid: (library.value?.images ?? []).reduce((sum, image) => sum + image.validCount, 0), invalid: (library.value?.images ?? []).reduce((sum, image) => sum + image.invalidCount, 0) }
  : mode.value === "questions"
    ? { total: library.value?.questions.length ?? 0, valid: library.value?.validCount ?? 0, invalid: library.value?.invalidCount ?? 0 }
    : { total: trashedQuestions.value.length, valid: trashedQuestions.value.length, invalid: 0 });
const topicConflict = computed(() => {
  if (!form.value.originalImage) return "";
  const image = library.value?.images.find((item) => item.fileName === form.value.originalImage);
  if (!image) return "";
  const other = relatedQuestions(image).find((question) => question.id !== selectedQuestionId.value && question.topic.some((id) => form.value.topic.includes(id)));
  const topic = library.value?.topics.find((item) => other?.topic.includes(item.id) && form.value.topic.includes(item.id));
  return other && topic ? `${topic.name}主题中此原图已有题目“${other.info?.title ?? other.id}”` : "";
});
const canSaveQuestion = computed(() => Boolean(form.value.title.trim() && form.value.question && form.value.originalImage && form.value.topic.length && !topicConflict.value));
const canQuickCreate = computed(() => isNew.value && cropConfirmed.value && canSaveQuestion.value
  && !duplicateTitleId.value && form.value.answers.some((answer) => answer.trim())
  && form.value.difficulty.length > 0 && !busy.value);
const imageSelectOptions = computed(() => {
  const needle = normalizeSearch(imageSelectQuery.value);
  return (library.value?.images ?? []).filter((image) => !needle || normalizeSearch(image.fileName).includes(needle));
});
// 与后端 deriveQuestionId 保持一致的标题查重：创建前提示，存在则不允许创建。
const duplicateTitleId = computed(() => {
  if (!isNew.value) return "";
  const title = form.value.title.trim();
  if (!title) return "";
  const id = deriveQuestionId(title);
  const normalizedTitle = normalizeQuestionTitle(title);
  const duplicate = [
    ...(library.value?.questions ?? []).map((question) => ({ id: question.id, title: question.info?.title ?? "" })),
    ...trashedQuestions.value.map((question) => ({ id: question.id, title: question.info.title })),
  ].find((question) => question.id === id || normalizeQuestionTitle(question.title) === normalizedTitle);
  return duplicate?.id ?? "";
});
onMounted(() => {
  window.addEventListener("click", handleGlobalClick);
  window.addEventListener("keydown", handleDialogKeydown);
  void restoreSession();
});
onBeforeUnmount(() => {
  if (cropDialogOpen.value) document.body.style.overflow = previousBodyOverflow;
  window.removeEventListener("click", handleGlobalClick);
  window.removeEventListener("keydown", handleDialogKeydown);
});

function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (cropDialogOpen.value) closeCropDialog();
  else imageViewer.value = null;
}

function handleGlobalClick(event: MouseEvent) {
  if (imageSelectOpen.value && imageSelectRoot.value && !imageSelectRoot.value.contains(event.target as Node)) {
    imageSelectOpen.value = false;
  }
}

async function restoreSession() {
  try {
    await loadLibrary();
  } catch {
    if (token.value) {
      token.value = "";
      sessionStorage.removeItem("arkfeets:admin-token");
      try { await loadLibrary(); } catch { /* The login form remains available. */ }
    }
  } finally { checkingSession.value = false; }
}

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
  if (!library.value.topics.some((topic) => topic.id === activeTopicId.value)) activeTopicId.value = library.value.topics.find((topic) => topic.isDefault)?.id ?? "";
  if (preferredQuestion) {
    const question = library.value.questions.find((item) => item.id === preferredQuestion);
    if (question) { await selectQuestion(question); return; }
  }
  const image = library.value.images.find((item) => item.fileName === preferredImage) ?? library.value.images[0];
  if (image) selectImage(image);
}

function selectMode(nextMode: "images" | "questions" | "trash") {
  mode.value = nextMode;
  message.value = "";
  error.value = "";
  if (nextMode === "trash") selectedTrashId.value = trashedQuestions.value[0]?.trashId ?? "";
  resetEditorScroll();
}

function selectTrash(question: TrashedQuestion) {
  selectedTrashId.value = question.trashId;
  message.value = "";
  error.value = "";
  resetEditorScroll();
}

function selectImage(image: LibraryImage) {
  selectedImageName.value = image.fileName;
  selectedQuestionId.value = "";
  isNew.value = false;
  metadataForm.value = clone(image.metadata);
  metadataTagRows.value = metadataTagsToRows(image.metadata.tags);
  closeCropDialog();
  imageViewer.value = null;
  message.value = "";
  error.value = "";
  resetEditorScroll();
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
  autoFilledTitle.value = "";
  imageSelectOpen.value = false;
  form.value = { ...clone(question.info), topic: [...question.topic] };
  if (!form.value.answers.length) form.value.answers = [""];
  tagText.value = form.value.tags.join("，");
  cropConfirmed.value = Boolean(form.value.question);
  closeCropDialog();
  imageViewer.value = null;
  resetEditorScroll();
}

function beginQuestion(image: LibraryImage) {
  selectImage(image);
  selectedQuestionId.value = "";
  isNew.value = true;
  const topic = activeTopic.value ?? defaultTopic.value;
  form.value = {
    ...emptyQuestion(),
    title: suggestedQuestionTitle(image.fileName, topic),
    answers: image.metadata.answers.length ? [...image.metadata.answers] : [""],
    hint: image.metadata.hint,
    difficulty: [...image.metadata.difficulty],
    tags: metadataTagsToQuestionTags(image.metadata.tags),
    originalImage: image.fileName,
    topic: topic ? [topic.id] : [],
  };
  autoFilledTitle.value = form.value.title;
  imageSelectOpen.value = false;
  tagText.value = form.value.tags.join("，");
  cropConfirmed.value = false;
  closeCropDialog();
  imageViewer.value = null;
  cropAspect.value = undefined;
  message.value = "";
  error.value = "";
  resetEditorScroll();
}

function resetEditorScroll() {
  void nextTick(() => {
    const reset = () => {
      if (workbench.value) workbench.value.scrollTop = 0;
      if (adminEditor.value) adminEditor.value.scrollTop = 0;
    };
    reset();
    requestAnimationFrame(() => requestAnimationFrame(reset));
  });
}

function toggleImageSelect() {
  imageSelectOpen.value = !imageSelectOpen.value;
  if (imageSelectOpen.value) imageSelectQuery.value = "";
}

function chooseQuestionImage(image: LibraryImage) {
  if (form.value.originalImage !== image.fileName) {
    form.value.originalImage = image.fileName;
    // 裁切坐标只对当前原图有效，换图后必须重新框选谜面
    form.value.question = null;
    cropConfirmed.value = false;
    closeCropDialog();
    imageViewer.value = null;
    if (!form.value.title.trim() || form.value.title === autoFilledTitle.value) {
      form.value.title = suggestedQuestionTitle(image.fileName, library.value?.topics.find((topic) => topic.id === form.value.topic[0]));
      autoFilledTitle.value = form.value.title;
    }
    message.value = "已更换关联原图，请重新框选谜面";
    error.value = "";
  }
  imageSelectOpen.value = false;
}

function restoreCrop() {
  const crop = form.value.question;
  if (!crop) return;
  cropper.value?.setCoordinates({ left: crop.x, top: crop.y, width: crop.width, height: crop.height });
}

function handleCropReady() {
  restoreCrop();
  void nextTick(() => { cropReady.value = true; });
}

function zoomCrop(factor: number) {
  if (!cropReady.value) return;
  // Scale the image and stencil together so zooming never changes the selected source pixels.
  cropZoom.value = Math.min(4, Math.max(1, cropZoom.value * factor));
}

function openCropDialog() {
  if (!currentImageUrl.value) return;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  cropReady.value = false;
  cropZoom.value = 1;
  draftCrop.value = form.value.question ? clone(form.value.question) : null;
  cropDialogOpen.value = true;
  message.value = "";
  error.value = "";
}

function closeCropDialog() {
  document.body.style.overflow = previousBodyOverflow;
  cropDialogOpen.value = false;
  cropReady.value = false;
  draftCrop.value = null;
}

function saveCropDialog() {
  if (!cropReady.value) return;
  if (!captureCurrentCrop()) return;
  form.value.question = draftCrop.value;
  cropConfirmed.value = true;
  closeCropDialog();
  message.value = "裁切已保存并锁定，保存题目后生效";
}

function captureCurrentCrop(): boolean {
  const result = cropper.value?.getResult() as { coordinates?: { left: number; top: number; width: number; height: number }; image?: { width: number; height: number } } | undefined;
  if (!result?.coordinates || !result.image) { error.value = "请先在原图上框选谜面"; return false; }
  const { left, top, width, height } = result.coordinates;
  if (![left, top, width, height, result.image.width, result.image.height].every(Number.isFinite)
    || width < 1 || height < 1 || result.image.width < 1 || result.image.height < 1
    || left < 0 || top < 0 || left + width > result.image.width + 1 || top + height > result.image.height + 1) {
    error.value = "裁切坐标无效，请等待图片加载后重新框选";
    return false;
  }
  applyCropResult({ coordinates: result.coordinates, image: result.image });
  return true;
}

function handleCropChange(result: { coordinates?: { left: number; top: number; width: number; height: number }; image?: { width: number; height: number } }) {
  if (!cropReady.value || !result.coordinates || !result.image) return;
  applyCropResult({ coordinates: result.coordinates, image: result.image });
}

function applyCropResult(result: { coordinates: { left: number; top: number; width: number; height: number }; image: { width: number; height: number } }) {
  draftCrop.value = {
    x: Math.round(result.coordinates.left),
    y: Math.round(result.coordinates.top),
    width: Math.round(result.coordinates.width),
    height: Math.round(result.coordinates.height),
    sourceWidth: Math.round(result.image.width),
    sourceHeight: Math.round(result.image.height),
  };
}

async function saveQuestion() {
  if (!canSaveQuestion.value) { error.value = "请先填写标题并确认谜面裁切"; return; }
  if (!cropConfirmed.value) { error.value = "请先保存裁切，再保存题目"; return; }
  if (topicConflict.value) { error.value = topicConflict.value; return; }
  if (isNew.value && duplicateTitleId.value) { error.value = `已存在相同标题的题目（ID：${duplicateTitleId.value}），请修改标题后再创建`; return; }
  await perform(async () => {
    const payload = {
      title: form.value.title.trim(),
      answers: form.value.answers.map((answer) => answer.trim()).filter(Boolean),
      hint: form.value.hint.trim(),
      difficulty: [...form.value.difficulty],
      tags: tagText.value.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean),
      originalImage: form.value.originalImage,
      question: form.value.question,
      enabled: form.value.enabled,
      topic: [...form.value.topic],
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

async function quickCreateQuestion() {
  if (!canQuickCreate.value) return;
  form.value.enabled = true;
  await saveQuestion();
}

async function deleteQuestion() {
  if (isNew.value || !selectedQuestionId.value) return;
  const id = selectedQuestionId.value;
  const title = form.value.title || id;
  if (!window.confirm(`确定将题目“${title}”移入回收站吗？\n可在回收站还原，原图不会被删除。`)) return;
  const originalImage = form.value.originalImage;
  await perform(async () => {
    const result = await api<{ trashId: string }>(`/api/admin/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
    selectedQuestionId.value = "";
    await loadLibrary("", originalImage);
    mode.value = "trash";
    selectedTrashId.value = result.trashId;
    resetEditorScroll();
  }, "题目已移入回收站，可随时还原");
}

async function restoreQuestion() {
  if (!selectedTrash.value) return;
  const question = selectedTrash.value;
  await perform(async () => {
    const result = await api<{ id: string }>(`/api/admin/trash/${encodeURIComponent(question.trashId)}/restore`, { method: "POST" });
    selectedTrashId.value = "";
    mode.value = "questions";
    await loadLibrary(result.id, question.info.originalImage);
  }, "题目已从回收站还原");
}

async function permanentlyDeleteQuestion() {
  if (!selectedTrash.value) return;
  const question = selectedTrash.value;
  if (!window.confirm(`确定彻底删除题目“${question.info.title || question.id}”吗？\n此操作无法还原，但原图仍会保留。`)) return;
  await perform(async () => {
    await api(`/api/admin/trash/${encodeURIComponent(question.trashId)}`, { method: "DELETE" });
    selectedTrashId.value = "";
    await loadLibrary("", question.info.originalImage);
    selectedTrashId.value = trashedQuestions.value[0]?.trashId ?? "";
    resetEditorScroll();
  }, "题目记录已彻底删除，关联原图已保留");
}

async function saveMetadata() {
  if (!selectedImage.value) return;
  await perform(async () => {
    const payload = {
      ...metadataForm.value,
      answers: metadataForm.value.answers.map((answer) => answer.trim()).filter(Boolean),
      tags: metadataTagRows.value
        .map((tag) => ({ key: tag.key.trim(), value: tag.value.trim() }))
        .filter((tag) => tag.key)
        .map((tag) => ({ [tag.key]: tag.value })),
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
function addMetadataTag() { metadataTagRows.value.push({ key: "", value: "" }); }
function removeMetadataTag(index: number) { metadataTagRows.value.splice(index, 1); }

async function uploadImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  transferLabel.value = `正在上传 0 / ${files.length} 张原图`;
  transferProgress.value = 0;
  try {
    await perform(async () => {
      const added: string[] = [];
      const conflicts: string[] = [];
      const batchSize = 100;
      for (let offset = 0; offset < files.length; offset += batchSize) {
        const batch = files.slice(offset, offset + batchSize);
        const data = new FormData();
        data.append("paths", JSON.stringify(batch.map((file) => file.webkitRelativePath || file.name)));
        for (const file of batch) data.append("images", file);
        transferLabel.value = `正在上传 ${offset} / ${files.length} 张原图`;
        const result = await uploadForm<{ added: string[]; conflicts: string[] }>("/api/admin/questions/batch-images", data, (progress) => {
          transferProgress.value = Math.min(100, ((offset + progress * batch.length) / files.length) * 100);
          transferLabel.value = `正在上传 ${Math.min(files.length, Math.round(offset + progress * batch.length))} / ${files.length} 张原图`;
        });
        added.push(...result.added);
        conflicts.push(...result.conflicts);
      }
      transferLabel.value = "正在刷新题库";
      transferProgress.value = null;
      await loadLibrary("", added[0]);
      input.value = "";
      message.value = `新增 ${added.length} 张原图，跳过 ${conflicts.length} 个同名文件`;
    });
  } finally {
    transferLabel.value = "";
    transferProgress.value = null;
  }
}

async function importArchive(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  transferLabel.value = "正在上传题库资源包";
  transferProgress.value = 0;
  try {
    await perform(async () => {
      const data = new FormData();
      data.append("archive", file);
      const result = await uploadForm<{ importedIds: string[]; conflicts: string[] }>("/api/admin/questions/import-zip", data, (progress) => {
        transferProgress.value = progress < 1 ? progress * 100 : null;
        transferLabel.value = progress < 1 ? "正在上传题库资源包" : "正在校验并合并题库";
      });
      transferLabel.value = "正在刷新题库";
      transferProgress.value = null;
      await loadLibrary(result.importedIds[0]);
      input.value = "";
      message.value = `导入 ${result.importedIds.length} 题，保留 ${result.conflicts.length} 个重复 ID`;
    });
  } finally {
    transferLabel.value = "";
    transferProgress.value = null;
  }
}

async function exportArchive() {
  transferLabel.value = "正在生成题库资源包";
  transferProgress.value = null;
  try {
    await perform(async () => {
      const picker = (window as unknown as {
        showSaveFilePicker?: (options: {
          suggestedName: string;
          types: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<{ createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }> }>;
      }).showSaveFilePicker;
      if (!picker) {
        const jobId = crypto.randomUUID().replaceAll("-", "");
        const link = document.createElement("a");
        link.href = `/api/admin/questions/export?jobId=${jobId}`;
        link.download = `arkfeets-questions-${new Date().toISOString().slice(0, 10)}.zip`;
        link.click();
        transferLabel.value = "正在导出题库资源包";
        await watchExportProgress(jobId);
        return;
      }
      const handle = await picker.call(window, {
        suggestedName: `arkfeets-questions-${new Date().toISOString().slice(0, 10)}.zip`,
        types: [{ description: "ZIP 资源包", accept: { "application/zip": [".zip"] } }],
      });
      const destination = await handle.createWritable();
      const response = await fetch("/api/admin/questions/export", { headers: { Authorization: `Bearer ${token.value}` } });
      if (!response.ok) {
        await destination.abort?.();
        throw new Error(await readResponseError(response));
      }
      transferLabel.value = "正在下载题库资源包";
      const total = Number(response.headers.get("X-Archive-Source-Bytes") ?? 0);
      const reader = response.body?.getReader();
      if (!reader) {
        await destination.abort?.();
        throw new Error("浏览器不支持流式下载");
      }
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await destination.write(value);
        loaded += value.byteLength;
        transferProgress.value = total ? Math.min(100, loaded / total * 100) : null;
      }
      await destination.close();
      transferProgress.value = 100;
    }, "整库资源包已导出");
  } finally {
    transferLabel.value = "";
    transferProgress.value = null;
  }
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

function uploadForm<T>(url: string, data: FormData, onProgress: (progress: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    if (token.value) request.setRequestHeader("Authorization", `Bearer ${token.value}`);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener("load", () => {
      const body = JSON.parse(request.responseText || "{}") as T & { message?: string };
      if (request.status >= 200 && request.status < 300) resolve(body);
      else reject(new Error(body.message ?? `请求失败 (${request.status})`));
    });
    request.addEventListener("error", () => reject(new Error("网络连接失败")));
    request.send(data);
  });
}

async function readResponseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { message?: string };
  return body.message ?? `请求失败 (${response.status})`;
}

async function watchExportProgress(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 7_200; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch(`/api/admin/questions/export-progress/${jobId}`, {
      headers: { Authorization: `Bearer ${token.value}` },
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(await readResponseError(response));
    const progress = await response.json() as { written: number; total: number; done: boolean; error?: string };
    transferProgress.value = progress.total ? Math.min(100, progress.written / progress.total * 100) : null;
    if (progress.error) throw new Error(progress.error);
    if (progress.done) {
      transferProgress.value = 100;
      return;
    }
  }
  throw new Error("导出任务等待超时");
}

function emptyMetadata(): ImageMetadata {
  return { name: "", answers: [""], hint: "", difficulty: ["simple", "medium", "hard", "hell"], tags: [] };
}
function emptyQuestion(): QuestionRecord {
  return { id: "", title: "", answers: [""], hint: "", difficulty: ["simple", "medium", "hard", "hell"], tags: [], originalImage: "", question: null, enabled: false, topic: [] };
}
function metadataTagsToRows(tags: Array<Record<string, string>>): MetadataTagRow[] {
  return tags.flatMap((tag) => Object.entries(tag).map(([key, value]) => ({ key, value })));
}
function metadataTagsToQuestionTags(tags: Array<Record<string, string>>): string[] {
  return metadataTagsToRows(tags).map((tag) => tag.value ? `${tag.key}:${tag.value}` : tag.key);
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function normalizeSearch(value: string) { return value.replace(/\s/gu, "").toLocaleLowerCase(); }
function imageLabel(fileName: string) { return fileName.replace(/\.(png|jpe?g|webp|gif)$/iu, ""); }
function suggestedQuestionTitle(fileName: string, topic?: Topic) { return `${imageLabel(fileName)}${topic ? `-${topic.name}` : ""}`; }
function syncAutoTitleToTopic() {
  if (!isNew.value || !form.value.originalImage) return;
  if (!form.value.title.trim() || form.value.title === autoFilledTitle.value) {
    form.value.title = suggestedQuestionTitle(form.value.originalImage, library.value?.topics.find((topic) => topic.id === form.value.topic[0]));
    autoFilledTitle.value = form.value.title;
  }
}
function toggleTools() {
  toolsExpanded.value = !toolsExpanded.value;
  localStorage.setItem("arkfeets:admin-tools-expanded", toolsExpanded.value ? "1" : "0");
}
function imageExt(fileName: string) { return (/\.(png|jpe?g|webp|gif)$/iu.exec(fileName)?.[0] ?? "").toLowerCase(); }
// 与后端 QuestionAdminService.deriveQuestionId 的归一化规则保持一致
function deriveQuestionId(title: string) {
  return title.normalize("NFKC").trim().replace(/\+/g, " plus ").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "question";
}
function normalizeQuestionTitle(title: string) { return title.normalize("NFKC").trim().toLocaleLowerCase(); }

function showImagePreview(image: LibraryImage, event: MouseEvent) {
  hoveredImage.value = image;
  moveImagePreview(event);
}

function moveImagePreview(event: MouseEvent) {
  imagePreviewPosition.value = { x: event.clientX, y: event.clientY };
}

function showQuestionPreview(question: LibraryQuestion, event: MouseEvent) {
  hoveredQuestion.value = question;
  moveQuestionPreview(event);
}

function moveQuestionPreview(event: MouseEvent) {
  questionPreviewPosition.value = { x: event.clientX, y: event.clientY };
}

function floatingPreviewStyle(position: { x: number; y: number }, width: number, height: number) {
  const gutter = 12;
  const offset = 18;
  const right = position.x + offset;
  const left = right + width <= window.innerWidth - gutter ? right : position.x - width - offset;
  return {
    width: `${width}px`,
    height: `${height}px`,
    left: `${Math.max(gutter, Math.min(left, window.innerWidth - width - gutter))}px`,
    top: `${Math.max(gutter, Math.min(position.y - height / 2, window.innerHeight - height - gutter))}px`,
  };
}

function questionPreviewStyle(question: LibraryQuestion) {
  const crop = question.info?.question;
  if (!crop) return {};
  const aspect = crop.width / crop.height;
  const width = aspect >= 280 / 220 ? 280 : 220 * aspect;
  const height = width / aspect;
  return floatingPreviewStyle(questionPreviewPosition.value, width, height);
}
</script>

<template>
  <main class="page-shell admin-page">
    <header class="topbar">
      <button class="icon-button" title="返回后台管理" @click="router.push('/admin')"><ArrowLeft :size="18" /></button>
      <div class="brand-mark">题库管理 <small>ARCHIVE CONTROL</small></div>
      <button v-if="isAuthenticated" class="icon-button admin-sidebar-toggle" :title="sidebarCollapsed ? '展开左侧目录' : '隐藏左侧目录'" @click="sidebarCollapsed = !sidebarCollapsed">
        <PanelLeftOpen v-if="sidebarCollapsed" :size="18" /><PanelLeftClose v-else :size="18" />
      </button>
      <button v-if="isAuthenticated" class="icon-button admin-logout" title="退出后台" @click="logout"><LogOut :size="18" /></button>
    </header>

    <section v-if="checkingSession && !isAuthenticated" class="center-state">正在验证管理会话...</section>
    <section v-else-if="!isAuthenticated" class="admin-login">
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

    <section v-else-if="library" ref="workbench" class="admin-workbench" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <aside class="admin-sidebar">
        <div class="admin-view-tabs">
          <button :class="{ active: mode === 'images' }" @click="selectMode('images')"><Images :size="16" />原图</button>
          <button :class="{ active: mode === 'questions' }" @click="selectMode('questions')"><ListTree :size="16" />题目</button>
          <button :class="{ active: mode === 'trash' }" @click="selectMode('trash')"><Trash2 :size="16" />回收站</button>
        </div>
        <div class="admin-summary admin-summary--three">
          <span><FolderOpen :size="15" />总数 <b>{{ modeStats.total }}</b></span>
          <span><CheckCircle2 :size="15" />{{ mode === 'trash' ? '可还原' : '有效' }} <b>{{ modeStats.valid }}</b></span>
          <span><AlertTriangle :size="15" />{{ mode === 'trash' ? '损坏' : '异常' }} <b>{{ modeStats.invalid }}</b></span>
        </div>
        <div v-if="transferLabel" class="admin-transfer-progress" role="status" aria-live="polite">
          <div><LoaderCircle :size="14" class="is-spinning" /><span>{{ transferLabel }}</span><b v-if="transferProgress !== null">{{ Math.round(transferProgress) }}%</b></div>
          <progress v-if="transferProgress !== null" :value="transferProgress" max="100" />
          <span v-else class="admin-transfer-progress__indeterminate"><i /></span>
        </div>
        <div class="admin-search"><Search :size="16" /><input v-model="searchText" :placeholder="mode === 'images' ? '搜索文件、默认信息或关联题目' : mode === 'trash' ? '搜索回收站题目、答案或原图' : '搜索标题、答案、标签或原图'" /></div>
        <div class="admin-tools">
          <button type="button" class="admin-tools__toggle" :aria-expanded="toolsExpanded" aria-controls="admin-tools-body" @click="toggleTools">
            <ChevronDown :size="15" :class="{ open: toolsExpanded }" /><span>{{ toolsExpanded ? '收起' : '更多' }}</span><small>{{ activeTopic?.name ?? '全部主题' }}</small>
          </button>
          <div v-show="toolsExpanded" id="admin-tools-body" class="admin-tools__body">
            <div v-if="mode !== 'trash'" class="admin-topic-filter">
              <label for="admin-topic-select">主题</label>
              <select id="admin-topic-select" v-model="activeTopicId">
                <option v-if="mode === 'questions'" value="">全部主题</option>
                <option v-for="topic in library.topics" :key="topic.id" :value="topic.id">{{ topic.name }}{{ topic.isDefault ? ' · 默认' : '' }}</option>
              </select>
            </div>
            <div class="admin-toolbar">
              <label class="icon-button" title="上传原图或文件夹" aria-label="上传原图或文件夹"><FolderUp :size="18" /><input v-bind="{ webkitdirectory: '' }" type="file" accept="image/*" multiple :disabled="busy" @change="uploadImages" /></label>
              <label class="icon-button" title="导入题库" aria-label="导入题库"><Upload :size="18" /><input type="file" accept=".zip,application/zip" :disabled="busy" @change="importArchive" /></label>
              <button class="icon-button" title="导出题库" aria-label="导出题库" :disabled="busy" @click="exportArchive"><Download :size="18" /></button>
            </div>
            <div class="admin-filter-actions" :class="{ 'admin-filter-actions--compact': mode !== 'images' }">
              <label v-if="mode === 'images'" class="topic-switch" title="仅看全局无题目"><input v-model="onlyWithoutQuestions" type="checkbox" aria-label="仅看全局无题目" /><span />全局无题</label>
              <label v-if="mode === 'images'" class="topic-switch" title="仅看本主题未占用"><input v-model="onlyAvailableInTopic" type="checkbox" aria-label="仅看本主题未占用" :disabled="!activeTopicId" /><span />本主题空位</label>
              <button class="icon-button" title="管理主题" aria-label="管理主题" @click="router.push('/admin/topics')"><Layers3 :size="17" /></button>
            </div>
          </div>
        </div>

        <nav v-if="mode === 'images'" class="asset-list" aria-label="原图列表">
          <div v-for="image in filteredImages" :key="image.fileName" class="asset-group" :class="{ active: selectedImageName === image.fileName }">
            <div class="asset-row">
              <button class="asset-row__main" @click="toggleImage(image)" @mouseenter="showImagePreview(image, $event)" @mousemove="moveImagePreview" @mouseleave="hoveredImage = undefined">
                <ImageIcon :size="16" />
                <span>{{ imageLabel(image.fileName) }}</span>
              </button>
              <span class="asset-topic-status" :class="{ occupied: topicOccupant(image) }" :title="topicOccupant(image) ? `本主题已有：${topicOccupant(image)?.info?.title ?? topicOccupant(image)?.id}` : '本主题尚无题目'">{{ topicOccupant(image) ? '已占用' : '可新建' }}</span>
              <button class="asset-row__add" title="基于此原图新增题目" @click="beginQuestion(image)"><Plus :size="14" /></button>
              <small>{{ image.validCount }}/{{ image.totalCount }}</small>
              <button class="asset-row__expand" :title="expandedImageName === image.fileName ? '收起题目' : '展开题目'" @click="toggleImage(image)"><ChevronDown :size="15" :class="{ open: expandedImageName === image.fileName }" /></button>
            </div>
            <div v-if="expandedImageName === image.fileName" class="asset-questions">
              <button class="asset-add-question" title="基于此原图新增题目" @click="beginQuestion(image)"><Plus :size="15" />新增题目</button>
              <button v-for="question in relatedQuestions(image)" :key="question.id" @click="selectQuestion(question)" @mouseenter="showQuestionPreview(question, $event)" @mousemove="moveQuestionPreview" @mouseleave="hoveredQuestion = undefined">
                <component :is="question.validation.valid ? CheckCircle2 : AlertTriangle" :size="13" />
                <span>{{ question.info?.title || question.id }}</span>
              </button>
              <p v-if="!relatedQuestions(image).length">尚无关联题目</p>
            </div>
          </div>
          <p v-if="!filteredImages.length" class="question-list__empty">没有匹配的原图</p>
        </nav>

        <nav v-else-if="mode === 'questions'" class="question-list" aria-label="题目列表">
          <button v-for="question in filteredQuestions" :key="question.id" :class="{ active: selectedQuestionId === question.id }" @click="selectQuestion(question)" @mouseenter="showQuestionPreview(question, $event)" @mousemove="moveQuestionPreview" @mouseleave="hoveredQuestion = undefined">
            <component :is="question.validation.valid ? CheckCircle2 : AlertTriangle" :size="15" />
            <span>{{ question.info?.title || question.id }}</span>
            <small>{{ question.info?.originalImage ? imageLabel(question.info.originalImage) : '未关联原图' }}</small>
          </button>
          <p v-if="!filteredQuestions.length" class="question-list__empty">没有匹配的题目</p>
        </nav>

        <nav v-else class="question-list trash-list" aria-label="回收站题目列表">
          <button v-for="question in filteredTrash" :key="question.trashId" :class="{ active: selectedTrashId === question.trashId }" @click="selectTrash(question)">
            <Trash2 :size="15" />
            <span>{{ question.info.title || question.id }}</span>
            <small>{{ imageLabel(question.info.originalImage) }}</small>
          </button>
          <p v-if="!filteredTrash.length" class="question-list__empty">回收站为空</p>
        </nav>
      </aside>

      <article v-if="mode === 'trash' && selectedTrash" ref="adminEditor" class="admin-editor trash-editor">
        <header>
          <div><p class="eyebrow">RECYCLE BIN / {{ selectedTrash.id }}</p><h2>{{ selectedTrash.info.title || selectedTrash.id }}</h2></div>
          <span class="invalid">回收站</span>
        </header>
        <div class="trash-question-preview">
          <img :src="selectedTrash.originalImageUrl" :alt="selectedTrash.info.originalImage" />
          <dl>
            <div><dt>原图</dt><dd>{{ imageLabel(selectedTrash.info.originalImage) }}</dd></div>
            <div><dt>答案</dt><dd>{{ selectedTrash.info.answers.join(' / ') || '未填写' }}</dd></div>
            <div><dt>状态</dt><dd>{{ selectedTrash.info.enabled ? '删除前已启用' : '删除前未启用' }}</dd></div>
          </dl>
        </div>
        <section class="trash-actions">
          <div><strong>选择处理方式</strong><small>还原后重新进入题库；彻底删除后无法恢复，原图仍会保留。</small></div>
          <button class="button button--quiet" :disabled="busy" @click="restoreQuestion"><RotateCcw :size="17" />还原题目</button>
          <button class="button button--danger" :disabled="busy" @click="permanentlyDeleteQuestion"><Trash2 :size="17" />彻底删除</button>
        </section>
        <p v-if="message" class="admin-message">{{ message }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>

      <article v-else-if="mode !== 'trash' && (selectedQuestionId || isNew)" ref="adminEditor" class="admin-editor">
        <header>
          <div><p class="eyebrow">QUESTION RECORD / {{ isNew ? 'NEW' : selectedQuestionId }}</p><h2>{{ form.title || '未命名题目' }}</h2></div>
          <span :class="selectedQuestion?.validation.valid ? 'valid' : 'invalid'">{{ isNew ? '未提交' : selectedQuestion?.validation.valid ? '校验通过' : '待修正' }}</span>
        </header>
        <div v-if="selectedQuestion?.validation.errors.length" class="validation-errors"><AlertTriangle :size="17" /><p>{{ selectedQuestion.validation.errors.join('；') }}</p></div>

        <section class="admin-form-section">
          <div class="admin-section-title"><span>01</span><div><strong>谜底与谜面</strong><small>ORIGINAL / CROP</small></div></div>
          <div class="image-dual-preview">
            <figure>
              <figcaption>谜底 · 完整原图</figcaption>
              <button type="button" class="image-preview-button" title="查看完整原图" :disabled="!currentImageUrl" @click="imageViewer = 'original'">
                <img :src="currentImageUrl" alt="完整原图" />
                <Maximize2 :size="17" class="image-preview-button__icon" />
              </button>
            </figure>
            <figure>
              <figcaption>谜面 · 实时裁切</figcaption>
              <button type="button" class="image-preview-button" title="查看谜面裁切" :disabled="!currentImageUrl || !form.question" @click="imageViewer = 'crop'">
                <CropImageCanvas v-if="form.question && currentImageUrl" :image-url="currentImageUrl" :crop="form.question" />
                <span v-else class="crop-preview--empty">尚未确认裁切</span>
                <Maximize2 v-if="form.question" :size="17" class="image-preview-button__icon" />
              </button>
            </figure>
          </div>
          <div class="image-action-group" role="group" aria-label="图片操作">
            <button type="button" :disabled="!currentImageUrl" @click="imageViewer = 'original'"><Eye :size="16" />查看原图</button>
            <button type="button" :disabled="!currentImageUrl || !form.question" @click="imageViewer = 'crop'"><ZoomIn :size="16" />查看谜面</button>
            <button type="button" :disabled="busy || !currentImageUrl" @click="openCropDialog"><Scissors :size="16" />裁剪谜面</button>
            <button v-if="isNew" type="button" class="image-action-group__quick" :disabled="!canQuickCreate" title="保存并启用题目" @click="quickCreateQuestion"><Plus :size="16" />快速创建</button>
          </div>
        </section>

        <section class="admin-form-section">
          <div class="admin-section-title"><span>02</span><div><strong>题目信息</strong><small>QUESTION DATA</small></div></div>
          <div class="admin-form-grid">
            <label class="wide">标题<input v-model="form.title" maxlength="100" placeholder="必填，输入题目标题" /></label>
            <p v-if="duplicateTitleId" class="field-error wide">已存在相同标题的题目（ID：{{ duplicateTitleId }}），请修改标题后再创建</p>
            <div class="wide image-select-field">
              <span>关联原图</span>
              <div ref="imageSelectRoot" class="image-select">
                <button type="button" class="image-select__current" :disabled="busy" @click.stop="toggleImageSelect">
                  <ImageIcon :size="15" />
                  <span class="image-select__name">{{ form.originalImage ? imageLabel(form.originalImage) : '请选择原图' }}</span>
                  <span class="image-select__ext">{{ imageExt(form.originalImage) }}</span>
                  <ChevronDown :size="15" :class="{ open: imageSelectOpen }" />
                </button>
                <div v-if="imageSelectOpen" class="image-select__panel" @click.stop>
                  <div class="image-select__search"><Search :size="14" /><input v-model="imageSelectQuery" placeholder="搜索原图名称" /></div>
                  <div class="image-select__options">
                    <button v-for="image in imageSelectOptions" :key="image.fileName" type="button" :class="{ active: form.originalImage === image.fileName }" @click="chooseQuestionImage(image)">
                      <span class="image-select__name">{{ imageLabel(image.fileName) }}</span>
                      <span class="image-select__ext">{{ imageExt(image.fileName) }}</span>
                    </button>
                    <p v-if="!imageSelectOptions.length">没有匹配的原图</p>
                  </div>
                </div>
              </div>
            </div>
            <label class="wide">提示<textarea v-model="form.hint" maxlength="300" rows="2" placeholder="可选提示" /></label>
            <div class="wide answer-fields">
              <div class="field-heading"><span>正确答案与别名</span><button class="icon-button" title="增加别名" @click="addAnswer(form)"><Plus :size="15" /></button></div>
              <div v-for="index in form.answers.length" :key="index" class="answer-row">
                <input v-model="form.answers[index - 1]" maxlength="100" :placeholder="index > 1 ? `别名 ${index - 1}` : '主要答案'" />
                <button class="icon-button" title="删除答案" @click="removeAnswer(form, index - 1)"><Trash2 :size="15" /></button>
              </div>
            </div>
            <label class="wide">标签<input v-model="tagText" placeholder="使用逗号分隔" /></label>
            <fieldset class="wide topic-checks"><legend>所属主题</legend><label v-for="topic in library.topics" :key="topic.id"><input v-model="form.topic" type="checkbox" :value="topic.id" @change="syncAutoTitleToTopic" />{{ topic.name }}<small v-if="topic.isDefault">默认</small></label></fieldset>
            <p v-if="topicConflict" class="field-error wide">{{ topicConflict }}</p>
            <fieldset class="wide difficulty-checks"><legend>适用难度</legend><label v-for="item in difficultyOptions" :key="item.value"><input v-model="form.difficulty" type="checkbox" :value="item.value" />{{ item.label }}</label></fieldset>
          </div>
        </section>

        <section class="admin-publish">
          <label class="publish-toggle"><input v-model="form.enabled" type="checkbox" /><span class="publish-switch" /><span class="publish-copy"><strong>允许进入游戏题库</strong><small>启用时答案和裁切必须完整</small></span></label>
          <div class="admin-publish-actions">
            <button v-if="!isNew" class="button button--danger" :disabled="busy" @click="deleteQuestion"><Trash2 :size="17" />移入回收站</button>
            <button class="button button--primary" :disabled="busy || !canSaveQuestion || !cropConfirmed || !!duplicateTitleId" @click="saveQuestion"><Save :size="17" />{{ isNew ? '创建题目' : '保存题目' }}</button>
          </div>
        </section>
        <p v-if="message" class="admin-message">{{ message }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>

      <article v-else-if="mode === 'images' && selectedImage" ref="adminEditor" class="admin-editor asset-editor">
        <header><div><p class="eyebrow">SOURCE IMAGE / FULL DATA</p><h2>{{ selectedImage.fileName }}</h2></div><button class="button button--primary" @click="beginQuestion(selectedImage)"><FilePlus2 :size="17" />新增题目</button></header>
        <div class="asset-overview">
          <button type="button" class="asset-overview__image" title="查看完整原图" @click="imageViewer = 'original'"><img :src="selectedImage.url" :alt="selectedImage.fileName" /><Maximize2 :size="18" /></button>
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
            <div class="wide answer-fields metadata-tag-fields">
              <div class="field-heading"><span>原图属性标签</span><button class="icon-button" title="增加属性" @click="addMetadataTag"><Plus :size="15" /></button></div>
              <div v-for="(tag, index) in metadataTagRows" :key="index" class="metadata-tag-row">
                <input v-model="tag.key" maxlength="50" placeholder="属性名，例如职业" />
                <input v-model="tag.value" maxlength="200" placeholder="属性值，例如狙击" />
                <button class="icon-button" title="删除属性" @click="removeMetadataTag(index)"><Trash2 :size="15" /></button>
              </div>
              <p v-if="!metadataTagRows.length" class="metadata-tag-empty">暂无属性标签</p>
            </div>
            <fieldset class="wide difficulty-checks"><legend>默认难度</legend><label v-for="item in difficultyOptions" :key="item.value"><input v-model="metadataForm.difficulty" type="checkbox" :value="item.value" />{{ item.label }}</label></fieldset>
          </div>
          <button class="button button--primary metadata-save" :disabled="busy" @click="saveMetadata"><Save :size="17" />保存默认信息</button>
        </section>
        <p v-if="message" class="admin-message">{{ message }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>
      </article>

      <article v-else-if="mode === 'trash'" class="admin-empty" ref="adminEditor">
        <Trash2 :size="42" />
        <h2>回收站为空</h2>
        <p>移入回收站的题目会显示在这里，可随时还原或彻底删除。</p>
      </article>

      <article v-else class="admin-empty"><Database :size="42" /><h2>{{ mode === 'questions' ? '尚未选择题目' : '题库为空' }}</h2></article>
    </section>
    <section v-else class="center-state">正在读取题库...</section>
    <Teleport to="body">
      <span v-if="imagePreview" class="asset-hover-preview" :style="imagePreview.style">
        <img :src="imagePreview.image.url" :alt="imagePreview.image.fileName" />
      </span>
      <span v-if="questionPreview" class="question-hover-preview" :style="questionPreview.style">
        <img :src="questionPreview.imageUrl" :style="{ width: `${questionPreview.crop.sourceWidth / questionPreview.crop.width * 100}%`, height: `${questionPreview.crop.sourceHeight / questionPreview.crop.height * 100}%`, left: `${-questionPreview.crop.x / questionPreview.crop.width * 100}%`, top: `${-questionPreview.crop.y / questionPreview.crop.height * 100}%` }" alt="" />
      </span>
      <div v-if="imageViewer && currentImageUrl" class="admin-modal-backdrop" @click.self="imageViewer = null">
        <section class="admin-image-viewer" role="dialog" aria-modal="true" :aria-label="imageViewer === 'original' ? '完整原图查看器' : '谜面裁切查看器'">
          <header class="admin-modal-header">
            <div><small>{{ imageViewer === 'original' ? 'ORIGINAL IMAGE' : 'QUESTION CROP' }}</small><strong>{{ imageViewer === 'original' ? '完整原图' : '谜面裁切' }}</strong></div>
            <div class="admin-viewer-controls">
              <button class="icon-button" title="缩小" aria-label="缩小" @click="viewerCanvas?.zoomBy(1 / 1.25)"><ZoomOut :size="18" /></button>
              <button class="icon-button" title="适应画面" aria-label="适应画面" @click="viewerCanvas?.resetView()"><Maximize2 :size="18" /></button>
              <button class="icon-button" title="放大" aria-label="放大" @click="viewerCanvas?.zoomBy(1.25)"><ZoomIn :size="18" /></button>
              <button class="icon-button" title="关闭查看器" aria-label="关闭查看器" @click="imageViewer = null"><X :size="20" /></button>
            </div>
          </header>
          <CropImageCanvas ref="viewerCanvas" class="admin-image-viewer__canvas" :image-url="currentImageUrl"
            :crop="imageViewer === 'crop' ? form.question : null" interactive :animate="imageViewer === 'crop'" />
        </section>
      </div>
      <div v-if="cropDialogOpen && currentImageUrl" class="admin-modal-backdrop admin-modal-backdrop--crop">
        <section class="admin-crop-dialog" role="dialog" aria-modal="true" aria-label="裁剪谜面">
          <header class="admin-modal-header">
            <div><small>QUESTION CROP</small><strong>裁剪谜面</strong></div>
            <div class="admin-viewer-controls">
              <button class="icon-button" title="缩小原图" aria-label="缩小原图" :disabled="!cropReady" @click="zoomCrop(1 / 1.25)"><ZoomOut :size="18" /></button>
              <button class="icon-button" title="放大原图" aria-label="放大原图" :disabled="!cropReady" @click="zoomCrop(1.25)"><ZoomIn :size="18" /></button>
              <button class="icon-button" title="取消裁剪" aria-label="取消裁剪" @click="closeCropDialog"><X :size="20" /></button>
            </div>
          </header>
          <div class="question-cropper-viewport" @wheel.capture.prevent.stop="zoomCrop($event.deltaY < 0 ? 1.1 : 1 / 1.1)">
            <Cropper ref="cropper" class="question-cropper" :style="{ transform: `scale(${cropZoom})` }"
              :src="currentImageUrl" :stencil-props="{ aspectRatio: cropAspect }"
              image-restriction="stencil" :move-image="false" :resize-image="{ wheel: false, touch: false }"
              @ready="handleCropReady" @change="handleCropChange" />
          </div>
          <p v-if="error" class="admin-crop-dialog__error" role="alert">{{ error }}</p>
          <footer class="admin-crop-dialog__footer">
            <div class="crop-ratios" role="group" aria-label="裁切比例">
              <button :class="{ active: cropAspect === 16 / 9 }" @click="cropAspect = 16 / 9">16:9</button>
              <button :class="{ active: cropAspect === 1 }" @click="cropAspect = 1">1:1</button>
              <button :class="{ active: !cropAspect }" @click="cropAspect = undefined">自由</button>
            </div>
            <div class="admin-crop-dialog__actions">
              <button class="button button--quiet" @click="closeCropDialog">取消</button>
              <button class="button button--primary" :disabled="!cropReady" @click="saveCropDialog"><Save :size="16" />保存裁切</button>
            </div>
          </footer>
        </section>
      </div>
    </Teleport>
  </main>
</template>
