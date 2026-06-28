# Changelog

## [0.4.0](https://github.com/cveld/claude-code-dashboard/compare/v0.3.0...v0.4.0) (2026-06-28)


### Features

* gallery responsive viewer with phone device presets ([c1a3ba6](https://github.com/cveld/claude-code-dashboard/commit/c1a3ba635dd1ab8cbb4e3e6dd9052d9c08274f11))
* **mobile:** improve sessions list mobile experience ([a91fd81](https://github.com/cveld/claude-code-dashboard/commit/a91fd81c3675d4fda5671075b95b09e65278dd93))
* natural scroll on list pages for mobile address bar hiding ([dbfd7a9](https://github.com/cveld/claude-code-dashboard/commit/dbfd7a908139e6f333fcf8eb7c780df1305ab2db))

## [0.3.0](https://github.com/cveld/claude-code-dashboard/compare/v0.2.0...v0.3.0) (2026-06-25)


### Features

* add /gallery dev route for UI state validation ([163e945](https://github.com/cveld/claude-code-dashboard/commit/163e9457eaf41aa4b9f219447e03b17589db467f))
* copy path button and transcript scroll improvements ([95e5cb3](https://github.com/cveld/claude-code-dashboard/commit/95e5cb33c2b3fbab9720b9eb89325786518b1a62))
* promote send-message to core feature + show session GUID in dialog ([b17a7d2](https://github.com/cveld/claude-code-dashboard/commit/b17a7d29521f46d70d0bf7ffc66f0dc5cd41be55))
* resolve displayPath from cwd field in jsonl ([2386bcb](https://github.com/cveld/claude-code-dashboard/commit/2386bcb5f92a303ae35ea4e9da2708611c7003f4))
* show app version on settings page ([c0a3c99](https://github.com/cveld/claude-code-dashboard/commit/c0a3c999d2d3a178739a58044fa69a7c17ba2fbb))
* show unread counts per project in filter dropdown ([1cdbbdd](https://github.com/cveld/claude-code-dashboard/commit/1cdbbdd5545af87169f7fe7bd22d866c797eadcb))
* sticky header on all list pages + e2e test ([7235d1a](https://github.com/cveld/claude-code-dashboard/commit/7235d1a2ee937459780b187a9d025ed433181dc8))
* sticky user message strip in transcript view ([980309c](https://github.com/cveld/claude-code-dashboard/commit/980309cbaf56ff8ee9d3198a3d5cea9f378d5b5b))
* styled tooltip on refresh counter + About section on settings page ([838c187](https://github.com/cveld/claude-code-dashboard/commit/838c187288cbc584c9141010d0af8ef1cba34955))
* targeted SSE refresh, refresh counter, and mark-read button styling ([5ac7acd](https://github.com/cveld/claude-code-dashboard/commit/5ac7acdd200b6e65aed13fdee78d53e5cd1dc5dd))
* token usage badge in nav — 5h/7d windows from Anthropic OAuth API ([3594c9e](https://github.com/cveld/claude-code-dashboard/commit/3594c9e733a8879645baf475ede41ec9a741082e))
* token usage badge on session detail page + extract resolveCwd ([2043fda](https://github.com/cveld/claude-code-dashboard/commit/2043fda8d6fed7a921a249b7ddd321a2175049bb))
* transcript table overflow fix, e2e screenshot tooling, and dev config ([74dd74e](https://github.com/cveld/claude-code-dashboard/commit/74dd74ebd9237d8eac690fd2c6b9077f03c85b44))


### Bug Fixes

* base lastActivity on last real message timestamp, not file mtime ([1391c4f](https://github.com/cveld/claude-code-dashboard/commit/1391c4fab0b86b23057c5df0d0cf1d6242ed53fe))
* improve timestamp readability in transcript balloons ([3794c44](https://github.com/cveld/claude-code-dashboard/commit/3794c440812eb18dc6e6501756cde20f3ce76ef8))
* include cache tokens in context window percentage ([d621c6c](https://github.com/cveld/claude-code-dashboard/commit/d621c6c1e890fff7a3eda39af5129d023d54e21e))
* persist hook events across reloads and improve HookBadge read state ([8702d34](https://github.com/cveld/claude-code-dashboard/commit/8702d34c2a4492ec78d02436f62c8a491b37b4d6))
* preserve sort order when navigating back to sessions page ([590a9c4](https://github.com/cveld/claude-code-dashboard/commit/590a9c43482ca95195e95992993db18cfa461ef8))
* reliable foreground focus via keybd_event ALT trick on Windows ([9b9859a](https://github.com/cveld/claude-code-dashboard/commit/9b9859a1903c81547de77885b933661555caee57))
* stop orphaned heartbeat when monitor parent process is killed ([add93e8](https://github.com/cveld/claude-code-dashboard/commit/add93e8c86935c55c0082ab17346f764ad9465ec))
* use Monitor tool (not Bash) for persistent session inbox watcher ([7d767d9](https://github.com/cveld/claude-code-dashboard/commit/7d767d914537b84ade1d5a229672da60124aec0a))
* use python instead of python3 in session inbox monitor command ([675a115](https://github.com/cveld/claude-code-dashboard/commit/675a11565ae29219f8849e0584f5f1b5728ed82c))

## [0.2.0](https://github.com/cveld/claude-code-dashboard/compare/v0.1.0...v0.2.0) (2026-06-20)


### Features

* IDE window detection, focus-to-foreground, and docs updates ([4619cf1](https://github.com/cveld/claude-code-dashboard/commit/4619cf14a61c6ca7f8dffa7486dba92dc2ace418))
* publish to npm via npx with release-please pipeline ([abbee8f](https://github.com/cveld/claude-code-dashboard/commit/abbee8f442482d353222d8dbc2e59eb81d3c0979))
