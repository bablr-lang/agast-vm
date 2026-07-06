import {
  DoctypeTag,
  OpenNodeTag,
  CloseNodeTag,
  ReferenceTag,
  ShiftTag,
  GapTag,
  NullTag,
  LiteralTag,
  AttributeDefinition,
  BindingTag,
  Property,
  TreeNode,
  NullNode,
  GapNode,
} from '@bablr/agast-helpers/symbols';
import {
  buildNode,
  getAttributes,
  getFirstNode,
  isGapNode,
  isNodeTag,
  Path,
  TagPath,
} from '@bablr/agast-helpers/path';
import * as Tags from '@bablr/agast-helpers/tags';
import * as BList from '@bablr/agast-helpers/b-list';
import { isObject, freeze, isFrozen, isString } from '@bablr/agast-helpers/object';
import { parseTag, parseTagType } from '@bablr/agast-helpers/builders';
import { State } from './state.js';

const validNodes = new WeakSet();

export const isKnownValid = (node) => validNodes.has(node);

let { isArray } = Array;

export const agast = (options = freeze({})) => {
  let state = State.from(options.held);

  let vm = __agast(state, options);

  vm.next();

  if (!isFrozen(options)) throw new Error();

  let getState = () => ({
    path: state.path?.asPrimitive(),
    node: state.path?.node,
    resultPath: state.resultPath?.asPrimitive(),
    held: state.held,
  });

  return freeze({ options, getState, vm });
};

function* __agast(s) {
  let rawTag = yield;
  for (;;) {
    let returnValue = null;

    let tag;
    if (isObject(rawTag)) {
      tag = rawTag;
      if (rawTag.type === Property) {
        // nothing to do
      } else if ([TreeNode, NullNode, GapNode].includes(tag.type)) {
        if (!isKnownValid(rawTag)) throw new Error();
      } else {
        throw new Error();
      }
    } else if (isString(rawTag)) {
      tag = parseTag(rawTag);
    } else {
      throw new Error();
    }

    if (
      s.held &&
      ![OpenNodeTag, ReferenceTag, TreeNode, GapNode, BindingTag, Property, GapTag].includes(
        parseTagType(tag),
      ) &&
      !(
        (isNodeTag(tag) &&
          (BList.getSize(tag.value.tags) <= 1 || getFirstNode(tag.value) === s.held)) ||
        tag === s.held
      )
    ) {
      throw new Error('Cannot advance while holding');
    }

    switch (tag.type) {
      case DoctypeTag: {
        if (s.path) throw new Error('invalid location for doctype');

        s.doctype = tag;
        s.path = s.path.advance(rawTag);
        s.resultPath = s.path.tagPathAt(-1);
        break;
      }

      case ReferenceTag: {
        s.path = s.path.advance(rawTag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case LiteralTag: {
        s.path = s.path.advance(rawTag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case AttributeDefinition: {
        s.path = s.path.advance(rawTag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case BindingTag: {
        s.path = s.path.advance(rawTag);
        s.resultPath = s.path.tagPathAt(-1, [-1, -1]);
        break;
      }

      case NullTag:
      case GapTag: {
        if (s.path) {
          s.path = s.path.advance(rawTag);
          s.resultPath = s.path.tagPathAt(-1, -1);
        } else {
          s.path = Path.from(buildNode(tag));
          s.resultPath = s.path.tagPathAt(-1);
        }

        validNodes.add(s.resultPath.node);
        returnValue = s.resultPath.node;
        break;
      }

      case AttributeDefinition: {
        s.path = s.path.advance(rawTag);
        s.resultPath = s.path.tagPathAt(-1);
        break;
      }

      case ShiftTag: {
        let previousPropertyPath = s.path.tagPathAt(-1);
        s.path = s.path.advance(rawTag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.held = previousPropertyPath.inner.node;
        break;
      }

      case OpenNodeTag: {
        s.path = !s.path ? Path.fromTag(tag) : s.path.advance(rawTag);

        if (s.path) {
          let queue = [getAttributes(s.node)];
          while (queue.length) {
            for (let value of Object.values(queue[queue.length - 1])) {
              if (value === undefined) {
              } else if (isArray(value) || isObject(value)) {
                queue.push(value);
              }
            }
            queue.pop();
          }
        }

        if (tag.value.selfClosing) {
          s.resultPath = s.path.tagPathAt(-1).inner.tagPathAt(-1);
          validNodes.add(s.resultPath.node);
          returnValue = s.resultPath.node;
        } else {
          s.resultPath = s.path.tagPathAt(-1, -1);
          returnValue = s.node || s.resultPath.node;
        }

        break;
      }

      case CloseNodeTag: {
        if (!s.path) {
          s.done = true;
        }

        returnValue = s.node;

        let donePath = s.path;

        s.path = s.path.advance(rawTag);
        s.resultPath = donePath.depth
          ? s.path.tagPathAt(-1).inner.tagPathAt(-1)
          : s.path.tagPathAt(-1);

        validNodes.add(s.resultPath.node);
        break;
      }

      case Property: {
        let { tags, node } = tag.value;

        for (tag of Tags.traverse(tags)) {
          if (!isString(tag) && !isKnownValid(tag)) throw new Error();
          s.path = s.path.advance(tag);
        }

        s.resultPath = s.path.tagPathAt(-1, -1);
        returnValue = node;
        break;
      }

      case NullNode:
      case GapNode:
      case TreeNode: {
        let node = tag;

        // if (s.held && !s.path.held) throw new Error();

        s.path = s.path.advance(s.held && isGapNode(node) ? s.held : tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.held = null;

        returnValue = s.path.node;
        break;
      }

      default:
        throw new Error();
    }

    if (s.node.value.type === Symbol.for('__')) {
      validNodes.add(s.node);
    }

    rawTag = yield returnValue;
  }
}
