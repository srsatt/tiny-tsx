self.onmessage = (event: MessageEvent<{id: number; input: string}>) => {
  postMessage({id: event.data.id, output: event.data.input.toUpperCase()});
};
