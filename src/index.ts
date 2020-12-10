import wk from './node-worker';

type Context = [string, unknown, ArrayBuffer[]];
type DepList = () => unknown[];

const fnName = (f: Function, i: number) => {
  if (f.name) return f.name;
  const ts = f.toString();
  return ts.slice(8, ts.indexOf('(', 8)) || '_cls' + i;
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
  function: (v: Function) => {
    let st = v.toString();
    if (v.prototype) {
      // for global objects
      if (st.indexOf('[native code]', 12) != -1)
        st = st.slice(9, st.indexOf('(', 10));
      else if (st[0] != 'c') {
        // Not an ES6 class; must iterate across the properties
        // Ignore superclass properties, assume superclass is handled elsewhere
        st = '(function(){var v=' + st;
        for (const t of getAllPropertyKeys(v.prototype)) {
          const val = v.prototype[t];
          if (t != 'constructor') {
            st += `;v[${encoder[typeof t](t as never)}]=${encoder[typeof val](
              val as never
            )}`;
          }
        }
        st += ';return v})()';
      }
    }
    return st;
  },
  object: (v: object) => {
    if (v == null) return 'null';
    let out = '';
    out += `(function(){`;
    for (
      let i = 0, l = v;
      l.constructor != Object;
      l = Object.getPrototypeOf(l), ++i
    ) {
      const cls = l.constructor;
      const nm = fnName(cls, i);
      const enc = encoder.function(cls);
      if (enc != nm) {
        out += `self[${encoder.string(nm)}]=${enc};`;
      }
    }
    out += `var v=Object.create(self[${encoder.string(
      fnName(v.constructor, 0)
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
          value as never
        )}`;
      } else {
        desc += `get:${get ? encoder.function(get) : 'void 0'},${
          set ? encoder.function(set) : 'void 0'
        }`;
      }
      desc += `,enumerable:${enumerable},configurable:${configurable}}`;
      out += `Object.defineProperty(v, ${encoder[typeof t](
        t as never
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
  for (let i = 0; i < depValues.length; ++i) {
    const key = depNames[i],
      value = depValues[i];
    out += `self[${encoder.string(key)}]=${encoder[typeof value](
      value as never
    )};`;
  }
  return out;
}
