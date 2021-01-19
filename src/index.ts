import wk, { WorkerTransfer } from './node-worker';

export type Registry = Record<string, boolean>;
export type Context = [
  string,
  Record<string, unknown>,
  WorkerTransfer[],
  Registry
];
export type DepList = () => unknown[];

const fnName = (f: Function) => {
  if (f.name) return f.name;
  const ts = f.toString();
  const spInd = ts.indexOf(' ', 8) + 1;
  return ts.slice(spInd, ts.indexOf('(', spInd));
};

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

const getAllPropertyKeys = (o: object) => {
  let keys: (string | symbol)[] = Object.getOwnPropertyNames(o);
  if (Object.getOwnPropertySymbols) {
    keys = keys.concat(Object.getOwnPropertySymbols(o));
  }
  return keys;
};

// optional chaining
const chainWrap = (name: string, expr: string, short: string) =>
  `(${expr}||(${short}={}))${name}`;

const encoder = {
  undefined: () => 'void 0',
  bigint: (v: BigInt) => v.toString() + 'n',
  symbol: (v: symbol) => {
    const key = Symbol.keyFor(v);
    return key
      ? `Symbol.for(${encoder.string(key)})`
      : `Symbol(${encoder.string(v.toString().slice(7, -1))})`;
  },
  string: (v: string) => JSON.stringify(v),
  function: (v: Function, reg: Registry, ab: WorkerTransfer[]) => {
    let st = v.toString();
    if (st.indexOf('[native code]', 12) != -1) st = fnName(v);
    else if (v.prototype) {
      const nm = fnName(v);
      if (nm) {
        if (nm in reg) return `self[${encoder.string(fnName(v))}]`;
        reg[nm] = true;
      }
      if (st[0] != 'c') {
        // Not an ES6 class; must iterate across the properties
        // Ignore superclass properties, assume superclass is handled elsewhere
        st = '(function(){var v=' + st;
        for (const t of getAllPropertyKeys(v.prototype)) {
          const val = v.prototype[t];
          if (t != 'constructor') {
            st += `;v[${encoder[typeof t as 'string' | 'symbol'](
              t as never
            )}]=${encoder[typeof val](val as never, reg, ab)}`;
          }
        }
        st += ';return v})()';
      }
    }
    return st;
  },
  object: (v: object, reg: Registry, ab: WorkerTransfer[]) => {
    if (v == null) return 'null';
    const proto = Object.getPrototypeOf(v);
    if (abvList.indexOf(proto.constructor) != -1) {
      ab.push((v as Uint8Array).buffer);
      return v;
    } else if (wk.t.indexOf(proto.constructor) != -1) {
      ab.push(v as WorkerTransfer);
      return v;
    }
    let out = '';
    out += `(function(){`;
    let classDecl = '';
    for (
      let i = 0, l = proto;
      l.constructor != Object;
      l = Object.getPrototypeOf(l), ++i
    ) {
      const cls = l.constructor;
      const nm = fnName(cls) || '_cls' + i;
      if (nm in reg) continue;
      const enc = encoder.function(cls, reg, ab);
      if (enc == nm) {
        break;
      } else {
        reg[nm] = true;
        classDecl = `self[${encoder.string(nm)}]=${enc};` + classDecl;
      }
    }
    let keys = getAllPropertyKeys(v);
    if (proto.constructor == Array) {
      let arrStr = '';
      for (let i = 0; i < (v as unknown[]).length; ++i) {
        if (i in v) {
          const val = v[i];
          arrStr += encoder[typeof val](val as never, reg, ab);
        }
        arrStr += ',';
      }
      keys = keys.filter(k => {
        return isNaN(+(k as string)) && k != 'length';
      });
      out += `var v=[${arrStr.slice(0, -1)}]`;
    } else {
      out +=
        classDecl +
        `var v=Object.create(self[${encoder.string(
          fnName(proto.constructor) || '_cls0'
        )}].prototype);`;
    }

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
          reg,
          ab
        )}`;
      } else {
        desc += `get:${get ? encoder.function(get, reg, ab) : 'void 0'},${
          set ? encoder.function(set, reg, ab) : 'void 0'
        }`;
      }
      desc += `,enumerable:${enumerable},configurable:${configurable}}`;
      out += `Object.defineProperty(v, ${encoder[
        typeof t as 'string' | 'symbol'
      ](t as never)}, ${desc});`;
    }
    return out + 'return v})()';
  },
  boolean: (v: boolean) => v.toString(),
  number: (v: number) => v.toString()
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
  const reg: Registry = {};
  const dat: Record<string, unknown> = {};
  const ab: WorkerTransfer[] = [];
  for (let i = 0; i < depValues.length; ++i) {
    const key = depNames[i],
      value = depValues[i];
    const parts = key
      .replace(/\\/, '')
      .match(/^(.*?)(?=(\.|\[|$))|\[(.*?)\]|(\.(.*?))(?=(\.|\[|$))/g);
    const v = encoder[typeof value](value as never, reg, ab);
    if (typeof v == 'string') {
      let pfx = 'self.' + parts[0];
      let chain = pfx;
      for (let i = 1; i < parts.length; ++i) {
        chain = chainWrap(parts[i], chain, pfx);
        pfx += parts[i];
      }
      out += `${chain}=${v};`;
    } else {
      // TODO: overwrite instead of assign
      let obj = dat;
      for (let i = 0; i < parts.length - 1; ++i) {
        obj = obj[parts[i]] = {};
      }
      obj[parts[parts.length - 1]] = v;
    }
  }
  return [out, dat, ab, reg];
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
 * Converts a function with dependencies into a worker
 * @param fn The function to workerize
 * @param deps The dependencies to add. This should include sub-dependencies.
 *             For example, if you are workerizing a function that calls
 *             another function, put any dependencies of the other function
 *             here as well.
 * @returns A function that accepts parameters and, as the last argument, a
 *          callback to use when the worker returns.
 */
export function workerize<TA extends unknown[], TR>(
  fn: (...args: TA) => TR,
  deps: DepList
): (...args: [...TA, (err: Error, res: TR) => unknown]) => void {
  const [str, msg, tfl, reg] = createContext(deps);
  let currentCb: (err: Error, res: unknown) => void;
  let runCnt = 0;
  const lifetimeCb = (err: Error, res: unknown) => {
    --runCnt;
    currentCb(err, res);
  };
  const worker = wk(
    `${str};onmessage=function(e){for(var k in e.data){self[k]=e.data[k]}var h=${encoder.function(
      fn,
      reg,
      tfl
    )};var _p=function(d){d?typeof d.then=='function'?d.then(_p):d.__transfer?postMessage(d.data,d.__transfer):postMessage(d):postMessage(d)};onmessage=function(e){_p(h.apply(self,e.data))}}`,
    msg,
    tfl,
    lifetimeCb
  );
  return (...args: [...TA, (err: Error, res: TR) => unknown]) => {
    const cb = args.pop() as (err: Error, res: TR) => unknown;
    if (typeof cb != 'function') throw new TypeError('no callback provided');
    const lastCb = currentCb;
    const startCnt = runCnt++;
    currentCb = (err, r) => {
      if (runCnt == startCnt) cb(err, r as TR);
      else lastCb(err, r);
    };
    worker.postMessage(args, findTransferables(args));
  };
}
