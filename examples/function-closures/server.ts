function authorize(result: string): string {
  const expected = "admin";
  const decide = (candidate: string): string => {
    if (candidate === expected) return result;
    return "denied";
  };
  return decide("admin");
}

export function GET(_request: Request): Response {
  return Response.text(authorize("allowed"));
}
