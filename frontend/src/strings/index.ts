// Every user-facing text lives in src/strings/ (French UI), so components hold no literal and
// the app can be translated later. One module per area, each owned by its components:
//   ui.ts     generic controls (src/components/ui)
//   board.ts  the board canvas and its formatting (src/board, src/components/board)
//   app.ts    the app shell: toolbar, sidebar, inspector, states
export { UI } from './ui';
export { BOARD } from './board';
export { APP } from './app';
