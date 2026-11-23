# action-cards code notes

## packages/experimental/action-cards/src/index.ts:ActionCards::coalesce (issue 196)

The in-flight key was the Agent and card id alone, so a second `dismiss`, `cancel`, or differently parameterized `create` on the same card received the first operation's promise and its own choice was never handled, while the second view showed an acknowledgement. The entry now stores the verb and a key-sorted JSON of the payload next to the promise. An identical request still shares the running operation; a different verb or payload is answered `refused` with reason `busy` and runs nothing, so the second view refreshes and the user chooses again. Client cards render any unknown reason as unavailable, so `busy` needs no new client copy. The signature is computed from the caller's payload before the kind validates it, so two payloads that the kind would treat alike but that differ as JSON are also refused as busy.
