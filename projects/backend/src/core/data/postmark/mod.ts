import "reflect-metadata";
import { Injectable } from "@danet/core";
import { sendEmail } from "./impl.ts";

@Injectable()
export class PostmarkService {
  sendEmail = sendEmail;
}
