function risky(value: string): string {
  if (value === "bad") throw "bad";
  return value;
}

function recover(value: string): string {
  try {
    return risky(value);
  } catch (error: any) {
    return error;
  }
}

function exercise(): string {
  const normal = recover("ok");
  if (normal === "ok") return recover("bad");
  return "invalid";
}

export function GET(_request: Request): Response {
  return Response.text(exercise());
}
