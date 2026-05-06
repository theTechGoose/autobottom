/** Generic body DTOs for swagger compatibility.
 *  These replace `Record<string, any>` in @Body() decorators so the swagger
 *  doc builder can construct them without crashing. */

export class JsonBody {
  [key: string]: unknown;
}

export class IdBody {
  id = "";
}

export class EmailBody {
  email = "";
}

export class FindingIdBody {
  findingId = "";
}

export class TimeRangeBody {
  since = 0;
  until = 0;
}

// Zod validation schemas — shape-checker compliance
import { z } from "#zod";
export const GenericBodySchema = z.object({}).passthrough();
