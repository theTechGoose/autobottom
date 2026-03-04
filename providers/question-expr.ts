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

/**
 * Evaluate an auto-yes expression against already-substituted field values.
 * Format: `value~sub::message`  → applies if value contains sub
 *         `value/sub::message`  → applies if value does NOT contain sub
 *         `a=b::message`        → applies if a equals b (0=0 is always true)
 * Returns { applies: true, message } when the condition matches.
 */
export function evaluateAutoYes(exp: string): { applies: boolean; message: string } {
  if (!exp) return { applies: false, message: "" };
  const colonIdx = exp.indexOf("::");
  const condition = (colonIdx >= 0 ? exp.slice(0, colonIdx) : exp).trim();
  const message = (colonIdx >= 0 ? exp.slice(colonIdx + 2) : "Auto-Yes").trim();
  if (!condition) return { applies: false, message };

  // ~ : contains
  const tildeIdx = condition.indexOf("~");
  if (tildeIdx > 0) {
    const value = condition.slice(0, tildeIdx).trim().toLowerCase();
    const sub = condition.slice(tildeIdx + 1).trim().toLowerCase();
    return { applies: value.includes(sub), message };
  }

  // / : not contains
  const slashIdx = condition.indexOf("/");
  if (slashIdx > 0) {
    const value = condition.slice(0, slashIdx).trim().toLowerCase();
    const sub = condition.slice(slashIdx + 1).trim().toLowerCase();
    return { applies: !value.includes(sub), message };
  }

  // = : equals (0=0 is always true)
  const equalsIdx = condition.indexOf("=");
  if (equalsIdx > 0) {
    const a = condition.slice(0, equalsIdx).trim();
    const b = condition.slice(equalsIdx + 1).trim();
    return { applies: a === b, message };
  }

  // # : not equals
  const hashIdx = condition.indexOf("#");
  if (hashIdx > 0) {
    const a = condition.slice(0, hashIdx).trim().toLowerCase();
    const b = condition.slice(hashIdx + 1).trim().toLowerCase();
    return { applies: a !== b, message };
  }

  // < : less than (numeric)
  const ltIdx = condition.indexOf("<");
  if (ltIdx > 0) {
    const a = parseFloat(condition.slice(0, ltIdx).trim() || "0");
    const b = parseFloat(condition.slice(ltIdx + 1).trim() || "0");
    return { applies: !isNaN(a) && !isNaN(b) && a < b, message };
  }

  return { applies: false, message };
}

function pullNotes(input: string): { cleaned: string; notes: string[] } {
  const notes: string[] = [];
  const cleaned = input.replace(/```([^`]*)```/g, (_, note) => {
    notes.push(note.trim());
    return "";
  });
  return { cleaned: cleaned.trim(), notes };
}
