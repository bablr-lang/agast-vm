import { getRange, getOpenTag, getCloseTag } from '@bablr/agast-helpers/tree';
import { facades, actuals } from './facades.js';

export const NodeFacade = class AgastNodeFacade {
  constructor(path) {
    facades.set(path, this);
  }

  get language() {
    return actuals.get(this).language;
  }

  get type() {
    return actuals.get(this).type;
  }

  get range() {
    return getRange(actuals.get(this));
  }

  get openTag() {
    return getOpenTag(actuals.get(this));
  }

  get closeTag() {
    return getCloseTag(actuals.get(this));
  }

  get flags() {
    return actuals.get(this).flags;
  }

  get attributes() {
    return actuals.get(this).attributes;
  }
};
