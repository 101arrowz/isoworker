export default <T>(
  c: string,
  msg: unknown,
  transfer: ArrayBuffer[],
  cb: (err: unknown, msg: T) => void
) => {
  const u = URL.createObjectURL(new Blob([c], { type: 'text/javascript' }));
  const w = new Worker(u);
  w.onerror = e => cb(e.error, null);
  w.onmessage = e => cb(null, e.data);
  w.postMessage(msg, transfer);
  return w;
};
