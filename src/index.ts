import wk, { WorkerTransfer } from './node-worker';

export type Context = [string, Array<string | [string, unknown]>, unknown[]];
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

const setExists = typeof Set != 'undefined';
const mapExists = typeof Map != 'undefined';

if (setExists && !Set.prototype.values) wk.c.push(Set);
if (mapExists && !Map.prototype.entries) wk.c.push(Map);
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

const bannedFunctionKeys = getAllPropertyKeys(Function.prototype).concat(
  'prototype'
);

const toReplace = '/*r*/null';
const toReplaceRE = /\/\*r\*\/null/g;

const renderCtx = (
  ctx: (string | number | symbol)[],
  ab: WorkerTransfer[],
  m: SymbolMap
) => {
  let out = 'self';
  for (const key of ctx) {
    out += `[${encoder[typeof key as 'string' | 'number' | 'symbol'](
      key as never,
      ab,
      m
    )}]`;
  }
  return out;
};

const vDescriptors = (
  v: unknown,
  keys: (string | symbol)[],
  ab: WorkerTransfer[],
  m: SymbolMap,
  g: GetGBN,
  s: SetGBN,
  ctx: (string | symbol | number)[],
  dat: Array<string | [string, unknown]>
) => {
  let out = '';
  const renderedCtx = renderCtx(ctx, ab, m);
  for (const t of keys) {
    const {
      enumerable,
      configurable,
      get,
      set,
      writable,
      value
    } = Object.getOwnPropertyDescriptor(v, t);
    const keyEnc = encoder[typeof t as 'string' | 'symbol'](t as never, ab, m);
    let desc = '{',
      res: string;
    const enc =
      typeof writable == 'boolean' &&
      encoder[typeof value](value as never, ab, m, g, s, ctx.concat(t), dat);
    const replaced = enc == toReplace;
    let obj = 'v';
    if (replaced) {
      obj = renderedCtx;
      dat.pop();
    }
    if (enc) {
      if (writable && configurable && enumerable)
        res = `${obj}[${keyEnc}]=${enc}`;
      else desc += `writable:${writable},value:${enc}`;
    } else
      desc += `get:${
        get ? encoder.function(get, ab, m, g, s, ctx, dat) : 'void 0'
      },set:${set ? encoder.function(set, ab, m, g, s, ctx, dat) : 'void 0'}`;
    if (!res) {
      desc += `,enumerable:${enumerable},configurable:${configurable}}`;
      res = `Object.defineProperty(${obj}, ${encoder[
        typeof t as 'string' | 'symbol'
      ](t as never, ab, m)}, ${desc})`;
    }
    if (replaced) dat.push([`${res};`, value]);
    else out += `;${res}`;
  }
  if (Object.isSealed(v)) dat.push(`Object.seal(${renderedCtx});`);
  if (!Object.isExtensible(v))
    dat.push(`Object.preventExtensions(${renderedCtx});`);
  if (Object.isFrozen(v)) dat.push(`Object.freeze(${renderedCtx});`);
  return out;
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
    gbn = m[v] = rand();
    return `(self[${gbn}]=Symbol(${encoder.string(
      v.toString().slice(7, -1)
    )}))`;
  },
  function: (
    v: Function,
    ab: WorkerTransfer[],
    m: SymbolMap,
    g: GetGBN,
    s: SetGBN,
    ctx: (string | symbol | number)[],
    dat: Array<string | [string, unknown]>
  ) => {
    let st = v.toString();
    const proto = v.prototype;
    if (st.indexOf('[native code]', 12) != -1) return v.name;
    if (st[0] != '(' && !proto) {
      const headMatch = st.match(/^(.+?)(?=\()/g);
      if (headMatch) st = 'function' + st.slice(headMatch[0].length);
      else throw new TypeError(`failed to find function body in ${st}`);
    }
    const vd = vDescriptors(
      v,
      getAllPropertyKeys(v).filter(
        key => bannedFunctionKeys.indexOf(key) == -1
      ),
      ab,
      m,
      g,
      s,
      ctx,
      dat
    );
    const gbn = g(v);
    if (gbn) return `(function(){var v=${gbn}${vd};return v})()`;
    if (proto) {
      const superCtr = Object.getPrototypeOf(proto).constructor;
      // TODO: Avoid duplicating methods for ES6 classes
      const base = '(function(){';
      if (superCtr == Object) st = `${base}var v=${st}`;
      else {
        const superEnc = encoder.function(
          superCtr,
          ab,
          m,
          g,
          s,
          ctx.concat('prototype'),
          dat
        );
        if (st[0] == 'c') {
          const superName = st.match(
            /(?<=^class(.*?)extends(.*?)(\s+))(.+?)(?=(\s*){)/g
          );
          if (!superName)
            throw new TypeError(`failed to find superclass in ${st}`);
          st = `${base}var ${superName[0]}=${superEnc};var v=${st}`;
        } else st = `${base}var v=${st};v.prototype=Object.create(${superEnc})`;
      }
      for (const t of getAllPropertyKeys(proto)) {
        const val = proto[t];
        if (t != 'constructor') {
          const key = encoder[typeof t as 'string' | 'symbol'](
            t as never,
            ab,
            m
          );
          st += `;v.prototype[${key}]=${encoder[typeof val](
            val as never,
            ab,
            m,
            g,
            s,
            ctx.concat('prototype', key),
            dat
          )}`;
        }
      }
      st += `${vd};return v})()`;
    } else if (vd.length) st = `(function(){var v=${st}${vd};return v})()`;
    return s(v, st);
  },
  object: (
    v: object,
    ab: WorkerTransfer[],
    m: SymbolMap,
    g: GetGBN,
    s: SetGBN,
    ctx: (string | symbol | number)[],
    dat: Array<string | [string, unknown]>
  ) => {
    if (v == null) return 'null';
    const proto = Object.getPrototypeOf(v),
      ctr = proto.constructor;
    let cln = 0;
    if (abvList.indexOf(ctr) != -1) cln = ab.push((v as Uint8Array).buffer);
    else if (wk.t.indexOf(ctr) != -1) cln = ab.push(v as WorkerTransfer);
    else if (wk.c.indexOf(ctr) != -1) cln = 1;
    if (cln) {
      dat.push([`${renderCtx(ctx, ab, m)}=${toReplace};`, v]);
      return toReplace;
    }
    const gbn = g(v);
    if (gbn) return gbn;
    let out = '(function(){var v=';
    let keys = getAllPropertyKeys(v);
    if (ctr == Object) out += `{}`;
    else if (ctr == Array) {
      let arrStr = '';
      for (let i = 0; i < (v as unknown[]).length; ++i) {
        if (i in v) {
          const val = v[i];
          arrStr += encoder[typeof val](
            val as never,
            ab,
            m,
            g,
            s,
            ctx.concat(i),
            dat
          );
        }
        arrStr += ',';
      }
      keys = keys.filter(k => {
        return isNaN(+(k as string)) && k != 'length';
      });
      out += `[${arrStr.slice(0, -1)}]`;
    } else if (setExists && ctr == Set) {
      let setStr = '';
      let getsSets = '';
      const it = (v as Set<unknown>).values();
      for (let i = 0, v = it.next(); !v.done; ++i, v = it.next()) {
        const dl = dat.length;
        const sn = `__iwinit${i}__`;
        setStr += `${encoder[typeof v.value](
          v.value as never,
          ab,
          m,
          g,
          s,
          ctx.concat(sn),
          dat
        )},`;
        if (dat.length != dl)
          getsSets += `;Object.defineProperty(v,"${sn}",{get:function(){return i[${i}]},set:function(n){v.delete(i[${i}]);v.add(i[${i}]=n)}})`;
      }
      out += `0;var i=[${setStr.slice(0, -1)}];v=new Set(i)${getsSets}`;
    } else if (mapExists && ctr == Map) {
      let mapStr = '';
      let getsSets = '';
      const it = (v as Map<unknown, unknown>).entries();
      for (let i = 0, v = it.next(); !v.done; ++i, v = it.next()) {
        const [key, val] = v.value;
        const dl = dat.length;
        const sn = `__iwinit${i}__`;
        mapStr += `[${encoder[typeof key](
          key as never,
          ab,
          m,
          g,
          s,
          ctx.concat(sn, 0),
          dat
        )},${encoder[typeof val](
          val as never,
          ab,
          m,
          g,
          s,
          ctx.concat(sn, 1),
          dat
        )}],`;
        if (dat.length != dl)
          getsSets += `;Object.defineProperty(v,"${sn}",{value:{get 0(){return i[${i}][0]},set 0(n){v.delete(i[${i}][0]);v.set(i[${i}][0]=n,i[${i}][1])},get 1(){return i[${i}][1]},set 1(n){v.set(i[${i}][0],i[${i}][1]=n)}}})`;
      }
      out += `0;var i=[${mapStr.slice(0, -1)}];v=new Map(i)${getsSets}`;
    } else if (ctr == Date) out += `new Date(${(v as Date).getTime()})`;
    else
      out += `Object.create(${encoder.function(
        ctr,
        ab,
        m,
        g,
        s,
        ctx.concat('constructor'),
        dat
      )}.prototype)`;
    return out + vDescriptors(v, keys, ab, m, g, s, ctx, dat) + ';return v})()';
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
  const dat: Array<string | [string, unknown]> = [];
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
    const v = encoder[typeof value](
      value as never,
      ab,
      symMap,
      getGBN,
      setGBN,
      [key],
      dat
    );
    const parts = key
      .replace(/\\/, '')
      .match(/^(.*?)(?=(\.|\[|$))|\[(.*?)\]|(\.(.*?))(?=(\.|\[|$))/g);
    let pfx = 'self.' + parts[0];
    let chain = pfx;
    for (let i = 1; i < parts.length; ++i) {
      chain = `(${chain}||(${pfx}={}))${parts[i]}`;
      pfx += parts[i];
    }
    out += `${chain}=${v};`;
  }
  return [out, dat, ab];
}

const findTransferables = (vals: unknown[]) =>
  vals.reduce<WorkerTransfer[]>((a, v) => {
    const proto = Object.getPrototypeOf(v),
      ctr = proto.constructor;
    if (abvList.indexOf(ctr) != -1) {
      a.push((v as Uint8Array).buffer);
    } else if (wk.t.indexOf(ctr) != -1) {
      a.push(v as WorkerTransfer);
    }
    return a;
  }, []);

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

const globalEnv =
  typeof globalThis == 'undefined'
    ? typeof window == 'undefined'
      ? typeof self == 'undefined'
        ? typeof global == 'undefined'
          ? {}
          : global
        : self
      : window
    : globalThis;

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
  const [str, exec, tfl] = createContext(deps);
  let currentCb: (err: Error, res: unknown) => void;
  let runCount = 0;
  let callCount = 0;
  let assignStr = '';
  const transfer = (replaceTransfer
    ? replaceTransfer instanceof Array
      ? replaceTransfer
      : []
    : tfl) as WorkerTransfer[];
  const msg: unknown[] = [];
  for (let cmd of exec) {
    if (typeof cmd != 'string') {
      cmd = cmd[0].replace(toReplaceRE, `e.data[${msg.push(cmd[1]) - 1}]`);
    }
    assignStr += cmd;
  }
  if (!replaceTransfer) {
    const tfKey = typeof Symbol == 'undefined' ? `__iwtf${rand()}__` : Symbol();
    for (let i = 0; i < transfer.length; ++i) {
      const buf = transfer[i];
      if (buf[tfKey]) transfer.splice(i--, 1);
      buf[tfKey] = 1;
    }
  }
  const worker = wk(
    `${str};onmessage=function(e){${assignStr}var v=${fn};var _p=function(d){d?typeof d.then=='function'?d.then(_p,_e):postMessage(d,d.__transfer):postMessage(d)};var _e=function(e){!(e instanceof Error)&&(e=new Error(e));postMessage({__iwerr__:{s:e.stack,m:e.message,n:e.name}})};onmessage=function(e){try{_p(v.apply(self,e.data))}catch(e){_e(e)}}}`,
    msg,
    transfer,
    (err, res) => {
      ++runCount;
      const rtErr =
        res &&
        (res as { __iwerr__?: { n: string; s: string; m: string } }).__iwerr__;
      if (rtErr) {
        err = new (globalEnv[rtErr.n] || Error)();
        err.message = rtErr.m;
        err.name = rtErr.n;
        err.stack = rtErr.s;
        currentCb(err, null);
      } else if (err) {
        for (; runCount <= callCount; ++runCount) currentCb(err, res);
        wfn.close();
      } else currentCb(err, res);
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
