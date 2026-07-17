function count(): number {
  let total = 0;
  for (let index = 0; index < 3; index++) {
    total += 1;
  }
  return total;
}

function classify(value: number): string {
  if (value === 3) return "three";
  return "other";
}

export function GET(_request: Request): Response {
  return Response.text(classify(count()));
}
