const METHODS = ["get", "post"] as const;
const ROUTER_CONFIG = {
  methods: [...METHODS, "all"],
  strict: true,
  timeout: undefined,
  generation: 9007199254740993n,
} as const;

function Page(): JSX.Element {
  return <html><body><h1>Staged constants</h1></body></html>;
}

export function GET(request: Request): Response {
  return Response.html(<Page />);
}
