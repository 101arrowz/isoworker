const wk = (
  c: string,
  msg: unknown,
  transfer: Transferable[],
  cb: (err: Error, res: unknown) => unknown
): Worker => {
  let w: Worker;
  try {
    const url = URL.createObjectURL(new Blob([c], { type: 'text/javascript' }));
    w = new Worker(url);
    URL.revokeObjectURL(url);
  } catch (e) {
    w = new Worker('data:application/javascript;charset=UTF-8,' + encodeURI(c));
  }
  w.postMessage(msg, transfer);
  w.addEventListener('message', ev => cb(null, ev.data));
  w.addEventListener('error', ev => cb(ev.error, null));
  return w;
};
export type WorkerTransfer = Transferable;
wk.t = [ArrayBuffer, MessagePort] as Function[];
wk.c = [Date, Blob, File, FileList, ImageData] as Function[];
if (typeof Map != 'undefined') wk.c.push(Map);
if (typeof Set != 'undefined') wk.c.push(Set);
if (typeof ImageBitmap != 'undefined') wk.t.push(ImageBitmap);
if (typeof OffscreenCanvas != 'undefined') wk.t.push(OffscreenCanvas);

export default wk;
