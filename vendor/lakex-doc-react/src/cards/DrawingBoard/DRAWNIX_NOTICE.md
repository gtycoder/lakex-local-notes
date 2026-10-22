# Drawnix extraction boundary

This card uses the Lakex-published extraction of [plait-board/drawnix](https://github.com/plait-board/drawnix), under its MIT license:
`lakex-drawnix`, `lakex-drawnix-react-board` and `lakex-drawnix-react-text`.

Retained as the drawing engine:

- Plait `Wrapper` and `Board` lifecycle;
- `withDraw` geometry and connector support;
- `withGroup` selection/group behaviour;
- serializable Plait scene and viewport data.

Deliberately excluded from this document-card package:

- Drawnix application shell, menus, file system and sharing UI;
- tutorial/onboarding, Markdown/Mermaid import and mind-map surface;
- Drawnix-specific AI and cloud integrations.

`DrawnixBoardCore.tsx` is the Lakex adapter. Product controls, localization,
theme selection, the Yuque-style layout and the custom shape catalog live there
instead of importing the full Drawnix application shell wholesale. Editing and
font-size changes delegate to the native Plait APIs exposed by the published
packages, with a small compatibility fallback for legacy scenes.
