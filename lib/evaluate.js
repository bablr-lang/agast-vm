import { Coroutine } from '@bablr/coroutine';
import {
  buildNull,
  buildGap,
  buildReference,
  buildLiteral,
  buildDoctypeTag,
  buildNodeOpenTag,
  buildFragmentOpenTag,
  buildFragmentCloseTag,
  buildNodeCloseTag,
} from '@bablr/agast-helpers/builders';
import { StreamIterable, getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { reifyExpression } from '@bablr/agast-vm-helpers';
import { Path } from './path.js';
import { State } from './state.js';
import { facades } from './facades.js';

export const evaluate = (ctx, strategy) => new StreamIterable(__evaluate(ctx, strategy));

const __evaluate = function* agastStrategy(ctx, strategy) {
  let s = State.from(ctx);

  const co = new Coroutine(getStreamIterator(strategy(facades.get(ctx), facades.get(s))));

  co.advance();

  for (;;) {
    if (co.current instanceof Promise) {
      co.current = yield co.current;
    }

    if (co.done) break;

    const sourceInstr = co.value;
    const instr = reifyExpression(sourceInstr);
    let returnValue = undefined;

    const { verb } = instr;

    switch (verb) {
      case 'branch': {
        const { context, path, result, emitted } = s;

        s = s.push(context, path.branch(), result, emitted);

        returnValue = facades.get(s);
        break;
      }

      case 'accept': {
        const accepted = s;

        s = s.parent;

        if (!s) {
          throw new Error('accepted the root state');
        }

        s.path.accept(accepted.path);

        // emitted isn't used here and probably doesn't need to be part of state

        if (s.depth === 0) {
          yield* s.emit();
        }

        s.result = accepted.result;

        returnValue = facades.get(s);
        break;
      }

      case 'reject': {
        const rejectedState = s;

        s = s.parent;

        if (!s) throw new Error('rejected root state');

        ctx.nextTerminals.delete(s.result);

        if (rejectedState.path.depth > s.path.depth) {
          const lowPath = rejectedState.path.at(
            Math.min(s.path.depth + 1, rejectedState.path.depth),
          );

          const { pathName, pathIsArray } = lowPath.reference?.value || {};

          if (!s.path.resolver.counters.has(pathName) && !lowPath.startTag?.value.flags.trivia) {
            yield* s.emit(buildReference(pathName, pathIsArray));
          }

          if (s.result.type === 'Reference') {
            yield* s.emit(buildNull());
          }
        }

        returnValue = facades.get(s);
        break;
      }

      case 'advance': {
        const { arguments: { 0: terminal } = [] } = instr;

        switch (terminal?.type || 'Null') {
          case 'DoctypeTag': {
            const doctypeTag = buildDoctypeTag(terminal.value.language);

            yield* s.emit(doctypeTag);

            s.path = Path.pushTag(ctx, null, doctypeTag);
            break;
          }

          case 'Literal': {
            const literal = buildLiteral(terminal.value);

            if (!s.path.isToken) {
              throw new Error('literals must occur inside tokens');
            }

            yield* s.emit(literal);
            break;
          }

          case 'Reference': {
            const { pathName, pathIsArray } = terminal.value;

            const tag = buildReference(pathName, pathIsArray);

            if (s.path.isToken) {
              throw new Error();
            }

            s.path.resolver.consume(tag);

            s.path = Path.pushTag(ctx, s.path, tag);

            yield* s.emit(tag);
            break;
          }

          case 'Gap': {
            const reference = s.result;

            if (reference?.type !== 'Reference') throw new Error();

            s.path = s.path.parent;

            const gapTerminal = buildGap();

            yield* s.emit(gapTerminal);
            break;
          }

          case 'Null': {
            const reference = s.result;

            if (reference?.type !== 'Reference') throw new Error();

            s.path = s.path.parent;

            const nullTerminal = buildNull();

            yield* s.emit(nullTerminal);
            break;
          }

          case 'OpenFragmentTag': {
            const { flags } = terminal.value;
            const openTag = buildFragmentOpenTag(flags);

            s.path = Path.pushTag(ctx, s.path, openTag);

            yield* s.emit(openTag);
            break;
          }

          case 'CloseFragmentTag': {
            const closeTag = buildFragmentCloseTag();

            s.path = Path.pushTag(ctx, s.path, closeTag);

            yield* s.emit(closeTag);
            break;
          }

          case 'OpenNodeTag': {
            const { flags, language, type, attributes } = terminal.value;
            const reference = s.result;
            const boundAttributes = Object.entries(attributes).filter((a) => a[1].type !== 'Gap');
            const unboundAttributes = Object.entries(attributes).filter((a) => a[1].type === 'Gap');
            const openTag = buildNodeOpenTag(
              flags,
              language,
              type,
              Object.fromEntries(boundAttributes),
            );

            if (
              reference?.type !== 'Reference' &&
              reference?.type !== 'OpenFragmentTag' &&
              !(flags.trivia || flags.escape)
            )
              throw new Error();

            s.path = Path.pushTag(ctx, s.path, openTag);
            s.path.unboundAttributes = new Map(unboundAttributes);

            ctx.tagPaths.set(openTag, s.path);

            yield* s.emit(openTag);
            break;
          }

          case 'CloseNodeTag': {
            const { type, language } = terminal.value;

            const startType = s.path.type;

            if (s.path.unboundAttributes?.size)
              throw new Error('Grammar failed to bind all attributes');

            if (!type) throw new Error(`CloseNodeTag must have type`);

            if (s.path.depth > 1 && type !== startType)
              throw new Error(
                `Grammar close {type: ${type}} did not match open {type: ${startType}}`,
              );

            const endTag = buildNodeCloseTag(type, language);

            s.path = Path.pushTag(ctx, s.path, endTag);

            yield* s.emit(endTag);
            break;
          }

          default:
            throw new Error();
        }

        returnValue = sourceInstr.properties.arguments.properties.values[0];
        break;
      }

      case 'bindAttribute': {
        const { arguments: { 0: key, 1: value } = [] } = instr;

        const { unboundAttributes } = s.path;

        if (!unboundAttributes || !unboundAttributes.has(key)) {
          throw new Error('No unbound attribute to bind');
        }

        if (s.path.startTag.type === 'OpenFragmentTag') {
          throw new Error();
        }

        if (key === 'span') throw new Error('too late');

        if (key === 'lexicalSpan') {
          throw new Error('not implemented');
        }

        // if (stateIsDifferent) {
        //   // we can't allow effects to cross state branches
        //   throw new Error();
        // }

        unboundAttributes.delete(key);

        const { startTag } = s.path;

        if (value != null) {
          const { flags, language, type } = startTag.value;
          const attributes = { ...startTag.value.attributes, [key]: value };
          const newStartTag = buildNodeOpenTag(flags, language, type, attributes);

          let startNext = ctx.nextTerminals.get(startTag);
          let startPrev = ctx.prevTerminals.get(startTag);

          ctx.prevTerminals.set(newStartTag, startPrev);
          ctx.nextTerminals.set(startPrev, newStartTag);

          ctx.tagPaths.set(newStartTag, s.path);

          if (startNext) {
            ctx.nextTerminals.set(newStartTag, startNext);
            ctx.prevTerminals.set(startNext, newStartTag);
          } else {
            // could this terminal might be stored anywhere else?
            s.result = newStartTag;
          }

          s.path.range[0] = newStartTag;
        }

        // m.range isn't updated yet

        if (!unboundAttributes.size) {
          yield* s.emit();
        }

        returnValue = s.path.range[0];
        break;
      }

      case 'getState': {
        returnValue = facades.get(s);
        break;
      }

      case 'getContext': {
        returnValue = facades.get(ctx);
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

  if (s.path?.depth > 0) {
    throw new Error('Did not unwind path stack');
  }
};
