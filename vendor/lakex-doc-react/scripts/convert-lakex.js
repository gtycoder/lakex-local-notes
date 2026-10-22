import fs from 'fs';
import path from 'path';

const url = new URL(import.meta.url);
const filePath = url.pathname;
const __dirname = path.dirname(filePath.replace(/^\/([a-z]:)/i, '$1'));
const umdPath = path.join(__dirname, '../src/components/lakex/doc.umd.js');
const outputPath = path.join(__dirname, '../src/components/lakex/lakex.js');

const umdContent = fs.readFileSync(umdPath, 'utf-8');

const esmWrapper = `// AUTO-CONVERTED: public/lakex.js (webpack UMD) -> ESM module.
// Source is @alipay/lakex-doc (v1.99.0).
import React from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';

const __defaultPropsMsg = 'Support for defaultProps will be removed from function components';
const __originalError = console.error;
const __originalWarn = console.warn;

function __shouldFilter(args) {
  return typeof args[0] === 'string' && args[0].includes(__defaultPropsMsg);
}

console.error = function (...args) {
  if (__shouldFilter(args)) return;
  __originalError.apply(console, args);
};
console.warn = function (...args) {
  if (__shouldFilter(args)) return;
  __originalWarn.apply(console, args);
};

const __rootCache = new WeakMap();
const __pendingUnmount = new WeakSet();
const __patchedReactDOM = {
  ...ReactDOM,
  render(element, container, callback) {
    __pendingUnmount.delete(container);
    let root = __rootCache.get(container);
    if (!root) {
      root = createRoot(container);
      __rootCache.set(container, root);
    }
    root.render(element);
    if (typeof callback === 'function') {
      Promise.resolve().then(callback);
    }
    return container;
  },
  unmountComponentAtNode(container) {
    const root = __rootCache.get(container);
    if (root && !__pendingUnmount.has(container)) {
      __pendingUnmount.add(container);
      queueMicrotask(() => {
        if (__pendingUnmount.has(container)) {
          __pendingUnmount.delete(container);
          __rootCache.delete(container);
          try {
            root.unmount();
          } catch (e) {
          }
        }
      });
      return true;
    }
    return false;
  },
};

`;

const esmFooter = `

const Doc = __lakexFactory(React, __patchedReactDOM);
export default Doc;
`;

const outerStart = '!function(e,t){"object"==typeof exports&&"object"==typeof module?module.exports=t(require("React"),require("ReactDOM")):"function"==typeof define&&define.amd?define(["React","ReactDOM"],t):"object"==typeof exports?exports.Doc=t(require("React"),require("ReactDOM")):e.Doc=t(e.React,e.ReactDOM)}(self,';
const outerEnd = ');';

const startIndex = umdContent.indexOf(outerStart);
const endIndex = umdContent.lastIndexOf(outerEnd);

if (startIndex === -1) {
  console.error('Failed to find outer UMD wrapper start');
  process.exit(1);
}

if (endIndex === -1) {
  console.error('Failed to find outer UMD wrapper end');
  process.exit(1);
}

const innerFactory = umdContent.substring(startIndex + outerStart.length, endIndex);

const finalContent = esmWrapper + 'const __lakexFactory = ' + innerFactory + ';' + esmFooter;

fs.writeFileSync(outputPath, finalContent, 'utf-8');
console.log('Successfully converted lakex UMD to ESM format!');
console.log(`Output file size: ${(finalContent.length / 1024 / 1024).toFixed(2)} MB`);