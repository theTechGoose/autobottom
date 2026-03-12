/** DTOs for audit pipeline entities. */

export class AuditFinding { id = ""; }
export class AuditJob { id = ""; }
export class QuestionCache { answer = ""; thinking = ""; defense = ""; }
export class DestinationQuestions { items: unknown[] = []; }
export class BatchCounter { count = 0; }
export class PopulatedQuestions { items: unknown[] = []; }
export class BatchAnswers { items: unknown[] = []; }
export class AuditTranscript { raw = ""; diarized = ""; utteranceTimes: number[] = []; }
