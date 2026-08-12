# tests/

本目录包含项目所有单元测试与冒烟测试。

## 测试文件格式

每个测试文件通过 `module.exports` 导出一个包含 `tests` 数组的对象：

```js
'use strict';

const assert = require('node:assert');

const tests = [
  {
    name: '测试用例名称',
    fn() {
      // 使用 node:assert 进行断言
      assert.strictEqual(1 + 1, 2);
    }
  }
];

module.exports = { tests };
```

- `name`（string）：用例名称，运行时会打印在结果中。
- `fn`（() => void）：测试函数，可同步或返回 Promise（运行器会 `await`）。

## 运行全部测试

```bash
node tests/run_tests.js
```

运行器会依次执行 `testFiles` 数组中注册的所有测试文件，并汇总 PASS / FAIL 数量。

## 运行单个测试文件

```bash
node -e "(async()=>{const s=require('./tests/test_parse.js');for(const t of s.tests){await t.fn();console.log('PASS',t.name);}})()"
```

> 注意：单纯 `require('./tests/test_xxx.js')` 只会加载模块，不会执行用例。

或自行构造运行器（支持异步用例）：

```js
(async () => {
  const suite = require('./tests/test_parse.js');
  for (const test of suite.tests) {
    await test.fn();
    console.log('PASS', test.name);
  }
})();
```

## 断言

统一使用 Node.js 内置的 `node:assert` 模块，无需额外依赖：

```js
const assert = require('node:assert');

assert.strictEqual(actual, expected);
assert.ok(value, '可选提示信息');
assert.throws(() => { /* ... */ });
```

## 新增测试

1. 在 `tests/` 目录下新建 `test_xxx.js`，按上述格式编写用例。
2. 打开 `run_tests.js`，将文件名添加到 `testFiles` 数组中：

```js
const testFiles = [
  'test_parse.js',
  // ...
  'test_xxx.js'   // ← 新增
];
```

3. 运行 `node tests/run_tests.js` 确认全部通过。
