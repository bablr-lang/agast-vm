import {
  buildPathSegment,
  get,
  getChildPropertyIndex,
  getCloseTag,
  getProperties,
  getPropertyChildrenIndex,
} from '@bablr/agast-helpers/path';
import * as sumtree from '@bablr/agast-helpers/children';
import * as btree from '@bablr/agast-helpers/btree';
import { DoctypeTag, GapTag, NullTag, OpenNodeTag } from '@bablr/agast-helpers/symbols';
import { nodeFlags } from '@bablr/agast-helpers/builders';
import { nodeStates } from './state.js';

let { freeze, hasOwn } = Object;

export const nodes = new WeakMap();

export class NodeChildrenFacade {
  constructor(node) {
    nodes.set(this, node);
    let tree = node.children;

    if (!Object.isFrozen(tree)) throw new Error(); // just a sanity check right now

    this.size = sumtree.getSize(tree);

    freeze(this);
  }

  at(idx) {
    return sumtree.getAt(idx, nodes.get(this).children);
  }

  find(reference, index) {
    let node = nodes.get(this);

    let idx = this.findIndex(reference, index);

    return idx == null ? null : sumtree.getAt(idx, node.children);
  }

  findIndex(reference, index) {
    let { type, name } = reference;

    return getPropertyChildrenIndex(nodes.get(this), type, name, index);
  }

  [Symbol.iterator]() {
    return sumtree.traverse(nodes.get(this).children);
  }
}

export class ListFacade {
  constructor(tree) {
    nodes.set(this, tree);

    this.size = btree.getSize(tree);

    freeze(this);
  }

  at(idx) {
    return btree.getAt(idx, nodes.get(this));
  }

  [Symbol.iterator]() {
    return btree.traverse(nodes.get(this));
  }
}

export class NodePropertiesFacade {
  constructor(node) {
    nodes.set(this, node);

    freeze(this);
  }

  at(name, index = -1, shiftIndex = 0) {
    let { properties } = nodes.get(this);

    if (hasOwn(properties, name)) {
      let prop = properties[name];

      if (Array.isArray(prop.node) && index === -1) {
        return new ListFacade(prop.node);
      }

      if (Array.isArray(prop.node)) {
        prop = btree.getAt(index ?? -1, prop.node);
      }

      if (!prop) return index === -1 ? prop : null;
      if (prop.reference.flags.expression) {
        return NodeFacade.from(btree.getAt(shiftIndex + 1, prop.node)?.node);
      } else {
        return NodeFacade.from(prop.node);
      }
    }
    return null;
  }

  has(name, index = -1) {
    let { properties } = nodes.get(this);
    if (!hasOwn(properties, name)) return false;

    if (index >= 0 && !getProperties(name, index, properties)) {
      return false;
    }

    return true;
  }

  referenceAt(name, index = -1) {
    return getProperties(buildPathSegment(name, index), nodes.get(this).properties)?.reference;
  }

  [Symbol.iterator]() {
    return Object.entries(nodes.get(this).properties)[Symbol.iterator]();
  }
}

export class NodeFacade {
  static from(node) {
    return node && new NodeFacade(node);
  }

  constructor(node) {
    let sigilTag = sumtree.getAt(0, node.children);

    if (sigilTag.type === DoctypeTag) {
      sigilTag = sumtree.getAt(1, node.children);
    }

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

  get children() {
    return new NodeChildrenFacade(nodes.get(this));
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

    return getCloseTag(node) || [NullTag, GapTag].includes(sumtree.getAt(0, node.children).type)
      ? node
      : undefined;
  }

  get(path, shiftIndex = null) {
    if (shiftIndex !== null) throw new Error('bad get');
    return NodeFacade.from(get(path, nodes.get(this)));
  }

  getChildPropertyIndex(childrenIndex) {
    return getChildPropertyIndex(nodes.get(this), childrenIndex);
  }

  getPropertyChildrenIndex(type, name) {
    return getPropertyChildrenIndex(nodes.get(this), type, name);
  }
}
