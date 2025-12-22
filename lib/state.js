import { offsetForTag, TagPath } from '@bablr/agast-helpers/path';
import { DoctypeTag, Property } from '@bablr/agast-helpers/symbols';

export const State = class AgastState {
  static create() {
    return new State();
  }

  static from(held) {
    return new State(held);
  }

  constructor(held = null, path = null, resultPath = null) {
    this.held = held;
    this.path = path;
    this.resultPath = resultPath;
    this.done = false;
    this.doctype = null;
  }

  get node() {
    return this.path.node;
  }

  advance(tag) {
    if (!tag) throw new Error();

    if (this.done) throw new Error();

    let targetPath = this.path;

    switch (tag.type) {
      case DoctypeTag: {
        let { path } = this;

        if (this.resultPath || this.docType) throw new Error('invalid location for doctype');

        this.doctype = tag;

        targetPath = path;
        break;
      }

      default:
        throw new Error();
    }

    this.resultPath =
      targetPath && TagPath.from(targetPath, -1, tag.type === Property ? -1 : offsetForTag(tag));

    return tag;
  }
};
