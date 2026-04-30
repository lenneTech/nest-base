# CLAUDE.md — `src/core/realtime/`

Socket.IO gateway, channel-permission filter, the in-memory inspector
state, and the cross-instance LISTEN/NOTIFY transport (Realtime
Service). The whole subsystem is template-owned — every project that
consumes the template ships with the same wire-up.

## Layout

```
realtime/
├── socket-gateway.ts        ← handshake + per-socket subscribe/dispatch
├── channel-permission.ts    ← parseChannelName + canSubscribeToChannel (CASL)
├── channel-filter.ts        ← per-record CASL gate at broadcast time
├── realtime.service.ts      ← cross-instance LISTEN/NOTIFY service
├── realtime.module.ts       ← Nest gateway + InspectorEvents bus
├── inspector-state.ts       ← pure planner — sockets / channels / events
└── inspector-filter.ts      ← pure helpers — pattern compile + payload mask
```

## Pure-planner / thin-runner split

- `inspector-state.ts` is a pure class — no NestJS lifecycle, no I/O.
  Tests run without booting the app.
- `inspector-filter.ts` is two pure functions: `parseChannelPattern`
  (escape + wildcard expansion) and `maskPayload` (PII redaction +
  truncation).
- `realtime.module.ts` (the Gateway) is the runner — it calls into
  the planner on every Socket.IO lifecycle event and emits parallel
  events on the `InspectorEvents` bus for the admin live-push surface.

## Privacy rule (issue #20)

**Every payload broadcast through `RealtimeGateway.broadcast()` is
piped through `maskPayload()` before it lands in the inspector
ringbuffer.** Production payloads can carry PII (email, password,
token, …) and the inspector ringbuffer is dev-only — but masking is
defence-in-depth: the mask preserves shape so debugging works, while
known-PII keys (`email`, `password`, `token`, `secret`,
`authorization`, `phone`, `ssn`, …) get replaced with `[redacted]`
case-insensitively at any depth, and strings longer than 200 chars
are truncated.

`maskPayload(payload, { disableMasking: true })` is the explicit
opt-out that the operator can toggle from the inspector once the
follow-up "raw payloads" issue lands. **Never disable masking in
production.** The dev-only gate on `/admin/realtime` (and on the
follow-up `/__inspector` Socket.IO namespace) is the second line of
defence.

## Inspector state semantics

- The event ringbuffer is bounded (default 500). New events are
  pushed to the front; the tail is dropped on overflow. Long-running
  dev sessions can never exhaust the heap.
- `snapshotChannels()` aggregates from two sources: the per-socket
  subscription set (live subscribers) and the event ringbuffer (last
  hour). Channels with no subscribers but recent dispatches still
  show up so the operator can see "events into the void".
- `eventsPerSecond()` is a 5-second sliding average; the inspector
  hero displays this as a live stat.

## Don't add here

- **End-to-end auth** — handshake auth is `SocketGateway`'s job, not
  the inspector's. The inspector trusts whatever identity the gateway
  attaches.
- **Persisted history** — explicitly out of scope for issue #20. The
  ringbuffer is in-memory; cross-process aggregation lands with the
  Redis-adapter scaling story.
- **GraphQL bridges, vendor-specific adapters** — the realtime
  surface is REST + Socket.IO. Anything else belongs in
  `src/modules/`.
