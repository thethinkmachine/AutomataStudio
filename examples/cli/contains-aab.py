# The same specification in Python: does the word contain aab?
#   python contains-aab.py abaab     one word, as an argument
#   python contains-aab.py < words   --batch: a word per line, an answer per line
import sys

def answer(word):
    return "yes" if "aab" in word else "no"

if len(sys.argv) > 1:
    print(answer(sys.argv[1]))
else:
    for line in sys.stdin.read().splitlines():
        print(answer(line))
