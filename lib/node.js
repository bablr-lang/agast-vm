import {
  buildPathSegment,
  get,
  has,
  countList,
  getChildPropertyIndex,
  getCloseTag,
  getInitializerTagsIndex,
  getProperty,
  getPropertyTagsIndex,
  relatedNodes,
  getOpenTag,
} from '@bablr/agast-helpers/path';
import * as Tags from '@bablr/agast-helpers/tags';
import * as BTree from '@bablr/agast-helpers/btree';
import { CloseNodeTag, GapTag, NullTag, OpenNodeTag } from '@bablr/agast-helpers/symbols';
import { buildReferenceTag, nodeFlags } from '@bablr/agast-helpers/builders';
import { nodeStates } from './state.js';

let { freeze } = Object;

export const nodes = new WeakMap();

export class NodeTagsFacade {
  constructor(node) {
    nodes.set(this, node);
    let tree = node.tags;

    if (!Object.isFrozen(tree)) throw new Error(); // just a sanity check right now

    this.size = Tags.getSize(tree);

    freeze(this);
  }

  get openTag() {
    return Tags.getValues(nodes.get(this).tags)[0];
  }

  get closeTag() {
    return Tags.getValues(nodes.get(this).tags)[2];
  }

  *children() {
    for (const child of this) {
      if (![OpenNodeTag, CloseNodeTag, NullTag, GapTag].includes(child.type)) {
        yield child;
      }
    }
  }

  at(idx) {
    return Tags.getAt(idx, nodes.get(this).tags);
  }

  find(reference, index) {
    let node = nodes.get(this);

    let idx = this.findIndex(reference, index);

    return idx == null ? null : Tags.getAt(idx, node.tags);
  }

  findIndex(reference, index) {
    let { type, name } = reference;

    return getPropertyTagsIndex(nodes.get(this), type, name, index);
  }

  [Symbol.iterator]() {
    return Tags.traverse(nodes.get(this).tags);
  }
}

export class ListFacade {
  constructor(tree) {
    nodes.set(this, tree);

    this.size = BTree.getSize(tree);

    freeze(this);
  }

  at(idx) {
    return BTree.getAt(idx, nodes.get(this));
  }

  [Symbol.iterator]() {
    return BTree.traverse(nodes.get(this));
  }
}

export class NodePropertiesFacade {
  constructor(node) {
    nodes.set(this, node);

    freeze(this);
  }

  get(name, index = undefined, shiftIndex = undefined) {
    let node = nodes.get(this);

    let prop = getProperty(buildPathSegment(name, index, shiftIndex), node);
    if (prop) {
      if (Array.isArray(prop.node) && index === undefined) {
        return new ListFacade(prop.node);
      }

      if (Array.isArray(prop.node)) {
        prop = BTree.getAt(index ?? -1, prop.node);
      }

      if (!prop) return index === -1 ? prop : null;

      return NodeFacade.from(prop.node);
    }
    return null;
  }

  referenceAt(name, index = undefined) {
    let path = index == null ? name : buildPathSegment(name, index);
    return getProperty(path, nodes.get(this))?.reference;
  }

  has(name, index = undefined) {
    let path = index == null ? name : buildPathSegment(name, index);
    return (
      !!getProperty(path, nodes.get(this)) ||
      getInitializerTagsIndex(nodes.get(this), buildReferenceTag(null, name)) != null
    );
  }

  [Symbol.iterator]() {
    return relatedNodes(nodes.get(this));
  }
}

export class NodeFacade {
  static from(node) {
    return node && new NodeFacade(node);
  }

  constructor(node) {
    let sigilTag = getOpenTag(node);

    this.sigilTag = sigilTag;

    if ([NullTag, GapTag].includes(sigilTag.type)) {
      this.flags = nodeFlags;
      this.type = null;
    } else if (sigilTag.type === OpenNodeTag) {
      let { flags, type } = sigilTag.value;

      this.flags = flags;
      this.type = type;
    } else {
      throw new Error();
    }

    nodes.set(this, node);

    freeze(this);
  }

  get tags() {
    return new NodeTagsFacade(nodes.get(this));
  }

  get properties() {
    return new NodePropertiesFacade(nodes.get(this));
  }

  get attributes() {
    return nodes.get(this).attributes;
  }

  get undefinedAttributes() {
    return nodeStates.get(nodes.get(this)).undefinedAttributes;
  }

  get node() {
    let node = nodes.get(this);

    return getCloseTag(node) || [NullTag, GapTag].includes(getOpenTag(node).type)
      ? node
      : undefined;
  }

  get(path) {
    return NodeFacade.from(get(path, nodes.get(this)));
  }

  has(path) {
    return NodeFacade.from(has(path, nodes.get(this)));
  }

  countList(path) {
    return countList(path, nodes.get(this));
  }

  getChildPropertyIndex(tagsIndex) {
    return getChildPropertyIndex(nodes.get(this), tagsIndex);
  }

  getPropertyTagsIndex(type, name) {
    return getPropertyTagsIndex(nodes.get(this), type, name);
  }
}
