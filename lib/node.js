import {
  getChildPropertyIndex,
  getCloseTag,
  getProperties,
  getPropertyChildrenIndex,
  getShifted,
} from '@bablr/agast-helpers/path';
import * as sumtree from '@bablr/agast-helpers/sumtree';
import * as btree from '@bablr/agast-helpers/btree';
import { DoctypeTag, GapTag, NullTag, OpenNodeTag } from '@bablr/agast-helpers/symbols';
import { nodeFlags } from '@bablr/agast-helpers/builders';
import { nodeStates } from './state.js';

let { freeze, hasOwn } = Object;

export const nodes = new WeakMap();

export class NodeChildrenFacade {
  constructor(tree) {
    nodes.set(this, tree);

    if (!Object.isFrozen(tree)) throw new Error(); // just a sanity check right now

    this.size = sumtree.getSize(tree);

    freeze(this);
  }

  at(idx) {
    return sumtree.getAt(idx, nodes.get(this));
  }

  [Symbol.iterator]() {
    return sumtree.traverse(nodes.get(this));
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
  constructor(properties) {
    nodes.set(this, properties);

    freeze(this);
  }

  at(name, index = -1, shiftIndex = 0) {
    let properties = nodes.get(this);

    if (hasOwn(properties, name)) {
      let prop = properties[name];

      if (Array.isArray(prop) && index === -1) {
        return new ListFacade(prop);
      }
      let binding = Array.isArray(prop) ? btree.getAt(index ?? -1, prop) : prop;

      if (!binding) return index === -1 ? prop : null;
      if (binding.reference.value.flags.expression) {
        return new NodeFacade(btree.getAt(shiftIndex, binding.node));
      } else {
        return new NodeFacade(binding.node);
      }
    }
    return null;
  }

  has(name, index = -1) {
    let properties = nodes.get(this);
    if (!hasOwn(properties, name)) return false;

    if (index >= 0 && !getProperties(name, index, properties)) {
      return false;
    }

    return true;
  }

  referenceAt(name, index = -1) {
    return getProperties(name, index, nodes.get(this))?.reference;
  }

  [Symbol.iterator]() {
    return Object.entries(nodes.get(this))[Symbol.iterator]();
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
      this.language = null;
      this.type = null;
    } else if (sigilTag.type === OpenNodeTag) {
      let { flags, language, type } = sigilTag.value;

      this.flags = flags;
      this.language = language;
      this.type = type;
    } else {
      throw new Error();
    }

    nodes.set(this, node);

    freeze(this);
  }

  get children() {
    return new NodeChildrenFacade(nodes.get(this).children);
  }

  get properties() {
    return new NodePropertiesFacade(nodes.get(this).properties);
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
    return NodeFacade.from(getShifted(shiftIndex, path, nodes.get(this)));
  }

  getChildPropertyIndex(childrenIndex) {
    return getChildPropertyIndex(nodes.get(this), childrenIndex);
  }

  getPropertyChildrenIndex(type, name) {
    return getPropertyChildrenIndex(nodes.get(this), type, name);
  }
}
