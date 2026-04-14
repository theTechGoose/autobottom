/** Tests that all DTO classes can be constructed via Reflect.construct —
 *  the exact call @danet/swagger makes in generateTypeSchema. */

import { assert } from "jsr:@std/assert";
import * as R from "./responses.ts";
import * as Q from "./requests.ts";

const allResponseDtos = Object.values(R).filter((v) => typeof v === "function") as (new () => unknown)[];
const allRequestDtos = Object.values(Q).filter((v) => typeof v === "function") as (new () => unknown)[];

for (const Dto of allResponseDtos) {
  Deno.test(`Response DTO ${Dto.name} — Reflect.construct works`, () => {
    const instance = Reflect.construct(Dto, []);
    const props = Object.getOwnPropertyNames(instance);
    assert(props.length > 0, `${Dto.name} has no properties — swagger needs at least one`);
  });
}

for (const Dto of allRequestDtos) {
  Deno.test(`Request DTO ${Dto.name} — Reflect.construct works`, () => {
    const instance = Reflect.construct(Dto, []);
    const props = Object.getOwnPropertyNames(instance);
    assert(props.length > 0, `${Dto.name} has no properties — swagger needs at least one`);
  });
}
