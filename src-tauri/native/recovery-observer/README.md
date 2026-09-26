# Recovery observer — experimental Windows helper

This independent std-only Rust executable is a development component, NOT wired into the application or distributed release. No service, administrator privilege, PID-based lookup/kill, network or worker configuration is used.

## Handle protocol v1

Arguments in exact order: `owner-process job ready-event stop-event done-event receipt-file lease-handle[,lease-handle...] activity-token`.
All handles must be independently inherited duplicates in an explicit Windows HANDLE_LIST. The observer is **outside** the Job being observed. Owner needs SYNCHRONIZE + QUERY_LIMITED_INFORMATION. Job needs QUERY + TERMINATE; events need SYNCHRONIZE + MODIFY_STATE; receipt is a newly created empty writable disk file; leases are already acquired disk-file lock handles. Token is a fresh 32-digit hex activity identity. Do not pass arbitrary handles from untrusted messages or reopen an owner by PID.

Host ordering:
1. Acquire resources and persist identity/admission state. Create the empty Job, nonsignalled events and empty receipt; keep originals held.
2. Duplicate ONLY the exact capabilities above, start observer with HANDLE_LIST, close temporary inheritable duplicates, wait for READY and watch observer process handle. No worker runs before READY.
3. Atomically create workers with JOB_LIST in that already-observed Job. Keep original resource/Job handles until task termination is confirmed. Root exit is not tree exit.
4. Before signalling STOP, irrevocably close task spawn admission. Observer death must not be interpreted as success: the still-live host must retain resources and stop/observe its own Job or transfer custody to a replacement via a defined handshake.
5. Observer reacts to STOP or the exact owner-process handle becoming signalled. It terminates only the exact Job, waits for ActiveProcesses==0, writes and flushes the matching receipt, signals DONE and then releases handles. Observation or write errors after READY retain custody and retry.
6. A future caller must validate receipt schema/identity, account for all readers and modifiers, and serialize recovered state with component mutation. DONE alone, an empty Job before admission closes, a released OS file lock, root exit, elapsed time, or observer exit is NOT sufficient.

Receipt content: `{"version":1,"activity":"<32-digit-token>","state":"job-empty"}`. New receipt belongs to exactly one registered activity. Missing/partial/wrong-identity content cannot certify completion. This is a cooperative capability protocol, not an authenticity boundary against other programs running as the same user.

## Known unimplemented integration

- Host launcher/admission and production component lease integration, shared-reader recovery, Rust/Python common journal schema and UI recovery handling.
- Both host and observer dying without a complete receipt: retain UNKNOWN; no automatic safe recovery has been implemented. Tests intentionally show that kernel leases can disappear while the record remains unconfirmed. Permanently busy or asking users to delete records is not an accepted final UX.
- Observer restart, suspended/unresponsive guardian, OS restart/boot identity, disks full/offline, power-loss persistence, update packaging and installed-environment validation.
- KILL_ON_JOB_CLOSE plus an existing receipt is NOT a universal safety proof. Do not enable journal blocking in the production acquire path until recovery is complete and tested.

Build only this manifest offline/locked. Do not overwrite any frozen evidence directory. Current isolated evidence is `_verify/native-shrink/recovery-observer-g15-20260920/`.
