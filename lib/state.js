import { offsetForTag, TagPath } from '@bablr/agast-helpers/path';
import {
  DoctypeTag,
  ReferenceTag,
  ShiftTag,
  GapTag,
  BindingTag,
  Property,
} from '@bablr/agast-helpers/symbols';
import { facades, actuals } from './facades.js';
import { PathFacade, TagPathFacade } from './path.js';
import { NodeFacade } from './node.js';

export const StateFacade = class AgastStateFacade {
  constructor(state) {
    facades.set(state, this);
  }

  static create() {
    return State.create();
  }

  get resultPath() {
    let { resultPath } = actuals.get(this);
    return resultPath && new TagPathFacade(resultPath);
  }

  get referenceTag() {
    return actuals.get(this).referenceTag;
  }

  get referenceTagPath() {
    let { referenceTagPath } = actuals.get(this);
    return referenceTagPath && new TagPathFacade(referenceTagPath);
  }

  get path() {
    let { path } = actuals.get(this);
    return path && new PathFacade(path);
  }

  get node() {
    let { node } = actuals.get(this);
    return node && new NodeFacade(node);
  }

  get done() {
    return actuals.get(this).done;
  }

  get parentNode() {
    let { parentNode } = actuals.get(this);
    return parentNode && new NodeFacade(parentNode);
  }

  get held() {
    let { held } = actuals.get(this);
    return held && new NodeFacade(held);
  }

  get holding() {
    return actuals.get(this).holding;
  }

  get depth() {
    return actuals.get(this).depth;
  }

  get parent() {
    return facades.get(actuals.get(this).parent);
  }
};

export const nodeStates = new WeakMap();

export const State = class AgastState {
  static create() {
    return new State();
  }

  constructor(held = null, path = null, resultPath = null) {
    this.held = held;
    this.path = path;
    this.resultPath = resultPath;
    this.done = false;
    this.referenceTagPath = null;
    this.doctype = null;

    new StateFacade(this);
  }

  static from(held) {
    return new State(held);
  }

  get holding() {
    return !!this.held;
  }

  get atReference() {
    return [ReferenceTag, ShiftTag].includes(this.resultPath?.tag.type);
  }

  get atBinding() {
    return this.resultPath?.tag.type === BindingTag;
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

  get isGap() {
    return this.tag.type === GapTag;
  }

  get speculative() {
    throw new Error('not implemented');
  }

  get parentNode() {
    return this.path.parent?.node;
  }

  get referenceTag() {
    return this.referenceTagPath?.tag;
  }

  get bindingPath() {
    let path = this.referenceTagPath?.nextSibling;
    return path?.tag.type === BindingTag ? path : null;
  }

  get binding() {
    return this.bindingPath?.tag;
  }

  get node() {
    return this.path?.node;
  }
};
