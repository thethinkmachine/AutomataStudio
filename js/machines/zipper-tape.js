// ══════════════════════════════════════════════════════════════════
//  A TAPE A SEARCH CAN BRANCH ON
// ══════════════════════════════════════════════════════════════════
// The nondeterministic Turing machine forks a configuration per matching
// transition, and with js/tape.js that meant copying the fork's whole tape
// (a Map of every cell) and then spelling it out as a string to ask whether
// the search had been there before — twice the tape per configuration, so a
// search slowed down in proportion to how far its heads had travelled.
//
// A tape is also a zipper: the cells left of the head as a stack whose top is
// the cell beside the head, the cell under the head, and the cells to its
// right as a second stack. A move pops one stack and pushes the other, a write
// replaces one symbol, and a fork is a new object holding the same three
// things. With the stacks as interned nodes (js/machines/step-log.js) the
// configuration is named exactly by (state, left.id, head symbol, right.id).
//
// **The two stacks are kept to exactly key()'s window.** Tape#key trims
// blanks past the last written cell on the right, and on a two-way tape
// starts at the leftmost written cell or the head; so a blank is never pushed
// onto an empty right stack, and never onto an empty left stack on a two-way
// tape. That makes "same ids" and "same key()" the same test.
//
// It serves only the search. It has no end markers and no right bound (the
// NDTM's tape has neither), and a word that *contains* the blank is left to
// js/tape.js: there a written blank and an unwritten cell differ at the left
// edge of key()'s window, a distinction a zipper that trims blanks cannot see.

import { stackArray, stackPush, stackRoot } from './step-log.js';

export class ZipperTape {
  /** Whether a zipper can stand in for Tape on this word. */
  static fits(tokens, blank) {
    return !tokens.some(sym => sym === blank);
  }

  constructor(tokens, blank, twoWay, root = stackRoot()) {
    this.blank = blank;
    this.twoWay = !!twoWay;
    this.head = 0;
    this.left = root;
    this.cell = tokens.length ? tokens[0] : blank;
    let right = root;
    for (let i = tokens.length - 1; i >= 1; i--) right = stackPush(right, tokens[i]);
    this.right = right;
  }

  read() { return this.cell; }

  write(sym) { this.cell = sym; return true; }

  move(dir) {
    if (dir === 'R') {
      if (this.left.length || this.cell !== this.blank || !this.twoWay) this.left = stackPush(this.left, this.cell);
      const r = this.right;
      this.cell = r.length ? r.sym : this.blank;
      if (r.length) this.right = r.below;
      this.head++;
      return true;
    }
    if (dir === 'L') {
      if (!this.twoWay && this.head === 0) return false;
      if (this.right.length || this.cell !== this.blank) this.right = stackPush(this.right, this.cell);
      const l = this.left;
      this.cell = l.length ? l.sym : this.blank;
      if (l.length) this.left = l.below;
      this.head--;
      return true;
    }
    return true;
  }

  clone() {
    const copy = Object.create(ZipperTape.prototype);
    copy.blank = this.blank; copy.twoWay = this.twoWay; copy.head = this.head;
    copy.left = this.left; copy.cell = this.cell; copy.right = this.right;
    return copy;
  }

  /** What Tape#snapshot answers: the window, the head's index into it, its first cell. */
  snapshot() {
    const tape = stackArray(this.left).slice();
    tape.push(this.cell);
    const right = stackArray(this.right);
    for (let i = right.length - 1; i >= 0; i--) tape.push(right[i]);
    // Trailing blanks past the head are not part of the window (Tape keeps no
    // cell for them); the head's own cell always is.
    while (tape.length > this.left.length + 1 && tape[tape.length - 1] === this.blank) tape.pop();
    return { tape, head: this.left.length, origin: this.head - this.left.length };
  }

  view() {
    const { tape, head, origin } = this.snapshot();
    return {
      kind: 'tape',
      cells: tape,
      head,
      origin,
      leftBound: this.twoWay ? null : 0,
      rightBound: null,
      markers: [],
      blank: this.blank,
      readOnly: false
    };
  }

  key() {
    const { tape, head } = this.snapshot();
    return `${head}|${tape.join('\u0001')}`;
  }
}
