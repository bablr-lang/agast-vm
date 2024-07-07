import { WeakStackFrame } from '@bablr/weak-stack';
import { startsDocument } from '@bablr/agast-helpers/stream';
import { facades, actuals } from './facades.js';
import { buildBeginningOfStreamToken } from '@bablr/agast-helpers/builders';

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
    result = buildBeginningOfStreamToken(),
    emitted = null,
    held = null,
  ) {
    super();

    if (!context) throw new Error('invalid args to tagState');

    this.context = context;
    this.path = path;
    this.node = node;
    this.result = result;
    this.emitted = emitted;
    this.held = held;

    new StateFacade(this);
  }

  static from(context) {
    return State.create(context, null);
  }

  get holding() {
    return !!this.held;
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
        throw new Error(`${terminal.type} is not a valid reference target`);
      }

      prevTerminals.set(terminal, this.result);
      nextTerminals.set(this.result, terminal);

      this.result = terminal;

      if (!this.emitted) {
        if (!startsDocument(terminal)) throw new Error();
        this.emitted = terminal;
        yield terminal;
      }
    }

    if (!this.depth && !suppressEmit) {
      let emittable = nextTerminals.get(this.emitted);

      while (
        emittable &&
        !(
          emittable.type === 'OpenNodeTag' &&
          emittable.value.type &&
          tagNodes.get(emittable).unboundAttributes?.size
        )
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
    const { context, path, node, result, emitted, held } = this;

    return this.push(context, path, node.branch(), result, emitted, held);
  }

  accept() {
    const { parent } = this;

    if (!parent) {
      return null;
    }

    parent.node.accept(this.node);

    // emitted isn't used here and probably doesn't need to be part of state

    parent.result = this.result;
    parent.held = this.held;
    parent.path = this.path;

    return parent;
  }

  reject() {
    const { parent, context } = this;

    if (!parent) throw new Error('rejected root state');

    context.nextTerminals.delete(parent.result);

    return parent;
  }
};
