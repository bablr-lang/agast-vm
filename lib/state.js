import { WeakStackFrame } from '@bablr/weak-stack';
import { buildCall } from '@bablr/agast-vm-helpers';
import { startsDocument } from '@bablr/agast-helpers/stream';
import { facades, actuals } from './facades.js';

export class StateFacade {
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

  get depth() {
    return actuals.get(this).depth;
  }

  get ctx() {
    return this.context;
  }
}

export class State extends WeakStackFrame {
  constructor(context, path, result = null, emitted = null) {
    super();

    if (!context) throw new Error('invalid args to tagState');

    this.context = context;
    this.path = path;
    this.result = result;
    this.emitted = emitted;

    new StateFacade(this);
  }

  static from(context) {
    return State.create(context, null);
  }

  *emit(terminal) {
    const { prevTerminals, nextTerminals, tagPaths } = this.context;

    if (terminal) {
      if (terminal.value && /\r|\n/.test(terminal.value) && !/^\r|\r\n|\n$/.test(terminal.value)) {
        // throw new Error('Invalid LineBreak token');
      }

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
        yield buildCall('emit', terminal);
      }
    }

    if (this.depth === 0) {
      let emittable = nextTerminals.get(this.emitted);

      while (
        emittable &&
        !(emittable.type === 'OpenNodeTag' && tagPaths.get(emittable).unboundAttributes?.size)
      ) {
        yield buildCall('emit', emittable);
        this.emitted = emittable;
        emittable = nextTerminals.get(this.emitted);
      }
    }

    return terminal;
  }

  get ctx() {
    return this.context;
  }

  get stack() {
    return this.context.states;
  }

  get isGap() {
    return this.tag.type === 'NodeGapTag';
  }

  get speculative() {
    return !!this.parent;
  }
}
