import wk from './node-worker';

type Context = [string, unknown, ArrayBuffer[]];
type DepList = () => unknown[];

const fnName = (f: Function) => {
  if (f.name) return f.name;
  const ts = f.toString();
  return ts.slice(8, ts.indexOf('(', 8));
};

const getAllPropertyKeys = (o: object) => {
  let keys: (string | symbol)[] = Object.getOwnPropertyNames(o);
  if (Object.getOwnPropertySymbols) {
    keys = keys.concat(Object.getOwnPropertySymbols(o));
  }
  return keys;
};

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
  function: (v: Function, reg: Record<string, boolean>) => {
    let st = v.toString();
    if (v.prototype) {
      // for global objects
      if (st.indexOf('[native code]', 12) != -1)
        st = st.slice(9, st.indexOf('(', 10));
      else {
        const nm = fnName(v);
        if (nm) {
          if (nm in reg) return '';
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
              )}]=${encoder[typeof val](val as never, reg)}`;
            }
          }
          st += ';return v})()';
        }
      }
    }
    return st;
  },
  object: (v: object, reg: Record<string, boolean>) => {
    if (v == null) return 'null';
    let out = '';
    out += `(function(){`;
    let classDecl = '';
    for (
      let i = 0, l = Object.getPrototypeOf(v);
      l.constructor != Object;
      l = Object.getPrototypeOf(l), ++i
    ) {
      const cls = l.constructor;
      const nm = fnName(cls) || '_cls' + i;
      if (nm in reg) continue;
      const enc = encoder.function(cls, reg);
      if (enc != nm) {
        reg[nm] = true;
        classDecl = `self[${encoder.string(nm)}]=${enc};` + classDecl;
      }
    }
    out +=
      classDecl +
      `var v=Object.create(self[${encoder.string(
        fnName(v.constructor) || '_cls0'
      )}].prototype);`;
    for (const t of getAllPropertyKeys(v)) {
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
          reg
        )}`;
      } else {
        desc += `get:${get ? encoder.function(get, reg) : 'void 0'},${
          set ? encoder.function(set, reg) : 'void 0'
        }`;
      }
      desc += `,enumerable:${enumerable},configurable:${configurable}}`;
      out += `Object.defineProperty(v, ${encoder[typeof t](
        t as never,
        reg
      )}, ${desc});`;
    }
    return out + 'return v})()';
  },
  boolean: (v: boolean) => v.toString(),
  number: (v: number) => v.toString()
};

export function createContext(depList: DepList) {
  const depListStr = depList.toString();
  const depNames = depListStr
    .slice(depListStr.indexOf('[') + 1, depListStr.lastIndexOf(']'))
    .replace(/\s/g, '')
    .split(',');
  const depValues = depList();
  let out = '';
  const reg: Record<string, boolean> = {};
  for (let i = 0; i < depValues.length; ++i) {
    const key = depNames[i],
      value = depValues[i];
    out += `self[${encoder.string(key)}]=${encoder[typeof value](
      value as never,
      reg
    )};`;
  }
  return out;
}
