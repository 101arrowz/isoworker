import wk, { WorkerTransfer } from './node-worker';

export type Context = [string, Record<string, unknown>, unknown[]];
export type DepList = () => unknown[];

const abvList: Function[] = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Float32Array,
  Float64Array
];

if (typeof BigInt64Array != 'undefined') abvList.push(BigInt64Array);
if (typeof BigUint64Array != 'undefined') abvList.push(BigUint64Array);

const rand = () => Math.ceil(Math.random() * 1073741823);

const getAllPropertyKeys = (o: object) => {
  let keys: (string | symbol)[] = Object.getOwnPropertyNames(o);
  if (Object.getOwnPropertySymbols) {
    keys = keys.concat(Object.getOwnPropertySymbols(o));
  }
  return keys;
};

type GetGBN = (v: unknown) => string;
type SetGBN = (v: unknown, w: string) => string;

type SymbolMap = Record<symbol, string>;

const encoder = {
  undefined: () => 'void 0',
  bigint: (v: BigInt) => v + 'n',
  string: (v: string) => JSON.stringify(v),
  boolean: (v: boolean) => v + '',
  number: (v: number) => v + '',
  symbol: (v: symbol, _: unknown, m: SymbolMap) => {
    const key = Symbol.keyFor(v);
    if (key) return `Symbol.for(${encoder.string(key)})`;
    let gbn = m[v];
    if (gbn) return `self[${gbn}]`;
    gbn = m[v] = Math.ceil(Math.random() * 1073741823);
    return `(self[${gbn}]=Symbol(${encoder.string(
      v.toString().slice(7, -1)
    )}))`;
  },
  function: (
    v: Function,
    ab: WorkerTransfer[],
    m: SymbolMap,
    g: GetGBN,
    s: SetGBN
  ) => {
    const gbn = g(v);
    if (gbn) return gbn;
    let st = v.toString();
    if (st.indexOf('[native code]', 12) != -1) return v.name;
    if (v.prototype) {
      const proto = v.prototype;
      const superCtr = Object.getPrototypeOf(proto).constructor;
      // TODO: Avoid duplicating methods for ES6 classes
      st = `(function(){var v=${st};${
        superCtr == Object
          ? ''
          : `v.prototype=Object.create(${encoder.function(
              superCtr,
              ab,
              m,
              g,
              s
            )});`
      }`;
      for (const t of getAllPropertyKeys(proto)) {
        const val = proto[t];
        if (t != 'constructor') {
          st += `v.prototype[${encoder[typeof t as 'string' | 'symbol'](
            t as never,
            ab,
            m
          )}]=${encoder[typeof val](val as never, ab, m, g, s)};`;
        }
      }
      st += 'return v})()';
    }
    return s(v, st);
  },
  object: (
    v: object,
    ab: WorkerTransfer[],
    m: SymbolMap,
    g: GetGBN,
    s: SetGBN
  ) => {
    if (v == null) return 'null';
    const gbn = g(v);
    if (gbn) return gbn;
    const proto = Object.getPrototypeOf(v);
    if (abvList.indexOf(proto.constructor) != -1) {
      ab.push((v as Uint8Array).buffer);
      return v;
    } else if (wk.t.indexOf(proto.constructor) != -1) {
      ab.push(v as WorkerTransfer);
      return v;
    }
    let out = '(function(){var v=';
    let keys = getAllPropertyKeys(v);
    if (proto.constructor == Object) out += `{};`;
    else if (proto.constructor == Array) {
      let arrStr = '';
      for (let i = 0; i < (v as unknown[]).length; ++i) {
        if (i in v) {
          const val = v[i];
          arrStr += encoder[typeof val](val as never, ab, m, g, s);
        }
        arrStr += ',';
      }
      keys = keys.filter(k => {
        return isNaN(+(k as string)) && k != 'length';
      });
      out += `[${arrStr.slice(0, -1)}]`;
    } else
      out += `Object.create(${encoder.function(
        proto.constructor,
        ab,
        m,
        g,
        s
      )}.prototype)`;

    for (const t of keys) {
      const {
        enumerable,
        configurable,
        get,
        set,
        writable,
        value
      } = Object.getOwnPropertyDescriptor(v, t);
      let desc = '{';
      if (typeof writable == 'boolean') {
        desc += `writable:${writable},value:${encoder[typeof value](
          value as never,
          ab,
          m,
          g,
          s
        )}`;
      } else desc += `get:${get || 'void 0'},set:${set || 'void 0'}`;
      desc += `,enumerable:${enumerable},configurable:${configurable}}`;
      out += `;Object.defineProperty(v, ${encoder[
        typeof t as 'string' | 'symbol'
      ](t as never, ab, m)}, ${desc})`;
    }
    return out + ';return v})()';
  }
};

/**
 * Creates a context for a worker execution environment
 * @param depList The dependencies in the worker environment
 * @returns An environment that can be built to a Worker. Note the fourth
 * element of the tuple, the global element registry, is currently not useful.
 */
export function createContext(depList: DepList): Context {
  const depListStr = depList.toString();
  const depNames = depListStr
    .slice(depListStr.indexOf('[') + 1, depListStr.lastIndexOf(']'))
    .replace(/\s/g, '')
    .split(',');
  const depValues = depList();
  let out = '';
  const dat: Record<string, unknown> = {};
  const ab: WorkerTransfer[] = [];
  const symMap: Record<symbol, string> = {};
  const gbnKey = typeof Symbol == 'undefined' ? `__iwgbn${rand()}__` : Symbol();
  const getGBN = (obj: unknown) => {
    const gbn: string = obj[gbnKey];
    if (gbn) return `self[${gbn}]`;
  };
  const setGBN = (obj: unknown, wrap: string) => {
    const gbn = rand();
    Object.defineProperty(obj, gbnKey, {
      value: gbn
    });
    return `(self[${gbn}]=${wrap})`;
  };
  for (let i = 0; i < depValues.length; ++i) {
    const key = depNames[i],
      value = depValues[i];
    const v = encoder[typeof value](value as never, ab, symMap, getGBN, setGBN);
    const parts = key
      .replace(/\\/, '')
      .match(/^(.*?)(?=(\.|\[|$))|\[(.*?)\]|(\.(.*?))(?=(\.|\[|$))/g);
    let pfx = 'self.' + parts[0];
    let chain = pfx;
    for (let i = 1; i < parts.length; ++i) {
      chain = `(${chain}||(${pfx}={}))${parts[i]}`;
      pfx += parts[i];
    }
    if (typeof v == 'string') out += `${chain}=${v};`;
    else dat[chain] = v;
  }
  return [out, dat, ab];
}

const findTransferables = (vals: unknown[]) =>
  vals.reduce((a: WorkerTransfer[], v) => {
    const proto = Object.getPrototypeOf(v);
    if (abvList.indexOf(proto.constructor) != -1) {
      a.push((v as Uint8Array).buffer);
    } else if (wk.t.indexOf(proto.constructor) != -1) {
      a.push(v as WorkerTransfer);
    }
    return a;
  }, []) as WorkerTransfer[];

/**
 * A workerized function (from arguments and return type)
 */
export type Workerized<A extends unknown[], R> = ((
  ...args: [...A, (err: Error, res: R) => unknown]
) => void) & {
  /**
   * Kills the worker associated with this workerized function.
   * Subsequent calls will fail.
   */
  close(): void;
};

/**
 * Converts a function with dependencies into a worker
 * @param fn The function to workerize
 * @param deps The dependencies to add. This should include sub-dependencies.
 *             For example, if you are workerizing a function that calls
 *             another function, put any dependencies of the other function
 *             here as well.
 * @param replaceTransfer The list of objects to replace the default transfer
 *                        list with. If you provide an array of transferable
 *                        items, they will be used; if you provide the value
 *                        `true`, `isoworker` will refrain from the default
 *                        behavior of automatically transferring everything
 *                        it can.
 * @returns A function that accepts parameters and, as the last argument, a
 *          callback to use when the worker returns.
 */
export function workerize<TA extends unknown[], TR>(
  fn: (...args: TA) => TR,
  deps: DepList,
  replaceTransfer?: unknown[] | boolean
): Workerized<TA, TR> {
  const [str, msg, tfl] = createContext(deps);
  let currentCb: (err: Error, res: unknown) => void;
  let runCount = 0;
  let callCount = 0;
  let assignStr = '';
  const transfer = (replaceTransfer
    ? replaceTransfer instanceof Array
      ? replaceTransfer
      : []
    : tfl) as WorkerTransfer[];
  for (const k in msg) assignStr += `self.${k}=e.data[${encoder.string(k)}];`;
  const worker = wk(
    `${str};onmessage=function(e){${assignStr}var h=${fn};var _p=function(d){d?typeof d.then=='function'?d.then(_p):postMessage(d,d.__transfer):postMessage(d)};onmessage=function(e){_p(h.apply(self,e.data))}}`,
    msg,
    transfer,
    (err, res) => {
      ++runCount;
      currentCb(err, res);
    }
  );
  let closed = false;
  const wfn: Workerized<TA, TR> = (...args) => {
    const cb = args.pop() as (err: Error, res: TR) => unknown;
    if (typeof cb != 'function') throw new TypeError('no callback provided');
    if (closed) {
      cb(new Error('worker thread closed'), null);
      return;
    }
    const lastCb = currentCb;
    const startCount = ++callCount;
    currentCb = (err, r) => {
      if (runCount == startCount) cb(err, r as TR);
      else lastCb(err, r);
    };
    worker.postMessage(args, findTransferables(args));
  };
  wfn.close = () => {
    worker.terminate();
    closed = true;
  };
  return wfn;
}
