import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
const extraneousExports = /exports\.(.*) = void 0;\n/;
const libDir = join(__dirname, '..', 'lib');
const libIndex = join(libDir, 'index.js');
const lib = readFileSync(libIndex, 'utf-8').replace(extraneousExports, '');

writeFileSync(libIndex, lib);
const esmDir = join(__dirname, '..', 'esm');
const esmIndex = join(esmDir, 'index.js'),
      esmWK = join(esmDir, 'worker.js'),
      esmNWK = join(esmDir, 'node-worker.js');
const esm = readFileSync(esmIndex, 'utf-8');
const wk = readFileSync(esmWK, 'utf-8'),
      nwk = readFileSync(esmNWK, 'utf-8');
unlinkSync(esmIndex), unlinkSync(esmWK), unlinkSync(esmNWK);
unlinkSync(join(libDir, 'worker.d.ts')), unlinkSync(join(libDir, 'node-worker.d.ts'));
const workerImport = /import (.*) from '\.\/node-worker';/;
const workerRequire = /var (.*) = require\("\.\/node-worker"\);/;
const defaultExport = /export default/;
const fullDefaultExport = /export default (.*)\n/;
writeFileSync(join(esmDir, 'index.mjs'), esm.replace(workerImport, nwk.replace(fullDefaultExport, '')));
writeFileSync(join(esmDir, 'browser.js'), esm.replace(workerImport, wk.replace(fullDefaultExport, '')));
writeFileSync(join(libDir, 'node.js'), lib.replace(workerRequire, name => nwk.replace(defaultExport, `var ${name.slice(4, name.indexOf(' ', 5))} =`)));
writeFileSync(join(libDir, 'browser.js'), lib.replace(workerRequire, name => wk.replace(defaultExport, `var ${name.slice(4, name.indexOf(' ', 5))} =`)));