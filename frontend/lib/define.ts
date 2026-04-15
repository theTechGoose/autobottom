/** Shared Fresh define helper with State type. */
import { createDefine } from "@fresh/core";
import type { State } from "./auth.ts";

export const define = createDefine<State>();
