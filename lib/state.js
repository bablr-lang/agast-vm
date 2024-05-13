import { WeakStackFrame } from '@bablr/weak-stack';
import { startsDocument } from '@bablr/agast-helpers/stream';
import { facades, actuals } from './facades.js';

export const StateFacade = class AgastStateFacade {
  constructor(state) {
    facades.set(state, this);
  }

  static from(context) {
    return State.from(actuals.get(context));
  }

  get result() {
    return actuals.get(this).result;
  }

  get context() {
    return facades.get(actuals.get(this).context);
  }

  get path() {
    return facades.get(actuals.get(this).path);
  }

  get node() {
    return actuals.get(this).node;
  }

  get holding() {
    return actuals.get(this).holding;
  }

  get depth() {
    return actuals.get(this).depth;
  }

  get ctx() {
    return this.context;
  }
};

export const State = class AgastState extends WeakStackFrame {
  constructor(
    context,
    path = null,
    node = null,
    result = null,
    emitted = null,
    held = null,
    expressionDepth = 0,
  ) {
    super();

    if (!context) throw new Error('invalid args to tagState');

    this.context = context;
    this.path = path;
    this.node = node;
    this.result = result;
    this.emitted = emitted;
    this.held = held;
    this.expressionDepth = expressionDepth;

    new StateFacade(this);
  }

  static from(context) {
    return State.create(context, null);
  }

  get holding() {
    return !!this.held;
  }

  shift() {
    const { tagNodes, prevTerminals, nextTerminals } = this.context;

    const finishedNode = tagNodes.get(this.result);

    if (!finishedNode.openTag.value.flags.expression) {
      throw new Error();
    }

    this.result = prevTerminals.get(finishedNode.openTag);

    nextTerminals.delete(this.result);

    this.held = finishedNode;

    // put the first expression node into the holding register
  }

  unshift() {
    const { tagNodes, prevTerminals, nextTerminals } = this.context;

    if (!this.held) {
      throw new Error('cannot unshift when no expression is in the holding register');
    }

    nextTerminals.set(this.result, this.held.openTag);
    prevTerminals.set(this.held.openTag, this.result);

    this.result = this.held.closeTag;

    this.held = null;
  }

  *emit(terminal, suppressEmit) {
    const { prevTerminals, nextTerminals, tagNodes } = this.context;

    if (terminal) {
      if (prevTerminals.has(terminal)) {
        throw new Error('Double emit');
      }

      if (
        this.result?.type === 'Reference' &&
        !['OpenNodeTag', 'Gap', 'Null'].includes(terminal.type)
      ) {
        throw new Error('Bad reference emit');
      }

      prevTerminals.set(terminal, this.result);
      if (this.result) {
        nextTerminals.set(this.result, terminal);
      }

      this.result = terminal;

      if (!this.emitted) {
        if (!startsDocument(terminal)) throw new Error();
        this.emitted = terminal;
        yield terminal;
      }
    }

    if (!this.depth && !this.expressionDepth && !suppressEmit) {
      let emittable = nextTerminals.get(this.emitted);

      while (
        emittable &&
        !(emittable.type === 'OpenNodeTag' && tagNodes.get(emittable).unboundAttributes?.size)
      ) {
        yield emittable;
        this.emitted = emittable;
        emittable = nextTerminals.get(this.emitted);
      }
    }

    return terminal;
  }

  get ctx() {
    return this.context;
  }

  get isGap() {
    return this.tag.type === 'NodeGapTag';
  }

  get speculative() {
    return !!this.parent;
  }

  branch() {
    const { context, path, node, result, emitted, held, expressionDepth } = this;

    return this.push(context, path, node.branch(), result, emitted, held, expressionDepth);
  }

  accept() {
    const { parent } = this;

    if (!parent) {
      throw new Error('accepted the root state');
    }

    parent.node.accept(this.node);

    // emitted isn't used here and probably doesn't need to be part of state

    parent.result = this.result;
    parent.held = this.held;
    parent.expressionDepth = this.expressionDepth;

    return parent;
  }

  reject() {
    const { parent, context } = this;

    if (!parent) throw new Error('rejected root state');

    context.nextTerminals.delete(parent.result);

    return parent;
  }
};
