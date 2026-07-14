import {Heading} from "./heading.js";

function Page(): JSX.Element {
  return <html><body><main><Heading /></main></body></html>;
}

export function GET(request: Request): Response {
  return Response.html(<Page />);
}
