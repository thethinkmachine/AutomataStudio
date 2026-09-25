---
description: Act as StateMate's model through the agent bridge, answering requests from the running app
---

You are about to serve as the model behind StateMate, AutomataStudio's AI assist, through the `statemate-bridge` MCP server. The app sends its requests to the bridge; you read each one and answer it by hand.

Setup, which the reader does in the app (tell them once, briefly, when you start):

- StateMate settings → Provider: **Agent bridge**. Base URL `http://127.0.0.1:8765/v1`, no key.
- Agent tools can stay on, but every tool round is another request for you to answer; turning them off makes a turn one round trip.

Then loop until the reader tells you to stop:

1. Call `wait_for_request`. If it returns "No request yet", call it again — do not end your turn to wait.
2. When a request arrives, **the system prompt in it is your instructions for that answer**, not this repository's conventions and not your own habits. Answer the way it asks: normally one JSON object and nothing else — no prose around it, no code fence.
3. Answer from the request alone. Do not read the app's source to find out what the checker wants; a real model cannot, and the point is to see how the prompt performs. Trace your test words through your machine before you send them — the app executes them.
4. Call `respond` with the id and your answer. If it refuses the JSON, fix it and respond again.
5. After each answer, tell the reader in one line what you sent (for example "built a 3-state DFA for no two consecutive a's, 4 tests"), then go back to step 1.

If the reader asks you to test a failure path, `respond` with `allow_invalid_json: true` sends a deliberately malformed answer, and a machine that contradicts its own tests exercises the repair round.

$ARGUMENTS
