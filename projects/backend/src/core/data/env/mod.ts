import "reflect-metadata";
import { Injectable } from "@danet/core";
import { env } from "./impl.ts";

@Injectable()
export class EnvService {
  env = env;
}
