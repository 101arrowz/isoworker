# isoworker

Isomorphic workerization with context in 6kB

## Why?

Worker threads allow you to run code without blocking the event loop or slowing down your browser. They can be used for hard number-crunching, running WASM without freezing the browser, parallel processing, and many more cool possibilities.

If you're not experienced with build tools or are creating a library, however, using worker threads is virtually impossible. Nothing works on all platforms, with all build tools, and doesn't require embedding the codebase as a string. Moreover, it's not possible to transfer data, particularly complex classes and objects, to the worker thread without using JSON. That's why most "asynchronous" packages such as [JSZip](https://github.com/Stuk/jszip) still run on the main thread in an event loop. While running in the event loop is fine, it doesn't allow your code to take advantage of the multiple CPU cores that exist on most devices; everything still runs on one thread.

In just 6kB of pure JavaScript (3kB gzipped), `isoworker` abstracts all these difficulties away by making your standard functions magically run in a separate thread in all environments. You don't even need a new file to run your code, and unlike other workerization packages, you can actually call other functions and use variables from your worker. The serializer is the heart of the package;

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
const runWasmMainThread = async (wasmName, method, ...args) => {
  // The wasm object acts as a cache for WASM files
  if (!wasm[wasmName]) {
    wasm[wasmName] = (await WebAssembly.instantiateStreaming(
      fetch(`/wasm-files/${wasmName}.wasm`)
    )).module.exports;
  }
  return wasm[wasmName][method](...args);
}
const runWasm = workerize(runWasmMainThread, () => [wasm]);

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
Example2.prototype = Object.create(Example1.prototype);

// Normal extension works as well
class OtherClass extends Example2 {
  constructor() {
    super();
    console.log('Created an OtherClass');
  }

  getResult() {
    return 'z() = ' + this.z();
  }
}

const dat = new OtherClass(); // Created an OtherClass

const getZ = workerize(() => {
  // On the worker thread, now dat.y is increased by dat.x
  dat.y += dat.x;
  return dat.getResult();
}, () => [dat]);


// Note than when doing this, "Created an OtherClass" is not logged
// Your classes and objects are created without construction or mutation

getZ((err, result) => console.log(result)) // z() = 10
getZ((err, result) => console.log(result)) // z() = 16

// Nothing changed on the main thread
console.log(dat.y) // 2
console.log(dat.getResult()); // z() = 4
```

If you need to maximize performance and know how to use [Transferables](https://developer.mozilla.org/en-US/docs/Web/API/Transferable), you can set a list of transferables by returning `__transfer` in your workerized function.

```js
// Since Uint8Array and Math.random() are in the global environment,
// they don't need to be added to the dependency list
const getRandomBuffer = workerize((bufLen) => {
  if (bufLen > 2 ** 30) {
    throw new TypeError('cannot create over 1GB random values');
  }
  const buf = new Uint8Array(bufLen);
  for (let i = 0; i < bufLen; ++i) {
    // Uint8Array automatically takes the floor
    buf[i] = Math.random() * 256;
  }
  buf.__transfer = [buf.buffer];
  return buf;
}, () => []);
getRandomBuffer(2 ** 28, (err, result) => {
  console.log(err); // null
  console.log(result); // Uint8Array(268435456) [ ... ]
});
getRandomBuffer(2 ** 31, (err, result) => {
  console.log(err); // TypeError: cannot process over 1GB
  console.log(result); // null
});
```

If you're a library author, you may want to use the context creation API but don't need the workerization support. In that case, use `createContext(() => [dep1, dep2])` and use the return value `[code, initMessage, transferList]`. Take a look at the source code to understand how to use these. Effectively, `code` encodes most of the dependencies, `initMessage` contains code to be executed on the first message (and occasionally values that must be passed to that code), and `transferList` is the array of `Transferable`s that can optionally be transferred in the initialization message for much better initialization performance at the cost of breaking the implementation on the main thread if it depends on values that were transferred.

## Possible Pitfalls

One important issue to note is that `isoworker` does NOT serialize the data passed into and out of your functions by default, meaning that custom classes and objects cannot be used as parameters or return values. If you want to use complex arguments, you can use `true` as the third parameter to the `workerize` function.

```js
class CustomClass {
  static Y = 10;
  x = 1;
  constructor(y = 2) {
    this.y = y;
  }
  getX() {
    return this.x;
  }
}

// The dependency list can be [CustomClass] or [CustomClass.Y]
// With [CustomClass.Y], the worker may initialize more quickly.
const diffStaticYWithXY = workerize(obj => {
  return CustomClass.Y - obj.getX() * obj.y;
}, () => [CustomClass.Y], true); // <-- third argument is true

// Now, custom classes work in arguments
diffStaticYWithXY(new CustomClass(), (err, res) => {
  console.log(res); // 8
});

const cc2 = new CustomClass(3);
cc2.x = 4;
diffStaticYWithXY(cc2, (err, res) => {
  console.log(res); // -2
});
```

This isn't the default behavior because it's expensive performance-wise and because dynamic evaluation can break on sites with a tight Content Security Protocol. In addition, note that the return value may never be something that cannot be structured-cloned (besides `Promise`, which is automatically resolved).

Although `isoworker` can handle most dependencies, including objects of user-created classes, certain native classes and objects will not work. Of course, the basic ones (primitives, dates, objects, arrays, sets, maps, etc.) work well, but more advanced types such as `MediaRecorder` and `Audio` cannot be used as dependencies. You'll need to send over information that you used to construct them (for `Audio`, the URL) via function parameters. Additionally, any custom class using a private field (denoted by a `#` prefix, e.g. `#someKey`) will not have access to the private field post-workerization because finding the value for that field at runtime is not possible.

Another point to note is that much of the package is based off of elaborate (but fallible) pseudo-parsers for stringified functions. In other words, if you try to break things, you can. However, as long as you don't do something like this:

```js
const dontDoThis = {
  get ["(please)"] /* function() { */ () {
    console.log('hi')
  }
};
workerize(() => dontDoThis["(please)"], () => [dontDoThis]);
```

you will be fine.

## License
MIT