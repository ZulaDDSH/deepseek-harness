# ui-approval code notes

`packages/client/ui-approval/src/client/ApprovalCard.tsx:ApprovalFlow` (finding 302): a caller that sets `detailRequired` (the tool approval panel) gets a visible `detail.unavailable` notice whenever the correlated operation detail is missing: no call ID, no provider for the detail slot, or the provider reports through `onAvailability` that no usable call was found. The allow actions stay enabled on purpose. Approvals can legitimately concern calls that never appear in this Session's Chat snapshot, such as a subagent's, and blocking them would strand the request; the rejection path is untouched and the notice qualifies the decision instead. Application consent, which has no correlated call, does not set the flag and shows no notice.

`packages/client/ui-approval/src/client/ApprovalPanel.tsx:ApprovalPanel` (finding 302): requests `detailRequired` on the shared card for every tool approval.

`packages/client/ui-approval/src/client/contract/slots.ts:ApprovalDetailOwnerProps` (finding 302): the optional `onAvailability` callback lets the detail provider report whether it found a usable correlated call; it is called with false while the call is absent, not yet started, settled or malformed.

`packages/client/ui-approval/src/client/contract/slots.ts:ApprovalCardInput` (finding 302): the optional `detailRequired` flag asks the card to show the unavailable notice when the correlated operation detail is missing.
