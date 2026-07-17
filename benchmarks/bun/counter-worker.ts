let count = 0;

self.onmessage = (event: MessageEvent<{id: number; delta: number}>) => {
  count += event.data.delta;
  postMessage({id: event.data.id, output: String(count)});
};
