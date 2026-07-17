function fail(): string {
  throw "boom";
}

export function GET(_request: Request): Response {
  return Response.text(fail());
}
