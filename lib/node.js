import { Resolver } from '@bablr/agast-helpers/tree';
import { facades, actuals } from './facades.js';

export const NodeFacade = class AgastNodeFacade {
  constructor(path) {
    facades.set(path, this);
  }

  get language() {
    return actuals.get(this).language;
  }

  get type() {
    return actuals.get(this).type;
  }

  get range() {
    return actuals.get(this).range;
  }

  get openTag() {
    return actuals.get(this).openTag;
  }

  get closeTag() {
    return actuals.get(this).closeTag;
  }

  get flags() {
    return actuals.get(this).flags;
  }

  get attributes() {
    return actuals.get(this).attributes;
  }
};

export const Node = class AgastNode {
  static from(openTag) {
    return new AgastNode(openTag);
  }

  constructor(
    openTag,
    closeTag = null,
    properties = new Map(),
    resolver = new Resolver(),
    unboundAttributes = null,
  ) {
    this.openTag = openTag;
    this.closeTag = closeTag;
    this.properties = properties;
    this.resolver = resolver;
    this.unboundAttributes = unboundAttributes;
  }

  get language() {
    return this.openTag.value?.language;
  }

  get type() {
    return this.openTag.value?.type || null;
  }

  get flags() {
    return this.openTag.value?.flags || {};
  }

  get attributes() {
    return this.openTag.value?.attributes || {};
  }

  get range() {
    return [this.openTag, this.closeTag];
  }

  branch() {
    const { openTag, closeTag, properties, resolver, unboundAttributes } = this;

    return new Node(
      openTag,
      closeTag,
      new Map(properties), // there is probably a better way
      resolver.branch(),
      new Set(unboundAttributes),
    );
  }

  accept(node) {
    this.openTag = node.openTag;
    this.closeTag = node.closeTag;
    this.properties = node.properties;
    this.unboundAttributes = node.unboundAttributes;

    this.resolver.accept(node.resolver);

    return this;
  }
};
