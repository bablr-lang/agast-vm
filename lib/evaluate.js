import { Coroutine } from '@bablr/coroutine';
import {
  buildNullTag,
  buildGapTag,
  buildShiftTag,
  buildReferenceTag,
  buildLiteralTag,
  buildDoctypeTag,
  buildOpenNodeTag,
  buildCloseNodeTag,
  buildInitializerTag,
} from '@bablr/agast-vm-helpers/internal-builders';
import { getEmbeddedTag } from '@bablr/agast-vm-helpers/deembed';
import { StreamIterable, getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
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
} from '@bablr/agast-helpers/symbols';
import { State } from './state.js';
import { Context } from './context.js';
import { facades } from './facades.js';
import { add, TagPath } from '@bablr/agast-helpers/path';
import { buildNullNode } from '@bablr/agast-helpers/tree';

export const agast = (strategy, options = {}) => {
  const ctx = Context.create();
  let s = State.from(ctx, options.expressions);

  return new StreamIterable(__agast(ctx, s, strategy(facades.get(ctx), facades.get(s))));
};

function* __agast(ctx, s, instructions) {
  const co = new Coroutine(getStreamIterator(instructions));

  co.advance();

  for (;;) {
    if (co.current instanceof Promise) {
      co.current = yield co.current;
    }

    if (co.done) break;

    const instr = co.value;

    let returnValue = undefined;

    const { verb, arguments: args = [] } = instr;

    switch (verb) {
      case 'advance': {
        const { 0: embeddedTags } = args;

        const tag = getEmbeddedTag(embeddedTags);

        if (
          s.held &&
          !(tag.type === OpenNodeTag || tag.type === ReferenceTag || tag.type === GapTag)
        ) {
          throw new Error('Cannot advance while holding');
        }

        switch (tag?.type || NullTag) {
          case DoctypeTag: {
            const { attributes } = tag.value;

            if (s.path.depth !== 0) {
              throw new Error();
            }

            returnValue = s.advance(buildDoctypeTag(attributes));
            break;
          }

          case LiteralTag: {
            if (!s.node.flags.token) {
              throw new Error('literals must occur inside tokens');
            }

            if (s.held) {
              throw new Error('Cannot consume input while hold register is full');
            }

            returnValue = s.advance(buildLiteralTag(tag.value));
            break;
          }

          case ReferenceTag: {
            const { name, isArray, flags } = tag.value;

            if (s.node?.flags.token && name !== '@') {
              throw new Error('A token node cannot contain a reference');
            }

            returnValue = s.advance(buildReferenceTag(name, isArray, flags));
            break;
          }

          case GapTag: {
            returnValue = s.advance(buildGapTag());
            break;
          }

          case NullTag: {
            returnValue = s.advance(buildNullTag());
            break;
          }

          case InitializerTag: {
            const { isArray } = tag.value;
            const { reference } = s;

            if (reference?.type !== ReferenceTag) throw new Error();

            returnValue = s.advance(buildInitializerTag(isArray));
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

            returnValue = s.advance(buildShiftTag(index));
            break;
          }

          case OpenNodeTag: {
            const { flags, language, type, attributes } = tag.value;

            if (language && !language.startsWith('https://')) {
              throw new Error('Expected an absolute-language tag');
            }

            returnValue = s.advance(buildOpenNodeTag(flags, language, type, attributes));
            break;
          }

          case CloseNodeTag: {
            for (const { 0: key, 1: value } of Object.entries(s.node.properties)) {
              if (!Array.isArray(value)) {
                if (value.node === undefined) {
                  add(s.node, value.reference, buildNullNode());
                }
              }
            }

            returnValue = s.advance(buildCloseNodeTag());
            break;
          }

          default:
            throw new Error();
        }

        yield returnValue;

        break;
      }

      default: {
        throw new Error(`Unexpected call of {type: ${printExpression(verb)}}`);
      }
    }

    co.advance(returnValue);
  }

  if (s.depth > 0) {
    throw new Error('Did not unwind state stack');
  }

  if (s.path) {
    throw new Error('Did not unwind path stack');
  }

  return s.resultPath.path.node;
}
