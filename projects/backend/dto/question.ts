import { z } from "zod";

export const QuestionSeedSchema = z.object({
  header: z.string(),
  unpopulated: z.string(),
  populated: z.string(),
  autoYesExp: z.string(),
});

export const LlmQuestionAnswerSchema = z.object({
  answer: z.string(),
  thinking: z.string(),
  defense: z.string(),
});

export const QuestionAstNodeSchema = z.object({
  question: z.string(),
  flip: z.boolean(),
});

export const AstResultsSchema = z.object({
  ast: z.array(z.array(QuestionAstNodeSchema)).optional(),
  raw: z.array(z.array(z.any())).optional(),
  notResults: z.array(z.array(z.boolean())).optional(),
  andResults: z.array(z.boolean()).optional(),
  orResult: z.boolean().optional(),
});

export const QuestionSchema = QuestionSeedSchema.extend({
  astResults: AstResultsSchema,
  resolvedAst: z.array(QuestionAstNodeSchema).optional(),
  autoYesVal: z.boolean(),
  autoYesMsg: z.string(),
});

export const AnsweredQuestionSchema = QuestionSchema.extend({
  answer: z.string(),
  thinking: z.string(),
  defense: z.string(),
  snippet: z.string().optional(),
});

export type IQuestionSeed = z.infer<typeof QuestionSeedSchema>;
export type ILlmQuestionAnswer = z.infer<typeof LlmQuestionAnswerSchema>;
export type IQuestionAstNode = z.infer<typeof QuestionAstNodeSchema>;
export type IQuestion = z.infer<typeof QuestionSchema>;
export type IAnsweredQuestion = z.infer<typeof AnsweredQuestionSchema>;
