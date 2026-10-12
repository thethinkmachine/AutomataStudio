// The machines the Universal Turing Machine card offers to emulate, in the
// JSON description it reads: states[], start, accept[], and transitions of
// {from, read, write?, dir, to}. `write` defaults to what was read.
//
// Data only, so the card's module is the code that runs them.

export const UTM_EXAMPLES = [
  {
    label: "0ⁿ1ⁿ Recognizer (default)",
    input: "0001111",
    tm: {
      "comment": "Accepts {0^n 1^n | n >= 1}",
      "states": ["q0", "q1", "q2", "q3", "q_accept"],
      "start": "q0",
      "accept": ["q_accept"],
      "transitions": [
        { "from": "q0", "read": "0", "write": "X", "dir": "R", "to": "q1" },
        { "from": "q1", "read": "0", "write": "0", "dir": "R", "to": "q1" },
        { "from": "q1", "read": "Y", "write": "Y", "dir": "R", "to": "q1" },
        { "from": "q1", "read": "1", "write": "Y", "dir": "L", "to": "q2" },
        { "from": "q2", "read": "0", "write": "0", "dir": "L", "to": "q2" },
        { "from": "q2", "read": "Y", "write": "Y", "dir": "L", "to": "q2" },
        { "from": "q2", "read": "X", "write": "X", "dir": "R", "to": "q0" },
        { "from": "q0", "read": "Y", "write": "Y", "dir": "R", "to": "q3" },
        { "from": "q3", "read": "Y", "write": "Y", "dir": "R", "to": "q3" },
        { "from": "q3", "read": "⊔", "write": "⊔", "dir": "R", "to": "q_accept" }
      ]
    }
  },
  {
    label: "Binary Evenness Checker",
    input: "10110",
    tm: {
      "name": "Binary Evenness Checker",
      "states": ["q0", "q_last_0", "q_last_1", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q0", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_0", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q_last_0", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_0", "read": "⊔", "dir": "R", "to": "q_acc" },
        { "from": "q_last_1", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q_last_1", "read": "1", "dir": "R", "to": "q_last_1" }
      ]
    }
  },
  {
    label: "Binary Oddness Checker",
    input: "10111",
    tm: {
      "name": "Binary Oddness Checker",
      "states": ["q0", "q_last_0", "q_last_1", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q0", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_0", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q_last_0", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_1", "read": "0", "dir": "R", "to": "q_last_0" },
        { "from": "q_last_1", "read": "1", "dir": "R", "to": "q_last_1" },
        { "from": "q_last_1", "read": "⊔", "dir": "R", "to": "q_acc" }
      ]
    }
  },
  {
    label: "Binary Adder (+1)",
    input: "1011",
    tm: {
      "name": "Binary Adder (+1)",
      "states": ["q0", "q_right", "q_carry", "q_rewind", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "dir": "R", "to": "q_right" },
        { "from": "q0", "read": "1", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "0", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "1", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "⊔", "dir": "L", "to": "q_carry" },
        { "from": "q_carry", "read": "1", "write": "0", "dir": "L", "to": "q_carry" },
        { "from": "q_carry", "read": "0", "write": "1", "dir": "L", "to": "q_rewind" },
        { "from": "q_carry", "read": "⊔", "write": "1", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "0", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "1", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "⊔", "dir": "R", "to": "q_acc" }
      ]
    }
  },
  {
    label: "Binary Subtractor (-1)",
    input: "1100",
    tm: {
      "name": "Binary Subtractor (-1)",
      "states": ["q0", "q_right", "q_borrow", "q_rewind", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "dir": "R", "to": "q_right" },
        { "from": "q0", "read": "1", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "0", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "1", "dir": "R", "to": "q_right" },
        { "from": "q_right", "read": "⊔", "dir": "L", "to": "q_borrow" },
        { "from": "q_borrow", "read": "0", "write": "1", "dir": "L", "to": "q_borrow" },
        { "from": "q_borrow", "read": "1", "write": "0", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "0", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "1", "dir": "L", "to": "q_rewind" },
        { "from": "q_rewind", "read": "⊔", "dir": "R", "to": "q_acc" }
      ]
    }
  },
  {
    label: "Unary Multiplier",
    input: "11*111",
    tm: {
      "name": "Unary Multiplier",
      "states": ["q0", "q_mark_left", "q_find_right", "q_copy", "q_return_copy", "q_reset_right", "q_return_left", "q_cleanup", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "1", "write": "X", "dir": "R", "to": "q_find_right" },
        { "from": "q0", "read": "*", "write": "⊔", "dir": "R", "to": "q_cleanup" },
        { "from": "q_find_right", "read": "1", "dir": "R", "to": "q_find_right" },
        { "from": "q_find_right", "read": "*", "dir": "R", "to": "q_copy" },
        { "from": "q_copy", "read": "1", "write": "Y", "dir": "R", "to": "q_return_copy" },
        { "from": "q_copy", "read": "Y", "dir": "R", "to": "q_copy" },
        { "from": "q_copy", "read": "=", "dir": "R", "to": "q_reset_right" },
        { "from": "q_copy", "read": "⊔", "write": "=", "dir": "L", "to": "q_reset_right" },
        { "from": "q_return_copy", "read": "1", "dir": "R", "to": "q_return_copy" },
        { "from": "q_return_copy", "read": "=", "dir": "R", "to": "q_return_copy" },
        { "from": "q_return_copy", "read": "⊔", "write": "1", "dir": "L", "to": "q_return_left" },
        { "from": "q_return_left", "read": "1", "dir": "L", "to": "q_return_left" },
        { "from": "q_return_left", "read": "=", "dir": "L", "to": "q_return_left" },
        { "from": "q_return_left", "read": "Y", "write": "Y", "dir": "R", "to": "q_copy" },
        { "from": "q_reset_right", "read": "Y", "write": "1", "dir": "L", "to": "q_reset_right" },
        { "from": "q_reset_right", "read": "*", "dir": "L", "to": "q_reset_right" },
        { "from": "q_reset_right", "read": "1", "dir": "L", "to": "q_reset_right" },
        { "from": "q_reset_right", "read": "X", "dir": "R", "to": "q0" },
        { "from": "q_cleanup", "read": "1", "write": "⊔", "dir": "R", "to": "q_cleanup" },
        { "from": "q_cleanup", "read": "=", "write": "⊔", "dir": "R", "to": "q_cleanup" },
        { "from": "q_cleanup", "read": "X", "write": "⊔", "dir": "R", "to": "q_cleanup" },
        { "from": "q_cleanup", "read": "⊔", "dir": "R", "to": "q_acc" }
      ]
    }
  },
  {
    label: "Binary Palindrome Checker",
    input: "101101",
    tm: {
      "name": "Binary Palindrome Checker",
      "states": ["q0", "q_scan_right_0", "q_scan_right_1", "q_check_0", "q_check_1", "q_scan_left", "q_acc"],
      "start": "q0",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "q0", "read": "0", "write": "⊔", "dir": "R", "to": "q_scan_right_0" },
        { "from": "q0", "read": "1", "write": "⊔", "dir": "R", "to": "q_scan_right_1" },
        { "from": "q0", "read": "⊔", "write": "⊔", "dir": "R", "to": "q_acc" },
        { "from": "q_scan_right_0", "read": "0", "dir": "R", "to": "q_scan_right_0" },
        { "from": "q_scan_right_0", "read": "1", "dir": "R", "to": "q_scan_right_0" },
        { "from": "q_scan_right_0", "read": "⊔", "dir": "L", "to": "q_check_0" },
        { "from": "q_scan_right_1", "read": "0", "dir": "R", "to": "q_scan_right_1" },
        { "from": "q_scan_right_1", "read": "1", "dir": "R", "to": "q_scan_right_1" },
        { "from": "q_scan_right_1", "read": "⊔", "dir": "L", "to": "q_check_1" },
        { "from": "q_check_0", "read": "0", "write": "⊔", "dir": "L", "to": "q_scan_left" },
        { "from": "q_check_0", "read": "⊔", "dir": "R", "to": "q_acc" },
        { "from": "q_check_1", "read": "1", "write": "⊔", "dir": "L", "to": "q_scan_left" },
        { "from": "q_check_1", "read": "⊔", "dir": "R", "to": "q_acc" },
        { "from": "q_scan_left", "read": "0", "dir": "L", "to": "q_scan_left" },
        { "from": "q_scan_left", "read": "1", "dir": "L", "to": "q_scan_left" },
        { "from": "q_scan_left", "read": "⊔", "dir": "R", "to": "q0" }
      ]
    }
  },
  {
    label: "3-State Busy Beaver",
    input: "",
    tm: {
      "name": "3-State Busy Beaver",
      "states": ["qA", "qB", "qC", "q_acc"],
      "start": "qA",
      "accept": ["q_acc"],
      "transitions": [
        { "from": "qA", "read": "⊔", "write": "1", "dir": "R", "to": "qB" },
        { "from": "qA", "read": "1", "write": "1", "dir": "R", "to": "q_acc" },
        { "from": "qB", "read": "⊔", "write": "⊔", "dir": "R", "to": "qC" },
        { "from": "qB", "read": "1", "write": "1", "dir": "R", "to": "qB" },
        { "from": "qC", "read": "⊔", "write": "1", "dir": "L", "to": "qC" },
        { "from": "qC", "read": "1", "write": "1", "dir": "L", "to": "qA" }
      ]
    }
  }
];

