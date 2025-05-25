import {
  DoctypeTag,
  OpenNodeTag,
  CloseNodeTag,
  ReferenceTag,
  ShiftTag,
  GapTag,
  NullTag,
  InitializerTag,
  LiteralTag,
  AttributeDefinition,
  BindingTag,
  Property,
} from '@bablr/agast-helpers/symbols';
import { State } from './state.js';
import { facades } from './facades.js';
import { getFirstNode, TagPath } from '@bablr/agast-helpers/path';
import * as sumtree from '@bablr/agast-helpers/sumtree';
import { NodeFacade } from './node.js';

let { isArray } = Array;

export const agast = (options = {}) => {
  if (options.held?.properties) throw new Error();

  let state = State.from(options.held);

  let vm = __agast(state, options);

  vm.next();

  return Object.freeze({ state: facades.get(state), vm });
};

function* __agast(s) {
  let tag = yield;
  for (;;) {
    let returnValue = null;

    if (s.resultPath && !s.path) {
      throw new Error('Cannot advance after completion');
    }

    if (
      s.held &&
      ![OpenNodeTag, ReferenceTag, InitializerTag, Property, BindingTag].includes(tag.type) &&
      !(
        (tag.type === Property &&
          (sumtree.getSize(tag.value.node.children) <= 1 ||
            getFirstNode(tag.value.node) === s.held.node)) ||
        tag.value.node === s.held.node
      )
    ) {
      throw new Error('Cannot advance while holding');
    }

    switch (tag.type) {
      case DoctypeTag: {
        if (s.path) {
          throw new Error();
        }

        s.advance(tag);
        break;
      }

      case LiteralTag: {
        if (!s.node.flags.token) {
          throw new Error('literals must occur inside tokens');
        }

        if (s.held) {
          throw new Error('Cannot consume input while hold register is full');
        }

        s.advance(tag);
        break;
      }

      case ReferenceTag: {
        const { type } = tag.value;

        if (s.node?.flags.token && type !== '@') {
          throw new Error('A token node cannot contain a reference');
        }

        s.advance(tag);
        break;
      }

      case BindingTag: {
        const { languagePath } = tag.value;

        if (languagePath && !isArray(languagePath)) throw new Error();

        s.advance(tag);
        break;
      }

      case NullTag:
      case GapTag: {
        s.advance(tag);
        returnValue = new NodeFacade(s.resultPath.node);
        break;
      }

      case AttributeDefinition: {
        if (s.atReference) throw new Error();

        s.advance(tag);
        break;
      }

      case InitializerTag: {
        if (!s.atReference) throw new Error();

        s.advance(tag);
        break;
      }

      case ShiftTag: {
        const { index } = tag.value;
        if (s.resultPath.tag.type !== Property) throw new Error();

        let prevRef = s.resultPath.previousSibling.previousSibling;

        if (prevRef.tag.type === ShiftTag) {
          if (prevRef.tag.value.index + 1 !== index) throw new Error('bad shift index');
        }

        let refPath = TagPath.from(
          s.resultPath.path,
          s.resultPath.childrenIndex - (index - 1) * 3 - 2,
        );

        if (refPath.tag.type !== ReferenceTag) throw new Error();

        if (!refPath.tag.value.flags.expression) {
          throw new Error();
        }

        s.advance(tag);
        break;
      }

      case OpenNodeTag: {
        s.advance(tag);

        returnValue = new NodeFacade(s.node);
        break;
      }

      case CloseNodeTag: {
        returnValue = new NodeFacade(s.node);

        s.advance(tag);
        break;
      }

      case Property: {
        let { node } = tag.value;

        s.advance(tag);

        returnValue = new NodeFacade(node);
        break;
      }

      default:
        throw new Error();
    }

    tag = yield returnValue;
  }
}
