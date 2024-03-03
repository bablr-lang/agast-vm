# @bablr/agast-vm

The agAST VM provides consistency guarantees when with CSTML documents to parse or transform code. It has no language-specific functionality of any kind. Instead it acts as a streaming traversal engine for CSTML.

## Why

The goal of this project is to transition editors towards being a lot more like web browsers. You can have many of them, and they can be written in a variety of languages (though many share internals). You can even have a terminal browser like Lynx that does presentation very differently, yet it is still possible (if not trivial) to write a website once that will run on all (er, most) web browsers.

If the parallel is not immediately obvious, try thinking about it this way: a webapp is really more or less a set of automated tools for editing a DOM tree. As programmers we have all these amazing web libraries and frameworks that can exist because at the end of the day everything comes down to editing a shared DOM tree. There's a great explanation of those dynamics here: https://glazkov.com/2024/01/02/the-protocol-force/

If a code-DOM existed and was shared by all IDEs there would spring up a rich ecosystem of tools for accomplishing many kinds of tree alterations. For example it could become common for library authors to publish codemods that could help any project upgrade past breaking changes in its APIs!

## API

The VM responds to several instructions, but its primary API is `advance(token)`, where `token` may be a `StartFragmentTag`, `EndFragmentTag`, `StartNodeTag`, `EndNodeTag`, `Literal`, `Reference`, or `Gap`.

The VM requires the basic invariants of CSTML to be followed, for example that `Reference` must be followed by either a `StartNodeTag` or a `Gap`. In fact, `agast-vm` is the reference implementation of these invariants.

The VM supports `branch()`, `accept()`, and `reject()` instructions, which allow a series of instructions to have their effects applied or discarded together in a kind of transaction.

Finally the VM supports `bindAttribute(key, value)`. A node's attributes start unbound, and this command is used to give them values. Once all declared attributes for a node are bound, that node's full start tag is known and can be emitted.

Here are the basic types used by the VM:

```ts
type Token = StartFragmentTag | EndFragmentTag | StartNodeTag | EndNodeTag | Literal | Reference | Gap;

type StartFragmentTag {
  type: 'StartFragmentTag',
  value: {
    flags: {
      trivia: boolean
    },
    language: string,
  }
}

type EndFragmentTag {
  type: 'EndFragmentTag',
  value: null
}

type StartNodeTag {
  type: 'StartNodeTag',
  value: {
    flags: {
      syntactic: boolean,
      trivia: boolean,
      escape: boolean
    },
    language: string,
    type: string,
    attributes: { [key: string]: boolean | number | string }
  }
}

type EndNodeTag {
  type: 'EndNodeTag',
  value: null
}

type Literal {
  value: string
}

type Reference {
  type: 'Reference',
  value: {
    pathName: string,
    pathIsArray: boolean
  }
}

type Gap {
  type: 'Gap',
  value: null,
}
```
