import { Coroutine } from '@bablr/coroutine';
import {
  buildReference,
  buildLiteral,
  buildNodeOpenTag,
  buildFragmentOpenTag,
  buildFragmentCloseTag,
  buildNodeCloseTag,
} from '@bablr/agast-helpers/builders';
import { printExpression } from '@bablr/agast-helpers/print';
import { reifyExpression, buildNull } from '@bablr/agast-vm-helpers';
import { Path } from './path.js';
import { State } from './state.js';
import { facades } from './facades.js';

export const evaluate = (ctx, strategy) => () => __evaluate(ctx, strategy);

function* __evaluate(ctx, strategy) {
  let s = State.from(ctx);

  const co = new Coroutine(strategy(facades.get(ctx), facades.get(s)));

  co.advance();

  while (!co.done) {
    const instr = reifyExpression(co.value);
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

        ctx.nextTerminals.delete(s.result);

        if (!s) throw new Error('rejected root state');

        if (rejectedState.path.depth > s.path.depth) {
          const lowPath = rejectedState.path.at(
            Math.min(s.path.depth + 1, rejectedState.path.depth),
          );

          const { pathName, pathIsArray } = lowPath?.reference?.value || {};

          if (!s.path.resolver.counters.has(pathName)) {
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

        switch (terminal.type) {
          case 'Literal': {
            const literal = buildLiteral(terminal.value);

            if (s.path.startTag.value.flags.token && s.result.type !== 'OpenNodeTag') {
              throw new Error('invalid token node');
            }

            yield* s.emit(literal);

            returnValue = literal;
            break;
          }

          case 'Reference': {
            const { pathName, pathIsArray } = terminal.value;

            const tag = buildReference(pathName, pathIsArray);

            s.path.resolver.consume(tag);

            s.path = Path.pushTag(ctx, s.path, tag);

            yield* s.emit(tag);

            returnValue = tag;
            break;
          }

          case 'Gap': {
            if (!s.path.range[0] || s.path.range[1]) {
              throw new Error();
            }

            const nullTerminal = buildNull();

            yield* s.emit(nullTerminal);

            returnValue = nullTerminal;
            break;
          }

          case 'OpenFragmentTag': {
            const { flags } = terminal.value;
            const openTag = buildFragmentOpenTag(flags);

            s.path = Path.pushTag(ctx, s.path, openTag);

            ctx.tagPaths.set(openTag, s.path);

            yield* s.emit(openTag);

            returnValue = openTag;
            break;
          }

          case 'CloseFragmentTag': {
            const closeTag = buildFragmentCloseTag();

            s.path = Path.pushTag(ctx, s.path, closeTag);

            yield* s.emit(closeTag);

            returnValue = closeTag;
            break;
          }

          case 'OpenNodeTag': {
            const { flags, type, attributes } = terminal.value;
            const reference = s.result;
            const openTag = buildNodeOpenTag(flags, type, attributes);

            if (reference?.type !== 'Reference' && !flags.trivia) throw new Error();

            s.path = Path.pushTag(ctx, s.path, openTag);

            ctx.tagPaths.set(openTag, s.path);

            yield* s.emit(openTag);

            returnValue = openTag;
            break;
          }

          case 'CloseNodeTag': {
            const { type } = terminal.value;

            const startType = s.path.type;

            if (s.path.unboundAttributes.size)
              throw new Error('Grammar failed to bind all attributes');

            if (type != null && type !== startType)
              throw new Error('Grammar close type did not match open type');

            const endTag = buildNodeCloseTag(type);

            s.path = Path.pushTag(ctx, s.path, endTag);

            yield* s.emit(endTag);

            returnValue = endTag;
            break;
          }

          default:
            throw new Error();
        }

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
          // I don't think lexical spans are currently applied correctly at all
        }

        // if (stateIsDifferent) {
        //   // we can't allow effects to cross state branches
        //   throw new Error();
        // }

        unboundAttributes.delete(key);

        const { startTag } = s.path;

        if (value != null) {
          const { flags, type } = startTag.value;
          const attributes = { ...startTag.value.attributes, [key]: value };
          const newStartTag = buildNodeOpenTag(flags, type, attributes);

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
}
