# isoworker

Isomorphic workerization with context in under 4kB

## Why?

Worker threads allow you to run code without blocking the event loop or slowing down your browser. They can be used for hard number-crunching, running WASM without freezing the browser, parallel processing, and many more cool possibilities.

If you're not experienced with build tools or are creating a library, however, using worker threads is virtually impossible. Nothing works on all platforms, with all build tools, and doesn't require embedding the codebase as a string. That's why most "asynchronous" packages such as [JSZip](https://github.com/Stuk/jszip) still run on the main thread and still hang the browser when doing a lot of work.

This package abstracts all difficulties away by making your standard functions magically run in a separate thread in all environments. You don't even need a new file to run your code, and unlike other workerization packages, you can actually call other functions and use variables from your worker.

A subset of this package is used in [`fflate`](https://github.com/101arrowz/fflate), the fastest compression library for JavaScript. It's been immensely useful for supporting Node.js and browsers as old as IE11 while still offering *true* parallelization potential.

## Usage

Install:
```sh
npm i isoworker # or yarn add isoworker, or pnpm add isoworker
```

Import:
```js
import { workerize } from 'isoworker';
```

If your environment doesn't support ES Modules (e.g. Node.js):
```js
const { workerize }  = require('isoworker');
```

If your environment doesn't support bundling:
```js
// For the browser:
import { workerize } from 'isoworker/esm/browser.js';
// If for some reason the standard ESM import fails on Node:
import { workerize } from 'isoworker/esm/index.mjs';
```

UMD build (for CDN support) coming soon.

And use:
```js
let number = 0;
const count = () => {
  console.log(number);
  return number++;
};

const asyncCount = workerize(
  // The function to workerize
  count,
  // The dependency list, i.e. any variables or functions you want to use
  // You must use a function that returns an array of dependencies
  () => [number]
);

// This function is now asynchronous and accepts a callback
asyncCount((err, result) => {
  console.log(`got ${result} from worker`);
});
// 0
// got 0 from worker
asyncCount(() => {});
// 1

// Since that was run on another thread, the main thread's value hasn't
// been mutated
console.log(number); // 0

// When you're finished using the function, call .close() to free the
// resources used by the worker thread
asyncCount.close();
```

If you want to run setup code, you can use a condition within the function and/or a flag.
```js
const wasm = {};

// generic WASM runner
// Promises are automatically resolved, so using async/await is fine
const runWasmSync = async (wasmName, method, ...args) => {
  if (!wasm[wasmName]) {
    wasm[wasmName] = (await WebAssembly.instantiateStreaming(
      fetch(`/wasm-files/${wasmName}.wasm`)
    )).module.exports;
  }
  return wasm[wasmName][method](...args);
}
const runWasm = workerize(runWasmSync, () => [wasm]);

// If /wasm-files/hello.wasm exports a sayHelloTo method
// that accepts a string argument for who to say hello to:
runWasm('hello', 'sayHelloTo', 'me', (err, res) => {
  console.log(res); // Hello me!
});

// This all runs on a separate thread; WASM is not here
console.log(wasm); // undefined
```

The workerizer supports complex types (including symbols, functions, classes, and instances of those classes) with infinite nesting thanks to a nifty recursive serializer.

```js
// ES5 style class works
function Example1() {
  this.y = 2;
}
Example1.prototype.z = function() {
  return this.y * 2;
}

function Example2() {
  this.x = 3;
  Example1.call(this);
}
// Prototypal inheritance/extension works
Example2.prototype = Object.create(Example2.prototype);

class OtherClass {
  constructor()
}

const dat = new Example2();

const getZ = workerize(() => {
  dat.y **= dat.x;
  // On the worker thread, now dat.y == 8
  return dat.z(); // dat.y * 2 == 16
}, () => [dat]);

getZ(console.log) // 16

// Nothing changed on the main thread
console.log(dat.z()) // 4
```

If you're a library author, you may want to use the context creation API but don't need the workerization support. In that case, use `createContext(() => [dep1, dep2])` and use the return value `[code, ]`

## License
MIT