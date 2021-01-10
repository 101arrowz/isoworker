const wk = (
  c: string,
  msg: unknown,
  transfer: Transferable[],
  cb: (err: Error, res: unknown) => unknown
): Worker => {
  const u = URL.createObjectURL(new Blob([c], { type: 'text/javascript' }));
  const w = new Worker(u);
  w.postMessage(msg, transfer);
  w.addEventListener('message', ev => cb(null, ev.data));
  w.addEventListener('error', ev => cb(ev.error, null));
  return w;
};
export type WorkerTransfer = Transferable;
wk.t = [ArrayBuffer, MessagePort] as Function[];
if (typeof ImageBitmap != 'undefined') wk.t.push(ImageBitmap);
if (typeof OffscreenCanvas != 'undefined') wk.t.push(OffscreenCanvas);

export default wk;
