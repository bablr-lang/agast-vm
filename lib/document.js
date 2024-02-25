import { WeakStackFrame } from '@bablr/weak-stack';

export class Document extends WeakStackFrame {
  static from(context) {
    return new Document(context);
  }

  constructor(context, range = [null, null]) {
    super();
    this.context = context;
    this.range = range;
  }
}
