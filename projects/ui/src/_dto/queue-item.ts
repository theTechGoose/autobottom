export interface QueueItem {
  findingId: string;
  questionIndex: number;
  header: string;
  populated: string;
  defense: string;
  thinking?: string;
  answer?: string;
  appealType?: string;
  appealComment?: string;
}
