const METHODS = ["get", "post"] as const;
const ROUTER_CONFIG = {
  methods: [...METHODS, "all"],
  strict: true,
  timeout: undefined,
  generation: 9007199254740993n,
} as const;
const SHARED_SYMBOL = Symbol("shared");
const OTHER_SYMBOL = Symbol("shared");
const SPECIAL_CONSTANTS = {
  negativeZero: -0,
  nan: NaN,
  positiveInfinity: Infinity,
  negativeInfinity: -Infinity,
  sharedSymbol: SHARED_SYMBOL,
  sharedSymbolAgain: SHARED_SYMBOL,
  otherSymbol: OTHER_SYMBOL,
  anonymousSymbol: Symbol(),
} as const;

function Page(): JSX.Element {
  return <html><body><h1>Staged constants</h1></body></html>;
}

export function GET(request: Request): Response {
  return Response.html(<Page />);
}
