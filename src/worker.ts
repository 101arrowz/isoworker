import { MessagePort } from 'worker_threads';

export default (
  c: string,
  msg: unknown,
  transfer: Transferable[],
  cb: (err: Error, res: unknown) => unknown
) => {
  const u = URL.createObjectURL(new Blob([c], { type: 'text/javascript' }));
  const w = new Worker(u);
  w.postMessage(msg, transfer);
  w.addEventListener('message', ev => cb(null, ev.data));
  w.addEventListener('error', ev => cb(ev.error, null));
  return w;
};
export type WorkerTransfer = Transferable;
export const transferables: Function[] = [ArrayBuffer, MessagePort];
if (typeof ImageBitmap != 'undefined') transferables.push(ImageBitmap);
if (typeof OffscreenCanvas != 'undefined') transferables.push(OffscreenCanvas);
