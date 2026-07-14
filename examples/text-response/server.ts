import {MESSAGE} from "./constants.js";
import {message} from "./message.js";

function greeting(value: string): string {
  return message(value);
}

export function GET(request: Request): Response {
  return Response.text(greeting(MESSAGE));
}
