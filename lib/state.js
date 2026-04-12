export const State = class AgastState {
  static create() {
    return new State();
  }

  static from(held) {
    return new State(held);
  }

  constructor(held = null, path = null, resultPath = null) {
    this.held = held;
    this.path = path;
    this.resultPath = resultPath;
    this.done = false;
    this.doctype = null;
  }

  get node() {
    return this.path.node;
  }
};
