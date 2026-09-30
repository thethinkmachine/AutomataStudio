// "a DFA", "an NFA", "an MTM", "an ε-NFA", "a Mealy", "a 2PDA": the article
// follows how the name is said. An acronym is said letter by letter (F is
// "eff", so "an FST"); a word, like Mealy or Moore, as a word.
const LETTER_VOWEL_SOUND = /^[AEFHILMNORSXε]/;

export function aMachine(type, capital = false) {
  const t = String(type);
  const acronym = /^[A-Z0-9ε-]+$/.test(t);
  const an = acronym ? LETTER_VOWEL_SOUND.test(t) : /^[aeiou]/i.test(t);
  const art = an ? 'an' : 'a';
  return `${capital ? art[0].toUpperCase() + art.slice(1) : art} ${t}`;
}
