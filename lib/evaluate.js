/* global WeakSet */
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
  PropertyWrapper,
  Node,
} from '@bablr/agast-helpers/symbols';
import { nodeStates, State } from './state.js';
import { facades } from './facades.js';
import { isGapNode, TagPath } from '@bablr/agast-helpers/path';
import * as BTree from '@bablr/agast-helpers/btree';
import { NodeFacade } from './node.js';
import { buildNodeTag } from '@bablr/agast-helpers/builders';
import { isObject } from '@bablr/agast-helpers/object';

const validNodes = new WeakSet();

export const isKnownValid = (node) => validNodes.has(node);

let { isArray } = Array;

export const agast = (options = {}) => {
  let state = State.from(options.held);

  let vm = __agast(state, options);

  vm.next();

  Object.freeze(options);

  return Object.freeze({ options, state: facades.get(state), vm });
};

function* __agast(s) {
  let tag = yield;
  for (;;) {
    let returnValue = null;

    if (s.resultPath && !s.path) {
      throw new Error('Cannot advance after completion');
    }

    // if (
    //   s.held &&
    //   ![
    //     OpenNodeTag,
    //     ReferenceTag,
    //     Property,
    //     Node,
    //     BindingTag,
    //     PropertyWrapper,
    //     GapTag,
    //   ].includes(tag.type) &&
    //   !(
    //     (tag.type === Property &&
    //       (Tags.getSize(tag.value.node.tags) <= 1 || getFirstNode(tag.value.node) === s.held)) ||
    //     tag.value.node === s.held
    //   )
    // ) {
    //   throw new Error('Cannot advance while holding');
    // }

    switch (tag.type) {
      case DoctypeTag: {
        if (s.path) {
          throw new Error();
        }

        s.advance(tag);
        break;
      }

      case ReferenceTag: {
        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = TagPath.from(s.path, -1, 0);
        break;
      }

      case LiteralTag: {
        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case AttributeDefinition: {
        let nodeState = nodeStates.get(s.node);

        nodeState.undefinedAttributes--;

        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = TagPath.from(s.path, -1, 0);
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
        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        returnValue = new NodeFacade(s.resultPath.node);
        break;
      }

      case AttributeDefinition: {
        if (s.atReference) throw new Error();

        s.advance(tag);
        break;
      }

      case ShiftTag: {
        let previousPropertyPath = s.path.tagPathAt(-1);
        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = TagPath.from(s.path, -1, 0);
        s.held = previousPropertyPath.inner.node;
        break;
      }

      case OpenNodeTag: {
        s.path = !s.path ? TagPath.fromTag(tag).path : s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);

        if (s.path) {
          let undefinedAttributes = 0;

          let queue = [s.node.attributes];
          while (queue.length) {
            for (let value of Object.values(queue[queue.length - 1])) {
              if (value === undefined) {
                undefinedAttributes++;
              } else if (isArray(value) || isObject(value)) {
                queue.push(value);
              }
            }
            queue.pop();
          }

          nodeStates.set(s.node, { undefinedAttributes });
        }

        returnValue = new NodeFacade(s.node || s.resultPath.node);
        break;
      }

      case CloseNodeTag: {
        if (!s.path) {
          s.done = true;
        }

        validNodes.add(s.node);

        returnValue = new NodeFacade(s.node);

        let donePath = s.path;

        s.path = s.path.advance(tag);

        s.resultPath = donePath.tagPathAt(-1, -1);
        break;
      }

      case PropertyWrapper: {
        let { tags, property } = tag.value;
        let { node } = property;

        for (tag of tags) {
          s.advance(tag);
        }
        returnValue = new NodeFacade(node);

        break;
      }

      case Property: {
        let { node } = tag.value;

        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = null;
        s.held = null;

        returnValue = Array.isArray(node) ? node : new NodeFacade(node);
        break;
      }

      case Node: {
        let node = tag.value;

        let clearedHeld = s.held && BTree.getAt(-BTree.getSize(s.held.bounds[0]), node.bounds[0]);
        // let clearsHeld = false;

        s.path.advance(s.held && isGapNode(node) && !clearedHeld ? buildNodeTag(s.held) : tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = null;
        s.held = null;

        returnValue = Array.isArray(node) ? node : new NodeFacade(node);
        break;
      }

      default:
        throw new Error();
    }

    tag = yield returnValue;
  }
}
