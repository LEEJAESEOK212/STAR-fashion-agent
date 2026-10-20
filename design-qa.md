# Codex-style floating sidebar design QA

- Date: 2026-10-19
- Source visual truth: `C:/Users/이재석/AppData/Local/Temp/codex-clipboard-0da60472-a524-4e69-a95a-83722f591760.png`
- Previous implementation evidence: `C:/Users/이재석/AppData/Local/Temp/codex-clipboard-bb893475-1c07-4c8e-89b5-b8daef9e80eb.png`
- Implementation target: `apps/web/app/components/chat-sidebar.tsx` and `apps/web/app/globals.css`
- Source pixels: 943 × 1408; desktop app state; density normalization not required for structural comparison
- Intended implementation viewport: responsive desktop browser, authenticated chat state
- Implementation screenshot: unavailable — the isolated in-app browser has no Brown-Chat login session, and the logged-in Chrome surface is unavailable to computer control
- State: floating or pinned sidebar open beside an existing chat; closed state keeps the chat visible

## Full-view comparison evidence

- The source uses a narrow fixed rail and a separate white panel with a subtle border, rounded corners, and no reflow of the content behind it.
- The implementation now uses a 58px rail and a 264px floating panel positioned over the unchanged chat region.
- The panel can stay as a non-reflowing overlay or be pinned into a 338px layout track without removing the chat.
- Browser-rendered authenticated evidence is unavailable, so the full-view comparison remains blocked.

## Focused region comparison evidence

- Source focus: upper-left rail and panel header.
- Implementation focus: 42px rail button with the supplied Brown-Chat star asset; panel starts at 66px with a 14px radius and 1px neutral border.
- Interaction focus: star click opens and closes the panel with a horizontal slide; the panel-header pin toggles fixed and floating layouts; hover and vertical drag do nothing.
- Visual comparison is blocked because the authenticated implementation region could not be captured.

## Required fidelity surfaces

- Fonts and typography: existing Brown-Chat font stack retained; panel heading simplified to a single Brown-Chat wordmark.
- Spacing and layout rhythm: narrow 58px rail, 10px panel inset, 264px panel width, 14px radius, compact 39px new-chat row.
- Colors and visual tokens: neutral gray rail and white floating panel follow the Codex reference while the brown star preserves Brown-Chat identity.
- Image quality and asset fidelity: the supplied `/brown-chat-mark-v3.png` is used directly; no replacement CSS or handcrafted asset was introduced.
- Copy and content: existing projects, conversations, pinned threads, menus, profile, and `새 대화` copy remain intact; the header adds an accessible pin/unpin control.

## Findings

- [P1] Authenticated visual capture unavailable
  - Location: deployed `/chat` screen.
  - Evidence: public health and route return HTTP 200, but the QA browser redirects to sign-in and the connected Chrome browser is unavailable.
  - Impact: the final pin control and horizontal slide cannot be compared from a rendered authenticated screenshot.
  - Fix: capture the refreshed authenticated chat screen, then compare it with the Codex reference and adjust remaining spacing if needed.

## Comparison history

- Initial finding: the previous star handle was oversized, overlapped the Brown-Chat header, exposed a browser tooltip, compressed the chat layout, and did not match the Codex floating-panel hierarchy.
- First fix: replaced it with a fixed narrow rail, compact star control, and an independent rounded panel.
- User follow-up: removed vertical drag, restored click-driven horizontal open/close, and added persistent pin/unpin behavior.
- Post-fix evidence: ESLint, TypeScript, and the Next.js production build pass; the deployed health and chat routes return HTTP 200. Authenticated browser capture remains unavailable.

## Implementation checklist

- Capture the authenticated open-panel state at the same desktop viewport as the reference.
- Test click toggle, horizontal open/close animation, pin, and unpin.
- Confirm project menus and profile controls remain above the chat and inside the panel bounds.
- Adjust only residual P2/P3 spacing differences after screenshot comparison.

final result: blocked
