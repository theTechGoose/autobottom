import "reflect-metadata";
import { Injectable } from "@danet/core";
import {
  getTokenUsage,
  makeUserPrompt,
  askQuestion,
  generateFeedback,
  summarize,
  diarize,
  parseLlmJson,
} from "./impl.ts";

@Injectable()
export class GroqService {
  getTokenUsage = getTokenUsage;
  makeUserPrompt = makeUserPrompt;
  askQuestion = askQuestion;
  generateFeedback = generateFeedback;
  summarize = summarize;
  diarize = diarize;
  parseLlmJson = parseLlmJson;
}

export type { LlmAnswer } from "./impl.ts";
