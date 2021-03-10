import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
const atClass = /\/\*\* \@class \*\//g, pure = '/*#__PURE__*/';
const esModule = /exports.__esModule = true;\n/;
const libDir = join(__dirname, '..', 'lib');
const libIndex = join(libDir, 'index.js');
const lib = readFileSync(libIndex, 'utf-8')
  .replace(atClass, pure)
  .replace(esModule, '')
  .replace(/exports\.(.*) = void 0;\n/, '');

writeFileSync(libIndex, lib);
const esmDir = join(__dirname, '..', 'esm');
const esmIndex = join(esmDir, 'index.js'),
      esmWK = join(esmDir, 'worker.js'),
      esmNWK = join(esmDir, 'node-worker.js'),
      libWK = join(libDir, 'worker.js'),
      libNWK = join(libDir, 'node-worker.js');
const esm = readFileSync(esmIndex, 'utf-8').replace(atClass, pure);
const wk = readFileSync(esmWK, 'utf-8'),
      nwk = readFileSync(esmNWK, 'utf-8');
writeFileSync(join(libDir, 'worker.cjs'), readFileSync(join(libDir, 'worker.js'), 'utf-8').replace(esModule, ''));
writeFileSync(join(libDir, 'node-worker.cjs'), readFileSync(join(libDir, 'node-worker.js'), 'utf-8').replace(esModule, ''));
unlinkSync(esmIndex), unlinkSync(esmWK), unlinkSync(esmNWK), unlinkSync(libIndex), unlinkSync(libWK), unlinkSync(libNWK);
unlinkSync(join(libDir, 'worker.d.ts')), unlinkSync(join(libDir, 'node-worker.d.ts'));
const workerImport = /import (.*) from '\.\/node-worker';/;
const workerRequire = /var (.*) = require\("\.\/node-worker"\);/;
const defaultExport = /export default/;
const defaultExportAll = /export default (.*);\n/
writeFileSync(join(esmDir, 'index.mjs'), esm.replace(workerImport, nwk.replace(defaultExportAll, '')));
writeFileSync(join(esmDir, 'browser.js'), esm.replace(workerImport, wk.replace(defaultExportAll, '')));
writeFileSync(join(libDir, 'node.cjs'), lib.replace(workerRequire, name => {
  name = name.slice(4, name.indexOf(' ', 5));
  return nwk.replace(defaultExport, `var ${name} = {};\n${name}["default"] =`)
}));
writeFileSync(join(libDir, 'browser.cjs'), lib.replace(workerRequire, name => {
  name = name.slice(4, name.indexOf(' ', 5));
  return wk.replace(defaultExport, `var ${name} = {};\n${name}["default"] =`)
}));
writeFileSync(join(libDir, 'index.cjs'), lib.replace(workerRequire, name => `var ${name.slice(4, name.indexOf(' ', 5))} = require("./node-worker.cjs");`));