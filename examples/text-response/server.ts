import {MESSAGE} from "./constants.js";
import {message} from "./message.js";

class TextContext {
  constructor(readonly body: string) {}

  render(): string {
    return message(this.body);
  }
}

function greeting(value: string): string {
  return new TextContext(value).render();
}

export function GET(request: Request): Response {
  return Response.text(greeting(MESSAGE));
}
