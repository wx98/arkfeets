import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { Worker as NodeWorker } from "node:worker_threads";
import { basename, extname, join, posix, resolve, sep } from "node:path";
import type { Writable } from "node:stream";
import AdmZip from "adm-zip";
import { z } from "zod";
import {
  catalogueSchema,
  imageUrl,
  questionRecordSchema,
  validateCompleteRecord,
  type CatalogueEntry,
  type QuestionRecord,
  type QuestionRepository,
} from "../question/questionRepository.js";
import { difficulties } from "../question/types.js";
import { initialTopics, topicIdSchema, topicSchema, topicsSchema, type Topic } from "../question/topics.js";
import { StreamingZipReader } from "./streamingZipReader.js";
import { storedZipSourceSize, writeStoredZip, type StoredZipEntry } from "./streamingZipWriter.js";
import { renderQuestionThumbnail } from "./thumbnailRenderer.js";

type UploadedImage = { buffer: Buffer; mimetype: string; originalname: string };
type ImportZipEntry = { read: () => Promise<Buffer>; writeTo: (targetPath: string) => Promise<void> };
export type ThumbnailRefreshStatus = { state: "idle" | "running" | "completed" | "failed"; total: number; processed: number; failed: number; revision: number; error?: string };
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const imageMimeExtensions = new Map([
  ["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"], ["image/gif", ".gif"],
]);

export const imageMetadataSchema = z.object({
  name: z.string().trim().max(100).default(""),
  answers: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  hint: z.string().trim().max(300).default(""),
  difficulty: z.array(z.enum(difficulties)).default([...difficulties]),
  tags: z.array(
    z.record(z.string().trim().min(1).max(50), z.string().trim().max(200))
      .refine((tag) => Object.keys(tag).length === 1, "每个原图标签必须且只能包含一个键值"),
  ).max(50).default([]),
}).strict();

const questionInputSchema = questionRecordSchema.omit({ id: true }).extend({ topic: z.array(topicIdSchema).default([]) });
export type AdminQuestionRecord = QuestionRecord;

export class QuestionAdminService {
  private readonly fullDataDirectory: string;
  private readonly questionDataDirectory: string;
  private readonly questionTrashDirectory: string;
  private readonly thumbnailDirectory: string;
  private readonly thumbnailJobs = new Map<string, Promise<Buffer>>();
  private readonly topicThumbnailProgress = new Map<string, { keys: Set<string>; ready: Set<string>; failed: Set<string> }>();
  private readonly thumbnailFailures = new Set<string>();
  private readonly refreshListeners = new Set<(status: ThumbnailRefreshStatus) => void>();
  private refreshStatus: ThumbnailRefreshStatus = { state: "idle", total: 0, processed: 0, failed: 0, revision: 0 };
  private refreshWorker: NodeWorker | Worker | undefined;
  private thumbnailWorkers = 0;
  private readonly thumbnailWaiters: Array<() => void> = [];
  private warmupQueue: Array<{ id: string; key: string }> = [];
  private warmupTimer: NodeJS.Timeout | undefined;
  private warmupRunning = false;
  // 题库文件解析结果缓存：key 为文件绝对路径，mtime/size 变化时才重新读盘。
  // 题库规模达到千级后，每次请求全量同步读盘 + zod 解析是读取变慢的根因。
  private readonly parsedFileCache = new Map<string, { mtimeMs: number; size: number; value: unknown }>();
  private listCache: { generation: string; value: ReturnType<QuestionAdminService["buildLibrary"]> } | null = null;

  constructor(
    private readonly resourceDirectory: string,
    private readonly repository: QuestionRepository,
    thumbnailDirectory = resolve(resourceDirectory, "../..", "tmp", "topic-thumbnails"),
  ) {
    this.fullDataDirectory = join(resourceDirectory, "full_data");
    this.questionDataDirectory = join(resourceDirectory, "question_data");
    this.questionTrashDirectory = join(resourceDirectory, "question_trash");
    this.thumbnailDirectory = thumbnailDirectory;
    mkdirSync(this.fullDataDirectory, { recursive: true });
    mkdirSync(this.questionDataDirectory, { recursive: true });
    mkdirSync(this.questionTrashDirectory, { recursive: true });
    mkdirSync(this.thumbnailDirectory, { recursive: true });
    const revisionPath = join(this.thumbnailDirectory, "revision");
    if (existsSync(revisionPath)) this.refreshStatus.revision = Number(readFileSync(revisionPath, "utf8")) || 0;
  }

  list() {
    // 读取结果整体缓存：资源代际（目录与 catalogue 的时间戳）未变化且无本服务写入时直接复用，
    // 千级原图题库下避免每次请求都全量 stat + 读盘 + 解析。
    // 代际校验可捕捉手工增删文件；外部直接改写已有 JSON 内容需重启服务或经过任意后台写操作后生效。
    const generation = this.resourceGeneration();
    if (this.listCache?.generation === generation) return this.listCache.value;
    const value = this.buildLibrary();
    this.listCache = { generation, value };
    return value;
  }

  listTopics() {
    const counts = new Map(this.readTopics().map((topic) => [topic.id, 0]));
    for (const entry of this.readCatalogue()) {
      for (const id of entry.topic) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return this.readTopics().map((topic) => ({ ...topic, questionCount: counts.get(topic.id) ?? 0 }));
  }

  listTopicQuestions(id: string) {
    const topicId = topicIdSchema.parse(id);
    if (!this.readTopics().some((topic) => topic.id === topicId)) throw new Error("主题不存在");
    const previews = this.readCatalogue().filter((entry) => entry.topic.includes(topicId)).map((entry) => {
      let info: QuestionRecord | null = null;
      try {
        info = this.readJsonCached(this.questionPath(entry.id), (raw) => questionRecordSchema.parse(raw));
      } catch {
        // Keep broken records visible so an administrator can open and repair them.
      }
      return {
        id: entry.id,
        title: info?.title ?? entry.id,
        tags: info?.tags ?? [],
        hint: info?.hint ?? "",
        originalImage: info?.originalImage ?? "",
        question: info?.question ?? null,
        thumbnailUrl: info ? this.topicThumbnailUrl(entry.id, info) : null,
        enabled: info?.enabled ?? false,
      };
    });
    this.scheduleThumbnailWarmup(topicId, previews);
    return previews;
  }

  getTopicThumbnailProgress(id: string): { total: number; ready: number; failed: number } {
    const topicId = topicIdSchema.parse(id);
    if (!this.readTopics().some((topic) => topic.id === topicId)) throw new Error("主题不存在");
    if (!this.topicThumbnailProgress.has(topicId)) this.listTopicQuestions(topicId);
    const progress = this.topicThumbnailProgress.get(topicId);
    return { total: progress?.keys.size ?? 0, ready: progress?.ready.size ?? 0, failed: progress?.failed.size ?? 0 };
  }

  getThumbnailRefreshStatus(): ThumbnailRefreshStatus { return { ...this.refreshStatus }; }

  subscribeThumbnailRefresh(listener: (status: ThumbnailRefreshStatus) => void): () => void {
    this.refreshListeners.add(listener);
    listener(this.getThumbnailRefreshStatus());
    return () => this.refreshListeners.delete(listener);
  }

  startThumbnailRefresh(): ThumbnailRefreshStatus {
    if (this.refreshStatus.state === "running") throw new Error("缩略图刷新正在进行中");
    const items = this.readCatalogue().flatMap(({ id }) => {
      try {
        const info = this.readJsonCached(this.questionPath(id), (raw) => questionRecordSchema.parse(raw));
        const key = this.thumbnailKey(id, info);
        return key && info.question ? [{ id, key, info }] : [];
      } catch { return []; }
    });
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.warmupTimer = undefined;
    this.warmupQueue = [];
    this.refreshStatus = { ...this.refreshStatus, state: "running", total: items.length, processed: 0, failed: 0, error: undefined };
    this.emitThumbnailRefresh();
    // Detached from the HTTP response: one worker thread remains active when the page closes.
    this.refreshThumbnails(items);
    return this.getThumbnailRefreshStatus();
  }

  private refreshThumbnails(items: Array<{ id: string; key: string; info: QuestionRecord }>): void {
    const workerItems = items.map(({ key, info }) => ({
      key, source: this.imagePath(info.originalImage), target: join(this.thumbnailDirectory, `${key}.webp`), crop: info.question!,
    }));
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.refreshWorker = undefined;
      this.refreshStatus.failed += items.length - this.refreshStatus.processed;
      this.refreshStatus.processed = items.length;
      try {
        const revision = Date.now();
        writeFileSync(join(this.thumbnailDirectory, "revision"), String(revision));
        this.refreshStatus = { ...this.refreshStatus, state: this.refreshStatus.error ? "failed" : "completed", revision };
      } catch {
        this.refreshStatus = { ...this.refreshStatus, state: "failed", error: "刷新结果未能保存", failed: this.refreshStatus.failed + 1 };
      }
      this.emitThumbnailRefresh();
    };
    try {
      const onMessage = (message: { key: string; ok: boolean } | { done: true }) => {
        if (finished) return;
        if ("done" in message) { finish(); return; }
        if (message.ok) this.markThumbnailReady(message.key);
        else {
          this.refreshStatus.failed += 1;
          if (!existsSync(join(this.thumbnailDirectory, `${message.key}.webp`))) this.markThumbnailFailed(message.key);
        }
        this.refreshStatus.processed += 1;
        this.emitThumbnailRefresh();
      };
      if ((globalThis as { Bun?: unknown }).Bun) {
        const worker = new globalThis.Worker("./server/dist/admin/thumbnailRefreshWorker.js");
        this.refreshWorker = worker;
        worker.onmessage = (event) => {
          const message = event.data as { key: string; ok: boolean } | { done: true };
          onMessage(message);
          if ("done" in message) worker.terminate();
        };
        worker.onerror = (event) => { this.refreshStatus.error = event.message; finish(); };
        worker.addEventListener("close", finish);
        worker.postMessage(workerItems);
      } else {
        const worker = new NodeWorker(new URL("./thumbnailRefreshWorker.js", import.meta.url));
        this.refreshWorker = worker;
        worker.on("message", onMessage);
        worker.on("error", (error) => { this.refreshStatus.error = error.message; finish(); });
        worker.on("exit", finish);
        worker.postMessage(workerItems);
      }
    } catch (error) {
      this.refreshStatus.error = error instanceof Error ? error.message : "工作线程启动失败";
      finish();
    }
  }

  private emitThumbnailRefresh(): void {
    const status = this.getThumbnailRefreshStatus();
    for (const listener of this.refreshListeners) listener(status);
  }

  private topicThumbnailUrl(id: string, info: QuestionRecord): string | null {
    const key = this.thumbnailKey(id, info);
    return key ? `/api/admin/questions/${encodeURIComponent(id)}/thumbnail?v=${key}&r=${this.refreshStatus.revision}` : null;
  }

  private thumbnailKey(id: string, info: QuestionRecord): string | null {
    if (!info.question || !info.originalImage || basename(info.originalImage) !== info.originalImage || !imageExtensions.has(extname(info.originalImage).toLowerCase())) return null;
    const source = this.imagePath(info.originalImage);
    if (!existsSync(source)) return null;
    const image = statSync(source);
    return createHash("sha256").update(JSON.stringify(["precise-crop-v3", id, info.originalImage, info.question, image.mtimeMs, image.size])).digest("hex").slice(0, 24);
  }

  private scheduleThumbnailWarmup(topicId: string, previews: Array<{ id: string; thumbnailUrl: string | null }>): void {
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    const keys = new Set<string>();
    const ready = new Set<string>();
    const failed = new Set<string>();
    this.warmupQueue = previews.flatMap(({ id, thumbnailUrl }) => {
      const key = thumbnailUrl ? new URL(thumbnailUrl, "http://localhost").searchParams.get("v") : null;
      if (!key) return [];
      keys.add(key);
      if (existsSync(join(this.thumbnailDirectory, `${key}.webp`))) { ready.add(key); return []; }
      if (this.thumbnailFailures.has(key)) { failed.add(key); return []; }
      return [{ id, key }];
    });
    this.topicThumbnailProgress.set(topicId, { keys, ready, failed });
    if (this.warmupQueue.length) this.queueWarmup(2_000);
  }

  private markThumbnailReady(key: string): void {
    this.thumbnailFailures.delete(key);
    for (const progress of this.topicThumbnailProgress.values()) {
      if (progress.keys.has(key)) { progress.ready.add(key); progress.failed.delete(key); }
    }
  }

  private markThumbnailFailed(key: string): void {
    this.thumbnailFailures.add(key);
    for (const progress of this.topicThumbnailProgress.values()) {
      if (progress.keys.has(key) && !progress.ready.has(key)) progress.failed.add(key);
    }
  }

  private queueWarmup(delay: number): void {
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.warmupTimer = setTimeout(() => {
      this.warmupTimer = undefined;
      void this.warmNextThumbnail();
    }, delay);
    this.warmupTimer.unref();
  }

  private async warmNextThumbnail(): Promise<void> {
    if (this.refreshStatus.state === "running" || this.warmupRunning || this.thumbnailWorkers > 0 || this.thumbnailWaiters.length) {
      this.queueWarmup(750);
      return;
    }
    const next = this.warmupQueue.shift();
    if (!next) return;
    this.warmupRunning = true;
    try {
      if (!existsSync(join(this.thumbnailDirectory, `${next.key}.webp`))) await this.getQuestionThumbnail(next.id);
    } catch {
      // Invalid images remain visible in the list and use the normal error state.
    } finally {
      this.warmupRunning = false;
      if (this.warmupQueue.length) this.queueWarmup(750);
    }
  }

  async getQuestionThumbnail(id: string): Promise<Buffer> {
    if (!this.readCatalogue().some((entry) => entry.id === id)) throw new Error("题目不存在");
    const info = this.readJsonCached(this.questionPath(id), (raw) => questionRecordSchema.parse(raw));
    const key = this.thumbnailKey(id, info);
    if (!key || !info.question) throw new Error("题目谜面不可用");
    const target = join(this.thumbnailDirectory, `${key}.webp`);
    if (existsSync(target)) {
      const image = await readFile(target);
      this.markThumbnailReady(key);
      return image;
    }
    const cached = this.thumbnailJobs.get(key);
    if (cached) return cached;
    const job = this.withThumbnailSlot(async () => {
      if (!existsSync(target)) {
        const temporary = join(this.thumbnailDirectory, `${key}.${process.pid}.${randomUUID()}.tmp`);
        try {
          const thumbnail = await renderQuestionThumbnail(this.imagePath(info.originalImage), info.question!);
          await writeFile(temporary, thumbnail);
          try { renameSync(temporary, target); }
          catch (error) { if (existsSync(target)) rmSync(temporary, { force: true }); else throw error; }
        } finally { rmSync(temporary, { force: true }); }
      }
      return readFile(target);
    });
    this.thumbnailJobs.set(key, job);
    try {
      const image = await job;
      this.markThumbnailReady(key);
      return image;
    } catch (error) {
      this.markThumbnailFailed(key);
      throw error;
    } finally { this.thumbnailJobs.delete(key); }
  }

  private async withThumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.thumbnailWorkers >= 2) await new Promise<void>((resolve) => this.thumbnailWaiters.push(resolve));
    else this.thumbnailWorkers += 1;
    try { return await task(); }
    finally {
      const next = this.thumbnailWaiters.shift();
      if (next) next();
      else this.thumbnailWorkers -= 1;
    }
  }

  private buildLibrary() {
    const catalogue = this.readCatalogue();
    const topics = this.readTopics();
    const report = this.repository.getValidationReport();
    const validationById = new Map(report.items.map((item) => [item.id, item]));
    const questions = catalogue.map((entry) => {
      let info: QuestionRecord | null = null;
      try {
        info = this.readJsonCached(this.questionPath(entry.id), (raw) => questionRecordSchema.parse(raw));
      } catch {
        // Validation details are returned by the repository report.
      }
      const originalImage = info?.originalImage;
      return {
        id: entry.id,
        topic: entry.topic,
        info,
        originalImageUrl: originalImage ? imageUrl(originalImage) : null,
        validation: validationById.get(entry.id) ?? { id: entry.id, valid: false, errors: ["未校验"] },
      };
    });
    const questionsByImage = new Map<string, typeof questions>();
    for (const question of questions) {
      const name = question.info?.originalImage;
      if (!name) continue;
      const group = questionsByImage.get(name) ?? [];
      group.push(question);
      questionsByImage.set(name, group);
    }
    const images = readdirSync(this.fullDataDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()))
      .map((entry) => {
        const related = questionsByImage.get(entry.name) ?? [];
        return {
          fileName: entry.name,
          url: imageUrl(entry.name),
          metadata: this.readImageMetadata(entry.name),
          questionIds: related.map((question) => question.id),
          validCount: related.filter((question) => question.validation.valid).length,
          invalidCount: related.filter((question) => !question.validation.valid).length,
          totalCount: related.length,
          topicIds: [...new Set(related.flatMap((question) => question.topic))],
        };
      })
      .sort((left, right) => left.fileName.localeCompare(right.fileName));
    return { ...report, topics, images, questions, trash: this.listTrash() };
  }

  createTopic(name: string): Topic {
    const normalized = topicSchema.shape.name.parse(name);
    const topics = this.readTopics();
    if (topics.some((topic) => topic.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) throw new Error("主题名称已存在");
    const id = normalized.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80);
    if (!id || topics.some((topic) => topic.id === id)) throw new Error("主题 ID 已存在，请使用其他名称");
    const topic = { id, name: normalized, isDefault: false };
    this.writeTopics([...topics, topic]);
    return topic;
  }

  updateTopic(id: string, input: { name: string; isDefault: boolean }): Topic {
    const topics = this.readTopics();
    const current = topics.find((topic) => topic.id === id);
    if (!current) throw new Error("主题不存在");
    const name = topicSchema.shape.name.parse(input.name);
    if (topics.some((topic) => topic.id !== id && topic.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("主题名称已存在");
    if (!input.isDefault && current.isDefault && topics.length > 1) throw new Error("请先将其他主题设为默认主题");
    const updated = topics.map((topic) => ({
      ...topic,
      name: topic.id === id ? name : topic.name,
      isDefault: input.isDefault ? topic.id === id : topic.isDefault,
    }));
    this.writeTopics(updated);
    return updated.find((topic) => topic.id === id)!;
  }

  deleteTopic(id: string): void {
    const topics = this.readTopics();
    const topic = topics.find((item) => item.id === id);
    if (!topic) throw new Error("主题不存在");
    if (topics.length === 1) throw new Error("至少保留一个主题");
    if (topic.isDefault) throw new Error("请先将其他主题设为默认主题");
    if (this.readCatalogue().some((entry) => entry.topic.includes(id))) throw new Error("主题仍有关联题目，无法删除");
    if (this.listTrash().some((entry) => entry.topic.includes(id))) throw new Error("回收站中仍有此主题的题目，无法删除");
    this.writeTopics(topics.filter((item) => item.id !== id));
  }

  createQuestion(input: unknown): string {
    const parsed = questionInputSchema.parse(input);
    if (!parsed.title || !parsed.question) throw new Error("请先填写标题并完成谜面裁切");
    this.assertImageExists(parsed.originalImage);
    const id = this.deriveQuestionId(parsed.title);
    const { topic, ...recordInput } = parsed;
    const assignedTopics = this.resolveTopics(topic);
    const record = questionRecordSchema.parse({ ...recordInput, id });
    this.assertTopicImageUnique(record, assignedTopics);
    if (record.enabled) this.assertCanEnable(record);
    this.writeJsonAtomic(this.questionPath(id), record);
    try {
      this.writeCatalogue([...this.readCatalogue(), { id, file: `question_data/${id}.json`, topic: assignedTopics }]);
    } catch (error) {
      rmSync(this.questionPath(id), { force: true });
      throw error;
    }
    this.listCache = null;
    this.repository.reload();
    return id;
  }

  updateQuestion(id: string, input: unknown): QuestionRecord {
    this.assertRegisteredId(id);
    const { topic, ...recordInput } = questionInputSchema.parse(input);
    const catalogue = this.readCatalogue();
    const assignedTopics = topic.length ? this.resolveTopics(topic) : catalogue.find((entry) => entry.id === id)!.topic;
    const record = questionRecordSchema.parse({ ...recordInput, id });
    this.assertImageExists(record.originalImage);
    this.assertTopicImageUnique(record, assignedTopics, id);
    if (record.enabled) this.assertCanEnable(record);
    this.writeJsonAtomic(this.questionPath(id), record);
    if (JSON.stringify(catalogue.find((entry) => entry.id === id)!.topic) !== JSON.stringify(assignedTopics)) {
      this.writeCatalogue(catalogue.map((entry) => entry.id === id ? { ...entry, topic: assignedTopics } : entry));
    }
    this.listCache = null;
    this.repository.reload();
    return record;
  }

  deleteQuestion(id: string): { id: string; trashId: string } {
    this.assertRegisteredId(id);
    const catalogue = this.readCatalogue();
    const trashId = `${id}--${Date.now()}`;
    const questionPath = this.questionPath(id);
    const trashPath = this.trashPath(trashId);
    const topic = catalogue.find((entry) => entry.id === id)!.topic;
    this.writeJsonAtomic(this.trashTopicPath(trashId), topic);
    try { renameSync(questionPath, trashPath); }
    catch (error) { rmSync(this.trashTopicPath(trashId), { force: true }); throw error; }
    this.parsedFileCache.delete(questionPath);
    this.parsedFileCache.delete(trashPath);
    try {
      this.writeCatalogue(catalogue.filter((entry) => entry.id !== id));
    } catch (error) {
      renameSync(trashPath, questionPath);
      rmSync(this.trashTopicPath(trashId), { force: true });
      throw error;
    }
    this.listCache = null;
    this.repository.reload();
    return { id, trashId };
  }

  restoreQuestion(trashId: string): { id: string } {
    const trashPath = this.trashPath(trashId);
    if (!existsSync(trashPath)) throw new Error("回收站题目不存在");
    const record = questionRecordSchema.parse(JSON.parse(readFileSync(trashPath, "utf8")));
    const topicPath = this.trashTopicPath(trashId);
    const assignedTopics = this.resolveTopics(this.readTrashTopics(trashId));
    this.assertTopicImageUnique(record, assignedTopics);
    if (this.readCatalogue().some((entry) => entry.id === record.id) || existsSync(this.questionPath(record.id))) {
      throw new Error(`无法还原：题目 ID ${record.id} 已被使用`);
    }
    const questionPath = this.questionPath(record.id);
    renameSync(trashPath, questionPath);
    this.parsedFileCache.delete(trashPath);
    this.parsedFileCache.delete(questionPath);
    try {
      this.writeCatalogue([...this.readCatalogue(), { id: record.id, file: `question_data/${record.id}.json`, topic: assignedTopics }]);
    } catch (error) {
      renameSync(questionPath, trashPath);
      throw error;
    }
    this.listCache = null;
    this.repository.reload();
    rmSync(topicPath, { force: true });
    return { id: record.id };
  }

  permanentlyDeleteQuestion(trashId: string): { trashId: string } {
    const path = this.trashPath(trashId);
    if (!existsSync(path)) throw new Error("回收站题目不存在");
    rmSync(path, { force: true });
    rmSync(this.trashTopicPath(trashId), { force: true });
    this.listCache = null;
    return { trashId };
  }

  async addImages(files: UploadedImage[]): Promise<{ added: string[]; conflicts: string[] }> {
    const added: string[] = [];
    const conflicts: string[] = [];
    const accepted: Array<{ file: UploadedImage; fileName: string; stem: string }> = [];
    const reserved = new Set<string>();
    for (const file of files) {
      const extension = this.imageExtension(file);
      const stem = basename(file.originalname, extname(file.originalname)).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-|-$/g, "") || "image";
      const fileName = `${stem}${extension}`;
      if (existsSync(this.imagePath(fileName)) || reserved.has(fileName)) {
        conflicts.push(fileName);
        continue;
      }
      reserved.add(fileName);
      accepted.push({ file, fileName, stem });
      added.push(fileName);
    }
    await mapConcurrent(accepted, 16, async ({ file, fileName, stem }) => {
      const metadata = {
        name: stem,
        answers: [],
        hint: "",
        difficulty: [...difficulties],
        tags: [],
      };
      await Promise.all([
        writeFile(this.imagePath(fileName), file.buffer),
        writeFile(this.metadataPath(fileName), `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
      ]);
    });
    this.listCache = null;
    return { added, conflicts };
  }

  updateImageMetadata(fileName: string, input: unknown) {
    this.assertImageExists(fileName);
    const metadata = imageMetadataSchema.parse(input);
    this.writeJsonAtomic(this.metadataPath(fileName), metadata);
    this.listCache = null;
    return metadata;
  }

  createExport(): { sourceBytes: number; writeTo: (output: Writable, onProgress?: (writtenSourceBytes: number) => void) => Promise<void> } {
    const catalogue = this.readCatalogue();
    const entries: StoredZipEntry[] = [
      { archivePath: "catalogue.json", data: Buffer.from(`${JSON.stringify(catalogue, null, 2)}\n`) },
      { archivePath: "topic.json", data: Buffer.from(`${JSON.stringify(this.readTopics(), null, 2)}\n`) },
    ];
    for (const entry of catalogue) {
      const path = this.questionPath(entry.id);
      if (existsSync(path)) entries.push({ archivePath: entry.file, sourcePath: path });
    }
    for (const entry of readdirSync(this.fullDataDirectory, { withFileTypes: true })) {
      if (entry.isFile() && (imageExtensions.has(extname(entry.name).toLowerCase()) || extname(entry.name).toLowerCase() === ".json")) {
        entries.push({ archivePath: `full_data/${entry.name}`, sourcePath: join(this.fullDataDirectory, entry.name) });
      }
    }
    return {
      sourceBytes: storedZipSourceSize(entries),
      writeTo: (output, onProgress) => writeStoredZip(output, entries, onProgress),
    };
  }

  async importZip(input: Buffer | string) {
    const streamingReader = typeof input === "string" ? await StreamingZipReader.open(input) : null;
    try {
      const files = new Map<string, ImportZipEntry>();
      if (streamingReader) {
        for (const entry of streamingReader.entries) {
          const archivePath = validateArchivePath(entry.entryName);
          if (!entry.isDirectory) {
            files.set(archivePath, {
              read: () => streamingReader.readEntry(entry),
              writeTo: (targetPath) => streamingReader.writeEntry(entry, targetPath),
            });
          }
        }
      } else {
        const zip = new AdmZip(input as Buffer, { readEntries: true });
        for (const entry of zip.getEntries()) {
          const archivePath = validateArchivePath(entry.entryName);
          if (!entry.isDirectory) {
            files.set(archivePath, {
              read: () => readZipEntry(entry),
              writeTo: async (targetPath) => writeFile(targetPath, await readZipEntry(entry)),
            });
          }
        }
      }
      const cataloguePaths = [...files.keys()].filter((path) => path === "catalogue.json" || path.endsWith("/catalogue.json"));
      if (cataloguePaths.length !== 1) throw new Error("资源包中必须且只能包含一个 catalogue.json");
      const cataloguePath = cataloguePaths[0];
      const prefix = cataloguePath.slice(0, -"catalogue.json".length);
      const importedCatalogue = catalogueSchema.parse(JSON.parse((await files.get(cataloguePath)!.read()).toString("utf8")));
      const topicEntry = files.get(`${prefix}topic.json`);
      const importedTopics = topicEntry ? topicsSchema.parse(JSON.parse((await topicEntry.read()).toString("utf8"))) : [];
      const mergedTopics = [...this.readTopics()];
      const topicMap = new Map<string, string>();
      for (const topic of importedTopics) {
        const byName = mergedTopics.find((item) => item.name.toLocaleLowerCase() === topic.name.toLocaleLowerCase());
        const byId = mergedTopics.find((item) => item.id === topic.id);
        if (byName && byId && byName.id !== byId.id) throw new Error(`导入主题冲突：${topic.name}`);
        if (byId && byId.name !== topic.name) throw new Error(`导入主题 ID 冲突：${topic.id}`);
        if (!byName && !byId) mergedTopics.push({ ...topic, isDefault: false });
        topicMap.set(topic.id, (byName ?? byId)?.id ?? topic.id);
      }
      const current = this.readCatalogue();
      const currentIds = new Set(current.map((entry) => entry.id));
      const conflicts: string[] = [];
      const imported: Array<{ entry: CatalogueEntry; record: QuestionRecord }> = [];
      for (const entry of importedCatalogue) {
        if (currentIds.has(entry.id)) {
          conflicts.push(entry.id);
          continue;
        }
        const recordEntry = files.get(`${prefix}${entry.file}`);
        if (!recordEntry) throw new Error(`题目 ${entry.id} 缺少记录文件`);
        const record = questionRecordSchema.parse(JSON.parse((await recordEntry.read()).toString("utf8")));
        if (record.id !== entry.id) throw new Error(`题目 ${entry.id} 的记录 ID 不一致`);
        const imageEntry = files.get(`${prefix}full_data/${record.originalImage}`);
        if (!imageEntry && !existsSync(this.imagePath(record.originalImage))) throw new Error(`题目 ${entry.id} 缺少原图 ${record.originalImage}`);
        const assignedTopics = entry.topic.length
          ? entry.topic.map((id) => {
            const mapped = topicMap.get(id);
            if (!mapped) throw new Error(`题目 ${entry.id} 引用了未定义的主题 ${id}`);
            return mapped;
          })
          : [this.defaultTopicId()];
        if (new Set(assignedTopics).size !== assignedTopics.length) throw new Error(`题目 ${entry.id} 的主题重复`);
        imported.push({ entry: { id: entry.id, file: `question_data/${entry.id}.json`, topic: assignedTopics }, record });
      }
      const occupied = new Map<string, string>();
      for (const entry of current) {
        const record = this.readJsonCached(this.questionPath(entry.id), (raw) => questionRecordSchema.parse(raw));
        for (const topic of entry.topic) occupied.set(`${topic}\0${record.originalImage}`, entry.id);
      }
      for (const item of imported) {
        for (const topic of item.entry.topic) {
          const key = `${topic}\0${item.record.originalImage}`;
          if (occupied.has(key)) throw new Error(`主题 ${topic} 中原图 ${item.record.originalImage} 已被题目 ${occupied.get(key)} 使用`);
          occupied.set(key, item.entry.id);
        }
      }
      const imageEntries: Array<{ target: string; entry: ImportZipEntry }> = [];
      for (const [path, entry] of files) {
        if (!path.startsWith(`${prefix}full_data/`)) continue;
        const name = path.slice(`${prefix}full_data/`.length);
        if (!name || name !== basename(name) || (!imageExtensions.has(extname(name).toLowerCase()) && extname(name).toLowerCase() !== ".json")) continue;
        const target = join(this.fullDataDirectory, name);
        if (!existsSync(target)) imageEntries.push({ target, entry });
      }
      await mapConcurrent(imageEntries, 4, async ({ target, entry }) => entry.writeTo(target));
      for (const item of imported) this.writeJsonAtomic(this.questionPath(item.entry.id), item.record);
      if (!existsSync(join(this.resourceDirectory, "topic.json")) || mergedTopics.length !== this.readTopics().length) this.writeTopics(mergedTopics);
      this.writeCatalogue([...current, ...imported.map((item) => item.entry)]);
      this.listCache = null;
      this.repository.reload();
      return { importedIds: imported.map((item) => item.entry.id), conflicts, report: this.repository.getValidationReport() };
    } finally {
      await streamingReader?.close();
    }
  }

  // 资源代际：catalogue 文件与三个资源目录的时间戳 + 尺寸签名，用于探测服务进程外的手工增删。
  private resourceGeneration(): string {
    return [join(this.resourceDirectory, "catalogue.json"), join(this.resourceDirectory, "topic.json"), this.fullDataDirectory, this.questionDataDirectory, this.questionTrashDirectory]
      .map((path) => {
        if (!existsSync(path)) return "missing";
        const stat = statSync(path);
        return `${stat.mtimeMs}:${stat.size}`;
      })
      .join("|");
  }

  private assertCanEnable(record: QuestionRecord): void {
    const errors = validateCompleteRecord(record, this.fullDataDirectory);
    if (errors.length) throw new Error(`题目 ${record.id} 信息未补全：${errors.join("、")}`);
  }

  private listTrash() {
    return readdirSync(this.questionTrashDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
      .flatMap((entry) => {
        const trashId = basename(entry.name, ".json");
        try {
          const info = this.readJsonCached(this.trashPath(trashId), (raw) => questionRecordSchema.parse(raw));
          return [{ trashId, id: info.id, info, topic: this.readTrashTopics(trashId), originalImageUrl: imageUrl(info.originalImage) }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => left.info.title.localeCompare(right.info.title));
  }

  private readCatalogue(): CatalogueEntry[] {
    const topics = this.readTopics();
    const defaultId = topics.some((topic) => topic.id === initialTopics[0].id) ? initialTopics[0].id : this.defaultTopicId();
    return this.readJsonCached(join(this.resourceDirectory, "catalogue.json"), (raw) => catalogueSchema.parse(raw))
      .map((entry) => ({ ...entry, topic: entry.topic.length ? entry.topic : [defaultId] }));
  }

  private readTopics(): Topic[] {
    const path = join(this.resourceDirectory, "topic.json");
    return existsSync(path) ? this.readJsonCached(path, (raw) => topicsSchema.parse(raw)) : initialTopics;
  }

  private writeTopics(value: Topic[]): void {
    this.writeJsonAtomic(join(this.resourceDirectory, "topic.json"), topicsSchema.parse(value));
    this.listCache = null;
    this.repository.reload();
  }

  private defaultTopicId(): string { return this.readTopics().find((topic) => topic.isDefault)!.id; }

  private resolveTopics(input: string[]): string[] {
    const assigned = input.length ? input : [this.defaultTopicId()];
    const ids = new Set(this.readTopics().map((topic) => topic.id));
    if (assigned.length !== new Set(assigned).size || assigned.some((id) => !ids.has(id))) throw new Error("题目主题重复或不存在");
    return assigned;
  }

  private assertTopicImageUnique(record: QuestionRecord, topic: string[], exceptId = ""): void {
    for (const entry of this.readCatalogue()) {
      if (entry.id === exceptId || !entry.topic.some((id) => topic.includes(id))) continue;
      const other = this.readJsonCached(this.questionPath(entry.id), (raw) => questionRecordSchema.parse(raw));
      if (other.originalImage === record.originalImage) throw new Error(`原图 ${record.originalImage} 在主题 ${entry.topic.find((id) => topic.includes(id))} 中已有题目 ${entry.id}`);
    }
  }

  private writeCatalogue(value: CatalogueEntry[]): void {
    this.writeJsonAtomic(join(this.resourceDirectory, "catalogue.json"), catalogueSchema.parse(value));
  }

  private readImageMetadata(fileName: string) {
    const path = this.metadataPath(fileName);
    if (!existsSync(path)) return imageMetadataSchema.parse({});
    try {
      return this.readJsonCached(path, (raw) => imageMetadataSchema.parse(raw));
    } catch {
      return imageMetadataSchema.parse({});
    }
  }

  private readJsonCached<T>(path: string, parse: (raw: unknown) => T): T {
    const { mtimeMs, size } = statSync(path);
    const cached = this.parsedFileCache.get(path);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.value as T;
    const value = parse(JSON.parse(readFileSync(path, "utf8")));
    this.parsedFileCache.set(path, { mtimeMs, size, value });
    return value;
  }

  // 题目 ID 由标题派生：创建前做存在性校验，已存在则拒绝创建（不再自动追加序号），
  // 避免同标题题目静默生成 xxx-2、xxx-3 这类难以辨认的记录。
  private deriveQuestionId(title: string): string {
    const base = title.normalize("NFKC").trim().replace(/\+/g, " plus ").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "question";
    const normalizedTitle = normalizeQuestionTitle(title);
    const duplicate = this.readCatalogue().find((entry) => {
      try {
        const record = this.readJsonCached(this.questionPath(entry.id), (raw) => questionRecordSchema.parse(raw));
        return entry.id === base || normalizeQuestionTitle(record.title) === normalizedTitle;
      } catch {
        return entry.id === base;
      }
    }) ?? this.listTrash().find((entry) => entry.id === base || normalizeQuestionTitle(entry.info.title) === normalizedTitle);
    if (
      duplicate
      || existsSync(this.questionPath(base))
    ) {
      throw new Error(`已存在相同标题的题目（ID：${duplicate?.id ?? base}），请修改标题后再创建`);
    }
    return base;
  }

  private assertRegisteredId(id: string): void {
    if (!this.readCatalogue().some((entry) => entry.id === id)) throw new Error("题目不存在或未注册");
  }

  private assertImageExists(fileName: string): void {
    if (!fileName || fileName !== basename(fileName) || !imageExtensions.has(extname(fileName).toLowerCase())) throw new Error("原图文件名不合法");
    if (!existsSync(this.imagePath(fileName))) throw new Error(`原图不存在：${fileName}`);
  }

  private imageExtension(file: UploadedImage): string {
    const extension = imageMimeExtensions.get(file.mimetype) ?? extname(file.originalname).toLowerCase();
    if (!imageExtensions.has(extension)) throw new Error("只允许上传 PNG、JPG、WEBP 或 GIF 图片");
    return extension;
  }

  private questionPath(id: string): string {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(id)) throw new Error(`非法题目 ID：${id}`);
    const target = resolve(this.questionDataDirectory, `${id}.json`);
    if (!target.startsWith(resolve(this.questionDataDirectory) + sep)) throw new Error("题目路径超出 question_data 目录");
    return target;
  }

  private trashPath(trashId: string): string {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,119}$/u.test(trashId)) throw new Error(`非法回收站题目 ID：${trashId}`);
    const target = resolve(this.questionTrashDirectory, `${trashId}.json`);
    if (!target.startsWith(resolve(this.questionTrashDirectory) + sep)) throw new Error("题目路径超出 question_trash 目录");
    return target;
  }

  private trashTopicPath(trashId: string): string { return `${this.trashPath(trashId)}.topics`; }

  private readTrashTopics(trashId: string): string[] {
    const path = this.trashTopicPath(trashId);
    return existsSync(path) ? z.array(topicIdSchema).min(1).parse(JSON.parse(readFileSync(path, "utf8"))) : [this.defaultTopicId()];
  }

  private imagePath(name: string): string { return join(this.fullDataDirectory, basename(name)); }
  private metadataPath(imageName: string): string { return join(this.fullDataDirectory, `${basename(imageName, extname(imageName))}.json`); }

  private writeJsonAtomic(path: string, value: unknown): void {
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
    this.parsedFileCache.delete(path);
  }
}

export function validateArchivePath(input: string): string {
  const normalized = input.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) throw new Error(`ZIP 包含非法路径：${input}`);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error(`ZIP 包含路径穿越：${input}`);
  const safePath = posix.normalize(parts.join("/"));
  if (safePath.startsWith("../") || safePath === "..") throw new Error(`ZIP 包含路径穿越：${input}`);
  return safePath;
}

function normalizeQuestionTitle(title: string): string {
  return title.normalize("NFKC").trim().toLocaleLowerCase();
}

function readZipEntry(entry: AdmZip.IZipEntry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    entry.getDataAsync((data, error) => error ? reject(new Error(error)) : resolve(data));
  });
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
