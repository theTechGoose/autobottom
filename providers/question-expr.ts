/** Question expression provider - populates templates and parses AST. */
import type { IQuestion, IQuestionAstNode, IQuestionSeed } from "../types/mod.ts";
import { createQuestion } from "../types/mod.ts";

const PLACEHOLDER_RE = /\{\{\s*(\d+)\s*(?:!\s*([^}]*)\s*)?\}\}/g;

const operators = {
  or: "|",
  and: "&",
  not: "!",
  prefix: "+:",
};

/** Populate question templates with record field values. */
export function populateQuestions(
  questions: IQuestionSeed[],
  record: Record<string, any>,
  fieldLookup: (id: string, record: Record<string, any>) => any,
): IQuestion[] {
  return questions.map((question) => {
    const replacer = (_: string, id: string, defaultValue?: string): string => {
      const raw = fieldLookup(id, record);
      if (raw !== undefined && raw !== null && raw !== "") return String(raw).trim();
      if (defaultValue !== undefined) return defaultValue.trim();
      return "";
    };

    return createQuestion({
      ...question,
      autoYesExp: question.autoYesExp.replace(PLACEHOLDER_RE, replacer),
      populated: question.populated.replace(PLACEHOLDER_RE, replacer),
    });
  });
}

/** Parse compound question AST (|, &, !, +: operators). */
export function parseAst(question: IQuestion): IQuestion {
  const prefixCandidate = question.populated.trim().slice(0, 2);
  const isPrefixed = prefixCandidate === operators.prefix;
  const andSep = isPrefixed ? operators.and : "nonsensical_never_match_!!__";
  const orSep = isPrefixed ? operators.or : "nonsensical_never_match_!!__";

  const { cleaned, notes } = pullNotes(question.populated);

  const ast: IQuestionAstNode[][] = cleaned.split(orSep).map((or) => {
    return or.split(andSep).map((and) => ({
      flip: and.includes(operators.not),
      question: `${notes.join("\n")} ` + and.replace(operators.not, "").trim(),
    }));
  });

  return {
    ...question,
    astResults: { ...question.astResults, ast },
  };
}

function pullNotes(input: string): { cleaned: string; notes: string[] } {
  const notes: string[] = [];
  const cleaned = input.replace(/```([^`]*)```/g, (_, note) => {
    notes.push(note.trim());
    return "";
  });
  return { cleaned: cleaned.trim(), notes };
}
