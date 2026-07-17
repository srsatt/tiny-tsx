function confirm(value: string): string {
  const local = value;
  if (local === "denied") return local;
  return "invalid";
}

function select(value: string): string {
  const local = value;
  if (local === "admin") return "allowed";
  return confirm("denied");
}

export function GET(_request: Request): Response {
  return Response.text(select("guest"));
}
