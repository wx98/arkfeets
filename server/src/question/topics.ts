import { z } from "zod";

export const topicIdSchema = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u);
export const topicSchema = z.object({
  id: topicIdSchema,
  name: z.string().trim().min(1).max(60),
  isDefault: z.boolean(),
}).strict();
export const topicsSchema = z.array(topicSchema).min(1).superRefine((topics, context) => {
  if (new Set(topics.map((topic) => topic.id)).size !== topics.length) context.addIssue({ code: "custom", message: "主题 ID 不能重复" });
  if (new Set(topics.map((topic) => topic.name.toLocaleLowerCase())).size !== topics.length) context.addIssue({ code: "custom", message: "主题名称不能重复" });
  if (topics.filter((topic) => topic.isDefault).length !== 1) context.addIssue({ code: "custom", message: "必须且只能有一个默认主题" });
});
export type Topic = z.infer<typeof topicSchema>;
export const initialTopics: Topic[] = [{ id: "脚", name: "脚", isDefault: true }];
