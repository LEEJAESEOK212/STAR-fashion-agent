# STAR landing design QA

## Evidence

- Source visual truth: `apps/web/public/STAR_brandkit.png`
- Source pixels: 1055 × 1491
- Browser-rendered implementation: `apps/web/design-qa-implementation.png`
- Archive implementation: `apps/web/design-qa-archive.png`
- Combined comparison input: `apps/web/design-qa-comparison.png`
- Collage depth comparison input: `apps/web/design-qa-collage-comparison.png`
- Collage desktop captures: `apps/web/design-qa-collage-depth.png`, `apps/web/design-qa-collage-lower.png`
- Ordered mosaic comparison input: `apps/web/design-qa-mosaic-comparison.png`
- Ordered mosaic desktop captures: `apps/web/design-qa-mosaic-top.png`, `apps/web/design-qa-mosaic-lower.png`
- Desktop viewport: 1265 × 720 CSS px, device scale factor 1
- Mobile viewport: 390 × 844 CSS px, device scale factor 1
- State: signed-out landing page; hero, search composer, archive/lookbook, and responsive mobile state
- Normalization: the reference is shown at its native aspect ratio; the desktop hero and archive screenshots are scaled without cropping into one comparison canvas.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the display wordmark uses a heavy Helvetica/Arial-compatible stack and the UI uses an Inter-first system stack, matching the kit's display-bold and restrained sans-serif hierarchy. Letter spacing and all-caps labels match the supplied direction.
- Spacing and layout rhythm: the split black hero, oversized STAR heading, search bar overlap, right-side skating image, hairline dividers, and dense editorial mosaic follow the reference composition. Mobile retains the same hierarchy rather than collapsing into a generic card layout.
- Colors and visual tokens: the interface is constrained to black, ivory, white, charcoal, and gray. Previous brown/blue visual styling is removed from the landing, auth, sidebar, composer, voice, and chat chrome.
- Image quality and asset fidelity: every supplied photograph is rendered from the original file without recoloring or generative alteration. The black star and northeast arrow are pixel-extracted from the supplied brandkit rather than redrawn. The hero photo uses an exact byte-identical copy named `star-hero.jpg` only to separate above-the-fold loading behavior from its repeated lookbook instance.
- Copy and content: the product name is STAR and landing copy is intentionally reduced to `EXPLORE`, `ARCHIVE`, `CHAT`, `LOOKBOOK`, and `ASK STAR`.
- Collage depth: cards now start at different vertical positions, use varied spans and layered z-order, and distribute negative space through the top, middle, and bottom instead of reserving it for the final rows.
- Ordered mosaic: the final revision removes free-floating overlap and shadows. All cards share a strict rectangular grid, use irregular row/column spans, and expose the black background only as consistent gutters.
- Yellow source border: the yellow edge is baked into `다운로드 (4).jpg`, not produced by CSS. The source file remains untouched and that card alone is inset-cropped by 1.6%, removing the edge without changing the photograph.

## Full-view comparison evidence

- `design-qa-comparison.png` places the complete source brandkit beside the rendered hero and archive states. The same hero subject, left/right split, title scale, search treatment, archive ordering, and collage rhythm are visible together.

## Focused region evidence

- Search control: the original black star asset and original northeast-arrow pixels are preserved inside the ivory pill.
- Hero: the original night-skate image is fully visible with the skater and rail retained at desktop and mobile breakpoints.
- Lookbook: the first three columns and subsequent staggered image blocks use the same subjects and ordering as the reference.

## Comparison history

1. Initial browser comparison found the hero used `object-fit: cover`, cropping the subject's head and lower board area. Fixed by using contain-style framing and a right-side hero region; the revised desktop capture shows the full subject and rail.
2. Initial mobile comparison found the extracted arrow included part of the source button ring. Re-extracted only the northeast-arrow pixels into `star-arrow-icon-v2.png`; the revised mobile and desktop captures show a clean arrow inside the existing black circle.
3. Browser logs reported an LCP warning because the same photo URL appeared in the hero and lookbook. The hero now uses `star-hero.jpg` with eager loading; subsequent reloads produced no new warning.
4. The first collage pass used a regular grid above the fold and concentrated most negative space near the bottom. Reworked it into a 16-column, 30-row editorial composition with staggered starts, varied card sizes, selective overlap, and distributed black space. Desktop and 390 × 844 mobile captures now show depth from the first row onward.
5. The supplied Kanye street photo contained a neon-yellow perimeter in the bitmap itself. Added a card-specific 1.6% visual crop and verified the revised lower collage without the yellow line.
6. User feedback found the layered collage too visually noisy. Replaced the overlapping 16-column composition with a fully tessellated 12-column desktop mosaic and 6-column mobile mosaic. Card sizes remain irregular, but every edge meets a shared grid line and the black background appears only as regular gutters. Increased the source-border crop to 3.2% so no yellow perimeter remains.

## Primary interactions tested

- `Explore` and `Archive` anchor navigation
- `Chat` and sign-in links render in their preserved routes
- Search input accepts and clears text without altering the existing submit behavior
- Desktop 1265 × 720 and mobile 390 × 844 responsive states
- Browser console checked after the final reload; no new errors or warnings were emitted

## Validation

- TypeScript: passed (`tsc --noEmit`)
- ESLint: passed before final asset-only/LCP adjustments; no source lint findings were emitted
- Next.js production compilation, TypeScript, page-data collection, and static generation: passed. Final standalone trace copy is blocked only by Windows symlink permissions (`EPERM`) in the isolated preview directory, not by application code.

## Implementation checklist

- [x] Preserve all chat, project, auth, voice, upload, and sidebar behavior
- [x] Replace Brown-Chat visible branding with STAR
- [x] Use the supplied photos directly and preserve the brandkit ordering
- [x] Match the black/ivory editorial direction and bold typography
- [x] Verify desktop and mobile layouts in a browser
- [x] Check browser errors and warnings

## Follow-up polish

- P3: if a licensed Helvetica/Inter webfont is added later, self-host it to avoid build-time network dependencies while retaining the current font metrics.

final result: passed
