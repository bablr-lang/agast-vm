import { Coroutine } from '@bablr/coroutine';
import {
  buildNull,
  buildGap,
  buildShift,
  buildReference,
  buildLiteral,
  buildWriteEffect,
  buildDoctypeTag,
  buildNodeOpenTag,
  buildNodeCloseTag,
  buildPanicEffect,
} from '@bablr/agast-helpers/builders';
import { StreamIterable, getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { reifyExpression } from '@bablr/agast-vm-helpers';
import { Path, Node } from './path.js';
import { State } from './state.js';
import { facades } from './facades.js';

export const evaluate = (ctx, strategy, options) =>
  new StreamIterable(__evaluate(ctx, strategy, options));

const __evaluate = function* agast(ctx, strategy, options = {}) {
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

    const { verb, arguments: args = [] } = instr;

    switch (verb) {
      case 'branch': {
        s = s.branch();

        returnValue = facades.get(s);
        break;
      }

      case 'accept': {
        s = s.accept();

        if (s.depth === 0) {
          yield* s.emit();
        }

        returnValue = facades.get(s);
        break;
      }

      case 'reject': {
        s = s.reject();

        returnValue = facades.get(s);
        break;
      }

      case 'panic': {
        s = s.reject();

        if (!s) {
          if (options.emitEffects) {
            yield buildPanicEffect('panic', sourceInstr.type);
            return;
          } else {
            throw new Error('message');
          }
        }
        break;
      }

      case 'advance': {
        const { 0: terminal, 1: options } = args;

        if (
          s.held &&
          !(
            terminal.type === 'OpenNodeTag' ||
            terminal.type === 'Reference' ||
            terminal.type === 'Gap'
          )
        ) {
          throw new Error('Cannot advance while holding');
        }

        switch (terminal?.type || 'Null') {
          case 'DoctypeTag': {
            const { attributes } = terminal.value;
            const doctypeTag = buildDoctypeTag(attributes);
            const rootPath = Path.from(ctx);

            if (s.path) {
              throw new Error();
            }

            s.path = rootPath;

            yield* s.emit(doctypeTag);

            returnValue = doctypeTag;
            break;
          }

          case 'Literal': {
            const literal = buildLiteral(terminal.value);

            if (!s.node.flags.token) {
              throw new Error('literals must occur inside tokens');
            }

            if (s.held) {
              throw new Error('Cannot consume input while hold register is full');
            }

            yield* s.emit(literal);

            returnValue = literal;
            break;
          }

          case 'Reference': {
            const { name, isArray } = terminal.value;

            const tag = buildReference(name, isArray);

            if (s.result.type === 'Reference') {
              throw new Error('A reference must have a non-reference value');
            }

            if (!s.path.depth) {
              throw new Error();
            }

            if (s.node.flags.token) {
              throw new Error();
            }

            s.node.resolver.consume(tag);

            s.path = s.path.push(ctx, tag);

            yield* s.emit(tag);

            returnValue = tag;
            break;
          }

          case 'Gap': {
            const reference = s.result;

            if (reference?.type !== 'Reference') throw new Error();

            s.path = s.path.parent;

            const gapTag = buildGap();

            s.held = null;

            yield* s.emit(gapTag);

            returnValue = gapTag;
            break;
          }

          case 'Shift': {
            const { tagNodes, prevTerminals } = ctx;
            const tag = buildShift();

            const finishedNode = tagNodes.get(s.result);
            const finishedPath = finishedNode.path;

            s.held = { node: finishedNode, path: finishedPath };

            if (!finishedNode.openTag.value.flags.expression) {
              throw new Error();
            }

            s.path = finishedPath;

            yield* s.emit(tag);

            returnValue = tag;
            break;
          }

          case 'Null': {
            const reference = s.result;

            if (reference?.type !== 'Reference') throw new Error();

            s.path = s.path.parent;

            const null_ = buildNull();

            yield* s.emit(null_);

            returnValue = null_;
            break;
          }

          case 'OpenNodeTag': {
            const { flags, language, type, intrinsicValue, attributes } = terminal.value;
            const { unboundAttributes } = options || {};
            const reference = s.result;
            const openTag = buildNodeOpenTag(flags, language, type, intrinsicValue, attributes);

            if (!type) {
              s.node = Node.from(s.path, openTag);
              ctx.tagNodes.set(openTag, s.node);
            } else {
              if (!flags.trivia && !flags.escape && s.node.type) {
                if (
                  reference.type !== 'Reference' &&
                  reference.type !== 'Shift' &&
                  reference.type !== 'OpenFragmentTag'
                ) {
                  throw new Error('Invalid location for OpenNodeTag');
                }
              }

              const { flags: openFlags } = openTag.value;

              if (!(openFlags.trivia || openFlags.escape) && !s.path.depth) {
                const tag = buildReference('root', false);
                s.path = s.path.push(ctx, tag);
                s.node.resolver.consume(tag);
              }

              const newNode = s.node.push(s.path, openTag);

              newNode.unboundAttributes = new Set(unboundAttributes);

              ctx.tagNodes.set(openTag, newNode);

              if (!intrinsicValue) {
                s.node = newNode;
              } else {
                s.path = s.path.parent;

                if (s.path.depth > 1) {
                  const { properties } = s.node;
                  const { name: refName, isArray } = reference.value;

                  if (!isArray) {
                    properties.set(refName, [openTag, openTag]);
                  } else {
                    if (!properties.has(refName)) {
                      properties.set(refName, []);
                    }
                    properties.get(refName).push([openTag, openTag]);
                  }
                }
              }
            }

            yield* s.emit(openTag);

            returnValue = openTag;
            break;
          }

          case 'CloseNodeTag': {
            const { type, language } = terminal.value;
            const { openTag } = s.node;
            const { flags, type: openType } = openTag.value;

            const closeTag = buildNodeCloseTag(type, language);

            if (openType) {
              if (s.node.unboundAttributes?.size)
                throw new Error('Grammar failed to bind all attributes');

              if (!type) throw new Error(`CloseNodeTag must have type`);

              if (s.path.depth > 1 && type !== openType)
                throw new Error(
                  `Grammar close {type: ${type}} did not match open {type: ${openType}}`,
                );

              if (!flags.escape && !flags.trivia) {
                const { name: refName, isArray } = s.path.reference.value;

                // is this right?
                if (s.path.depth > 2) {
                  const { properties } = s.node.parent;

                  if (!isArray) {
                    properties.set(refName, [openTag, closeTag]);
                  } else {
                    if (!properties.has(refName)) {
                      properties.set(refName, []);
                    }
                    properties.get(refName).push([openTag, closeTag]);
                  }
                }
              }

              ctx.tagNodes.set(closeTag, s.node);

              s.node.closeTag = closeTag;

              s.node = s.node.parent;

              if (!(flags.trivia || flags.escape)) {
                s.path = s.path.parent;
              }
            }

            yield* s.emit(closeTag, flags.expression);

            returnValue = closeTag;
            break;
          }

          default:
            throw new Error();
        }

        break;
      }

      case 'bindAttribute': {
        const { 0: key, 1: value } = args;

        const { unboundAttributes } = s.node;

        if (!unboundAttributes || !unboundAttributes.has(key)) {
          throw new Error('No unbound attribute to bind');
        }

        if (!s.node.openTag.value.type) {
          throw new Error('Cannot bind attribute to fragment');
        }

        if (key === 'span') throw new Error('too late');

        if (key === 'balancedSpan') {
          throw new Error('not implemented');
        }

        // if (stateIsDifferent) {
        //   // we can't allow effects to cross state branches
        //   throw new Error();
        // }

        unboundAttributes.delete(key);

        const { openTag } = s.node;

        if (value != null) {
          const { flags, language, type, intrinsicValue } = openTag.value;
          const attributes = { ...openTag.value.attributes, [key]: value };
          const newStartTag = buildNodeOpenTag(flags, language, type, intrinsicValue, attributes);

          let startNext = ctx.nextTerminals.get(openTag);
          let startPrev = ctx.prevTerminals.get(openTag);

          ctx.prevTerminals.set(newStartTag, startPrev);
          ctx.nextTerminals.set(startPrev, newStartTag);

          ctx.tagNodes.set(newStartTag, s.node);

          if (startNext) {
            ctx.nextTerminals.set(newStartTag, startNext);
            ctx.prevTerminals.set(startNext, newStartTag);
          } else {
            // could this terminal be stored anywhere else?
            s.result = newStartTag;
          }

          s.node.openTag = newStartTag;
        }

        if (!unboundAttributes.size) {
          yield* s.emit();
        }

        returnValue = s.node.openTag;
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

      case 'write': {
        if (options.emitEffects) {
          yield buildWriteEffect(args[0], args[1]);
        }
        break;
      }

      default: {
        throw new Error(`Unexpected call of {type: ${printExpression(verb)}}`);
      }
    }

    co.advance(returnValue);
  }

  s.path = s.path.parent;

  if (s.depth > 0) {
    throw new Error('Did not unwind state stack');
  }

  if (s.path?.depth > 0) {
    throw new Error('Did not unwind path stack');
  }
};
