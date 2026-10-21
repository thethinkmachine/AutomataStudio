// The specification fuzz and learn check against: does the word contain aab?
//
//   node contains-aab.mjs abaab      one word, as an argument (fuzz's {} or
//                                    the word appended): answers yes or no
//   node contains-aab.mjs < words    --batch: a word per line in, an answer
//                                    per line out — one process for them all
import { readFileSync } from 'node:fs';

const answer = word => (word.includes('aab') ? 'yes' : 'no');
if (process.argv.length > 2) console.log(answer(process.argv[2]));
else {
  const lines = readFileSync(0, 'utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  console.log(lines.map(answer).join('\n'));
}
