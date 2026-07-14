import {message} from "./message.js";

function greeting(): string {
  return message();
}

export function GET(request: Request): Response {
  return Response.text(greeting());
}
