function decrement(value: number): number {
  return value - 1;
}

function classify(value: number): string {
  const next = value + 2;
  if (decrement(next) === 3) return "three";
  return "other";
}

export function GET(_request: Request): Response {
  return Response.text(classify(2));
}
