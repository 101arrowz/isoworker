// Mediocre shim
import { TransferListItem, Worker, MessagePort } from 'worker_threads';

const workerAdd =
  "var __wk=require('worker_threads');__wk.parentPort.on('message',function(m){typeof onmessage!='undefined'&&onmessage({data:m})}),postMessage=function(m,t){__wk.parentPort.postMessage(m,t)},close=process.exit;self=global;";

const wk = (
  c: string,
  msg: unknown,
  transfer: TransferListItem[],
  cb: (err: Error, res: unknown) => unknown
): Worker => {
  const w = new Worker(workerAdd + c, { eval: true })
    .on('message', msg => cb(null, msg))
    .on('error', err => cb(err, null));
  w.postMessage(msg, transfer);
  w.terminate = () => {
    return Worker.prototype.terminate.call(w);
  };
  return w;
};
wk.t = [ArrayBuffer, MessagePort] as Function[];
export type WorkerTransfer = TransferListItem;
export default wk;
