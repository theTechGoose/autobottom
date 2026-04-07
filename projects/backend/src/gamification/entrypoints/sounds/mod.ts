import "reflect-metadata";
import { Controller, Get, Req } from "@danet/core";
import { handleSoundFile } from "../../../entrypoints/sounds.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

@Controller("sounds")
export class SoundsController {

  /**
   * Catch-all GET handler for sound file serving.
   * Routes:
   * - /sounds/{orgId}/{packId}/{slot}.mp3 -> S3
   * - /sounds/{name}.mp3 -> local file fallback
   */
  @Get(":path1/:path2/:path3")
  async s3Sound(@Req() req: Request): Promise<Response> {
    const result = await handleSoundFile(req);
    return result ?? json({ error: "not found" }, 404);
  }

  @Get(":name")
  async localSound(@Req() req: Request): Promise<Response> {
    const result = await handleSoundFile(req);
    return result ?? json({ error: "not found" }, 404);
  }
}
