# NearMe Design System

NearMe is a calm, editorial city guide for adults 18+. The product should feel useful before it feels clever: trustworthy information, clear constraints, and one primary action per screen.

## Product principles

- Lead with three strong plans, not inventory volume or AI language.
- Never widen location, hide price uncertainty, or imply verification that did not occur.
- Do not repeat an event on the same screen.
- Real event imagery is optional. Use an intentional category tile instead of unrelated stock photography.
- Core discovery is free. Monetization must follow demonstrated value and describe only shipped benefits.

## Semantic color

| Token | Light | Dark |
|---|---|---|
| Canvas | `#F7F6F2` | `#101114` |
| Surface | `#FFFFFF` | `#191B20` |
| Raised surface | `#EFEEE9` | `#24272E` |
| Primary text | `#17191C` | `#F4F2ED` |
| Secondary text | `#5F646D` | `#A9ADB5` |
| Border | `#DEDDD7` | `#343841` |
| Brand | `#5146E5` | `#948BFF` |
| Success | `#0B7557` | `#60D6AC` |
| Warning | `#9A5000` | `#FFB965` |
| Danger | `#C43E4D` | `#FF7D89` |

All normal text must meet WCAG 2.2 AA contrast. Color is never the only state indicator.

## Type and spacing

- Use the native system font and allow Dynamic Type.
- Caption 13, metadata 15, body 16, card title 20, section 24, screen title 32.
- Body line height is 1.45–1.65.
- Use a 4/8-point spacing rhythm: 4, 8, 16, 24, 32, 48.
- Card radius 16, sheet radius 24, compact controls use a full pill.

## Interaction and accessibility

- Every tap target is at least 44×44 points with visible pressed feedback.
- Icon-only controls require an accessibility label.
- Respect safe areas, system light/dark mode, reduced motion, and text scaling.
- Use one consistent outline icon family (`Ionicons`) and no emoji as structural UI.
- Meaningful motion lasts 150–300ms and never blocks input.
- Loading that may exceed 300ms uses stable progress or skeleton space; no full-screen AI overlay.

## Navigation

1. For You — best three plus non-repeating contextual sections.
2. Explore — search, time/category filters, and list/map modes.
3. Plans — upcoming saves and past outcome feedback.
4. You — location, constraints, alerts, subscription state, privacy.

## Event card contract

Every primary card exposes title, effective date/time, venue, selected-radius distance, honest price state, a concrete match reason, source/verification status, save, and dismiss feedback. Event detail adds description, directions, sharing, official source, and final-detail disclaimer.

## Copy rules

- Prefer “plans,” “nearby,” “checked,” and “source linked.”
- Avoid “perfect,” “real-time,” “any city,” “unlimited,” or inventory counts unless measured and current.
- Explain empty inventory without blaming the user and provide a voluntary recovery action.
