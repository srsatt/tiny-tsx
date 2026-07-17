function select(enabled: boolean): string {
  const local = enabled;
  if (local === true) return "enabled";
  return "disabled";
}

export function GET(_request: Request): Response {
  return Response.text(select(false));
}
