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
import { State } from './state.js';
import { buildNode, getAttributes, isGapNode, Path, TagPath } from '@bablr/agast-helpers/path';
import * as Tags from '@bablr/agast-helpers/tags';
import { isObject } from '@bablr/agast-helpers/object';

const validNodes = new WeakSet();

export const isKnownValid = (node) => validNodes.has(node);

let { isArray } = Array;

export const agast = (options = {}) => {
  let state = State.from(options.held);

  let vm = __agast(state, options);

  vm.next();

  Object.freeze(options);

  let getState = () => ({
    path: state.path.asPrimitive(),
    node: state.path.node,
    resultPath: state.resultPath.asPrimitive(),
    held: state.held,
  });

  return Object.freeze({ options, getState, vm });
};

function* __agast(s) {
  let tag = yield;
  for (;;) {
    let returnValue = null;

    if (!Tags.isValidTag(tag) && !isKnownValid(tag) && tag.type !== Property) throw new Error();

    // if (
    //   s.held &&
    //   ![OpenNodeTag, ReferenceTag, TreeNode, GapNode, BindingTag, Property, GapTag].includes(
    //     tag.type,
    //   ) &&
    //   !(
    //     (isNodeTag(tag) &&
    //       (Tags.getSize(tag.value.tags) <= 1 || getFirstNode(tag.value) === s.held)) ||
    //     tag.value === s.held
    //   )
    // ) {
    //   throw new Error('Cannot advance while holding');
    // }

    switch (tag.type) {
      case DoctypeTag: {
        if (s.path) {
          throw new Error();
        }

        s.path = s.path.advance(tag);
        break;
      }

      case ReferenceTag: {
        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case LiteralTag: {
        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case AttributeDefinition: {
        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case BindingTag: {
        const { segments } = tag.value;

        if (segments && !isArray(segments)) throw new Error();

        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, [-1, -1]);
        break;
      }

      case NullTag:
      case GapTag: {
        if (s.path) {
          s.path = s.path.advance(tag);
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
        s.path = s.path.advance(tag);
        break;
      }

      case ShiftTag: {
        let previousPropertyPath = s.path.tagPathAt(-1);
        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.held = previousPropertyPath.inner.node;
        break;
      }

      case OpenNodeTag: {
        s.path = !s.path ? TagPath.fromTag(tag).path : s.path.advance(tag);

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

        s.path = s.path.advance(tag);
        s.resultPath = donePath.depth
          ? s.path.tagPathAt(-1).inner.tagPathAt(-1)
          : s.path.tagPathAt(-1);

        validNodes.add(s.resultPath.node);
        break;
      }

      case Property: {
        let { tags, node } = tag.value;

        for (tag of Tags.traverse(tags)) {
          if (!Tags.isValidTag(tag) && !isKnownValid(tag)) throw new Error();
          s.path = s.path.advance(tag);
        }
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

    tag = yield returnValue;
  }
}
