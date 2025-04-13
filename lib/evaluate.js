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
  EmbeddedNode,
  AttributeDefinition,
} from '@bablr/agast-helpers/symbols';
import { State } from './state.js';
import { facades } from './facades.js';
import { getFirstProperty, isGapNode, isNullNode, TagPath } from '@bablr/agast-helpers/path';
import * as sumtree from '@bablr/agast-helpers/sumtree';

export const agast = () => {
  let state = State.create();

  let vm = __agast(state);

  vm.next();

  return Object.freeze({ state: facades.get(state), vm });
};

function* __agast(s) {
  let tag = yield;
  for (;;) {
    let returnValue = null;

    if (
      s.held &&
      ![OpenNodeTag, ReferenceTag, GapTag].includes(tag.type) &&
      !(
        tag.type === EmbeddedNode &&
        (!sumtree.getSize(tag.value.children) || getFirstProperty(tag.value) === s.held.node)
      )
    ) {
      throw new Error('Cannot advance while holding');
    }

    switch (tag.type) {
      case DoctypeTag: {
        if (s.path.depth !== 0) {
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

      case NullTag:
      case GapTag: {
        s.advance(tag);
        returnValue = s.resultPath.node;
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
        if (s.resultPath.tag.type !== GapTag) throw new Error();

        let prevRef = s.resultPath.previousSibling;

        if (prevRef.tag.type === ShiftTag) {
          if (prevRef.tag.value.index + 1 !== index) throw new Error('bad shift index');
        }

        const refPath = TagPath.from(
          s.resultPath.path,
          s.resultPath.childrenIndex - (index - 1) * 2 - 1,
        );

        if (refPath.tag.type !== ReferenceTag) throw new Error();

        if (!refPath.tag.value.flags.expression) {
          throw new Error();
        }

        s.advance(tag);
        break;
      }

      case OpenNodeTag: {
        const { language } = tag.value;

        if (language && !language.startsWith('https://')) {
          throw new Error('Expected an absolute-language tag');
        }

        s.advance(tag);
        break;
      }

      case CloseNodeTag: {
        returnValue = s.node;

        s.advance(tag);
        break;
      }

      case EmbeddedNode: {
        let node = tag.value;

        s.held = null;

        if (isNullNode(node) || isGapNode(node)) {
          s.advance(sumtree.getAt(0, node.children));
        } else {
          s.advance(tag);
        }

        returnValue = node;
        break;
      }

      default:
        throw new Error();
    }

    tag = yield returnValue;
  }
}
