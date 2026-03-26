import type { IAnsweredQuestion, ILlmQuestionAnswer, IQuestion, IQuestionSeed } from "../../../../../dto/question.ts";

export class QuestionService {
  private normalizeAnswer(raw: unknown): string {
    const s = String(raw ?? "").trim().toLowerCase();
    if (s.startsWith("yes") || s === "true" || s === "y" || s === "1") return "Yes";
    if (s.startsWith("no") || s === "false" || s === "n" || s === "0") return "No";
    // If it's something weird like [object Object], check if it's truthy-looking
    if (s.includes("yes")) return "Yes";
    if (s.includes("no")) return "No";
    return "No";
  }

  createQuestion(seed: IQuestionSeed & Partial<IQuestion>): IQuestion {
    return {
      header: seed.header,
      unpopulated: seed.unpopulated,
      populated: seed.populated,
      autoYesExp: seed.autoYesExp,
      astResults: seed.astResults ?? {},
      autoYesVal: seed.autoYesVal ?? false,
      autoYesMsg: seed.autoYesMsg ?? "default, this should never happen",
    };
  }

  answerQuestion(q: IQuestion, answer: ILlmQuestionAnswer): IAnsweredQuestion {
    return {
      ...q,
      answer: this.normalizeAnswer(answer.answer),
      thinking: String(answer.thinking ?? ""),
      defense: String(answer.defense ?? ""),
    };
  }
}

// Old API preserved as wrappers
const _svc = new QuestionService();
export function createQuestion(
  ...args: Parameters<QuestionService["createQuestion"]>
): IQuestion {
  return _svc.createQuestion(...args);
}
export function answerQuestion(
  ...args: Parameters<QuestionService["answerQuestion"]>
): IAnsweredQuestion {
  return _svc.answerQuestion(...args);
}
