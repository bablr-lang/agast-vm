# @bablr/agast-vm

The agAST VM's purpose is to define what is valid agAST. For complete documentation, see the [agast-vm API reference](https://docs.bablr.org/reference/agast-vm).

## Usage

```js
import { agast } from '@bablr/agast-vm';
import * as b from '@bablr/agast-helpers/builders';

let vm = agast();
let lang = 'https://example';
let step;

let openTag = b.buildOpenNodeTag(
  b.tokenFlags,
  lang,
  'Token',
);
let closeTag = b.buildLiteralTag('OK');
let closeTag = b.buildCloseNodeTag();

step = vm.next(openTag);
step = vm.next(literalTag);
step = vm.next(closeTag);

let node = step.value;
```
