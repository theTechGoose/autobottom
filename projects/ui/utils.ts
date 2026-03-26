import { createDefine } from "fresh";

export interface State {
  user?: {
    email: string;
    role: string;
    orgId: string;
  };
}

export const define = createDefine<State>();
