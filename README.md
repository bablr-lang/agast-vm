# @bablr/agast-vm

The agAST VM provides consistency guarantees when with CSTML documents to parse or transform code. It has no language-specific functionality of any kind. Instead it acts as a streaming traversal engine for CSTML.

## API

The VM responds to several instructions, but its primary API is `advance(token)`, where `token` may be a `OpenFragmentTag`, `CloseFragmentTag`, `OpenNodeTag`, `CloseNodeTag`, `Literal`, `Reference`, or `Gap`.

The VM requires the basic invariants of CSTML to be followed, for example that `Reference` must be followed by either a `OpenNodeTag` or a `Gap`. In fact, `agast-vm` is the reference implementation of these invariants.

The VM supports `branch()`, `accept()`, and `reject()` instructions, which allow a series of instructions to have their effects applied or discarded together in a kind of transaction.

Finally the VM supports `bindAttribute(key, value)`. A node's attributes start unbound, and this command is used to give them values. Once all declared attributes for a node are bound, that node's full start tag is known and can be emitted.

Here are the basic types used by the VM:

```ts
type Token = OpenFragmentTag | CloseFragmentTag | OpenNodeTag | CloseNodeTag | Literal | Reference | Gap;

type OpenFragmentTag {
  type: 'OpenFragmentTag',
  value: null
}

type CloseFragmentTag {
  type: 'CloseFragmentTag',
  value: null
}

type OpenNodeTag {
  type: 'OpenNodeTag',
  value: {
    flags: {
      token: boolean,
      trivia: boolean,
      escape: boolean
    },
    language: string,
    type: string,
    attributes: { [key: string]: boolean | number | string }
  }
}

type CloseNodeTag {
  type: 'CloseNodeTag',
  value: {
    language: string,
    type: string,
  }
}

type Literal {
  value: string
}

type Reference {
  type: 'Reference',
  value: {
    name: string,
    isArray: boolean
  }
}

type Gap {
  type: 'Gap',
  value: null,
}
```
