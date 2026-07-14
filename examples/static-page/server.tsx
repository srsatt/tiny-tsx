function Page(): JSX.Element {
  return (
    <html>
      <body>
        <h1>Hello from TinyTSX</h1>
      </body>
    </html>
  );
}

export function GET(request: Request): Response {
  return Response.html(<Page />);
}

