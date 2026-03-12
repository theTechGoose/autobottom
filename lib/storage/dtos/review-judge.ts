/** DTOs for review and judge queue entities. */

export class ReviewPending {
  findingId = "";
  questionIndex = 0;
  header = "";
  populated = "";
  thinking = "";
  defense = "";
  answer = "";
}

export class ReviewDecisionDto {
  findingId = "";
  questionIndex = 0;
  decision: "confirm" | "flip" = "confirm";
  reviewer = "";
  decidedAt = 0;
}

export class JudgePending {
  findingId = "";
  questionIndex = 0;
  header = "";
  populated = "";
  thinking = "";
  defense = "";
  answer = "";
}

export class JudgeDecisionDto {
  findingId = "";
  questionIndex = 0;
  decision: "uphold" | "overturn" = "uphold";
  judge = "";
  decidedAt = 0;
}

export class AppealRecordDto {
  findingId = "";
  appealedAt = 0;
  status: "pending" | "complete" = "pending";
}
