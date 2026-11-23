# token-meter code notes

`packages/llm/token-meter/src/index.ts:TokenMeter::_foldEvent` (finding 118): the meter keeps its own copy of each surface node's image blocks and marks them from `image/offload` events. `image/restore` is the inverse and must delete the `offloaded` key from the named occurrences; without it a restored image would keep being priced as its placeholder text although the next request sends the image.
