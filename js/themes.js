// ------------------------------------------------------------------
//  THEME REGISTRY
// ------------------------------------------------------------------
// This is the single place a new colour theme gets registered. To add one:
//   1. Add a `:root[data-theme="yourid"] { ... }` block to css/variables.css,
//      overriding the same custom properties as the existing theme blocks
//      (copy one as a starting point — the `light` block lists exactly the
//      variables that vary per theme).
//   2. Add an entry below with that same id: a label, a two-colour swatch
//      (surface, accent — used by the picker), and an `export` palette.
//      The canvas/minimap paint the diagram from these JS colour values
//      directly rather than reading CSS variables, so they need their own
//      copies of the same handful of colours.
// Nothing else needs to change: the Settings dropdown, the header theme
// picker, localStorage persistence and settings import/export all read
// this object and pick up new entries automatically.
//
// Every theme fills the same slots the same way, so a theme is a choice of
// about twenty colours and the rest follows from them:
//
//   bg        the canvas — for a port, the upstream editor background, since
//             that is the colour people recognise the theme by
//   bg2       the chrome (header and both rails) — the upstream sidebar tone,
//             which for almost every palette is a step darker than the editor
//   bg3       fills set into the chrome: menus, inset input wells
//   surface   cards and state nodes; surface2 is hover, surface3 pressed
//   border/2  --text at whatever alpha gives 1.2:1 / ~1.43:1 on --surface —
//             solved per theme, so a hairline is equally visible everywhere
//             rather than equally translucent
//   *-soft / *-border, glows, the active fill, shadows: alphas of their own
//             base colour (tests/themes.test.js pins the pairing)
//
// The `export` palette is not a second design: each field is the CSS
// variable the live canvas paints that part with (nodeFill is --surface,
// edgeStroke is --text3, …), and tests/themes.test.js fails if they differ.
//
// ------------------------------------------------------------------
//  ATTRIBUTION
// ------------------------------------------------------------------
// Most of these palettes are somebody else's design, reimplemented here as
// CSS variables rather than copied as theme files. That is still use of
// their work, so each one is credited below with its upstream and licence.
//
// **A palette must be permissively licensed to go in this file.** Colour
// values are probably too thin to carry copyright on their own, but that is
// not a defence worth relying on and it says nothing about trademark. The
// concrete case: Monokai Pro is a paid product whose licence forbids both
// redistribution and derivative works, so its six filters do not belong
// here no matter how many MIT-licensed community ports of them exist — a
// port cannot sub-licence a palette its author does not own. Check the
// upstream licence before adding a theme, not after.
//
//   Dark, Light, Sepia, High Contrast   original to this project
//   Cyberpunk, Marathon, Japan Day,     original to this project
//     Japan Night, Yumekawa, India,       (see DESIGN NOTES below)
//     Forest, Rivers, Space, Himalaya
//   Nord                                arcticicestudio/nord         MIT
//   Solarized Light / Dark              altercation/solarized        MIT
//   Dracula                             dracula/dracula-theme        MIT
//   Gruvbox Dark / Gruvbox Light        morhetz/gruvbox              MIT
//   One Dark                            atom/one-dark-syntax         MIT
//   Tokyo Night                         folke/tokyonight.nvim        Apache-2.0
//   Catppuccin Mocha                    catppuccin/catppuccin        MIT
//   Rosé Pine                           rose-pine/neovim             MIT
//   GitHub Light / Dark                 primer/primitives            MIT
//   Ayu Light / Dark / Mirage           dempfi/ayu                   MIT
//   Everforest                          sainnhe/everforest           MIT
//   Kanagawa                            rebelot/kanagawa.nvim        MIT
//   Melange / Melange Light             savq/melange-nvim            MIT
//   Nightfox / Dayfox                   EdenEast/nightfox.nvim       MIT
//
// Tokyo Night is the one Apache-2.0 entry: that licence asks for this notice
// to be preserved and for changes to be stated, which the mapping note above
// (reimplemented, not copied) covers.
//
// ------------------------------------------------------------------
//  DESIGN RULES  (every theme; tests/themes.test.js enforces each one)
// ------------------------------------------------------------------
// Borrowed palettes are built for syntax highlighting, where colour carries
// no meaning a reader has to decode. This app is the other case: four
// colours are simultaneously *semantic* on the canvas —
//
//     accent  the state the simulation is currently in
//     green   the start-state ring
//     gold    the accepting-state ring
//     red     rejection
//
// If any two sit close in hue, a machine misreads: an accepting state looks
// active, or a start state looks accepting. So every theme holds:
//
//   * pairwise hue separation >= 30 deg across those four, measured in
//     OKLCH. HSL hue is too uneven to judge by: it puts cyan and blue 30 deg
//     apart when they read as plainly different, and olive and mustard 23
//     deg apart when they read as nearly the same;
//   * accent, green, gold, red — and purple (selection) and indigo (the
//     incoming-edge highlight) — >= 3:1 on `bg`, `surface` and `surface2`:
//     a node is drawn in surface at rest and surface2 under the pointer, on
//     the canvas. Accent is easy to forget here because it is mostly thought
//     of as chrome, and it is the check that stops a pastel theme from
//     having an invisible active state;
//   * `on-accent` >= 4.5:1 on `accent`, since it is button-label text. This
//     pulls against the rule above — accent must be light enough to ring a
//     dark node and dark enough to label. A mid-luminance accent can fail
//     both at once, and the way out is to move it further from the middle
//     and flip `on-accent` to the other end, not to split the difference. So
//     dark themes label the accent with their darkest plane and light themes
//     with white, and the accent moves away from the middle until it fits;
//   * text >= 7:1 on `bg` and `bg2`, text2 >= 4.5:1 on those and on
//     `surface`, text3 >= 3:1 — text3 is also the edge stroke, so it is a
//     legibility floor, not a hint colour;
//   * the rejected-state wash stays visible: `--state-reject-fill` is red
//     over `surface`, and that composite must sit >= 18 (RGB distance) from
//     the bare fill. Free in most themes, and not free at all in one that
//     tints its surfaces toward red — which `cyberpunk` does.
//
// Where an upstream colour misses a floor, only its OKLCH lightness moves;
// its hue and chroma are the upstream's. That is how Ayu Light and
// Solarized, low-contrast by design, got legible without changing colour.
//
// ------------------------------------------------------------------
//  PORTS  (mapping a borrowed palette onto the four roles)
// ------------------------------------------------------------------
// An upstream accent is whatever the author liked best, and it often lands
// on a role it cannot share. The rule is to keep the upstream colours and
// move them between roles, not to invent new ones:
//
//   Ayu (all three)  the brand accent is the amber, and amber is what an
//                    accepting ring is — so the accent is Ayu's entity blue,
//                    and the amber shows on every accepting state instead
//   Solarized        the accent had been the same #b58900 as gold; it is
//                    the blue, as Solarized's own UI uses it
//   Everforest       the accent had been the start ring's green; it is the
//                    blue, and green stays on the start ring
//   Gruvbox Dark     orange as the accent sat beside both gold and --orange
//                    ("no verdict"); the accent is Gruvbox's blue. Its green
//                    is 28 deg from its yellow, so start takes the aqua
//   Rosé Pine        there is no green. Foam is its success colour (git
//                    add), so it is the start ring and iris the accent; rose
//                    is selection, told apart from love by chroma, not hue
//   Dracula          the accent is Dracula's purple, so selection — purple
//                    in every other theme — is its pink
//
// ------------------------------------------------------------------
//  DESIGN NOTES  (the original themes)
// ------------------------------------------------------------------
// `dark` and `light` are deliberately quiet: a near-neutral slate with a
// clear blue accent, so the first thing a new user sees is the machine
// rather than the theme. `sepia` is paper and brown ink; its accent is the
// blue-black of iron-gall ink rather than sienna, which sat between the gold
// ring and red. `high-contrast` solves its borders for 2:1 and 3.4:1 rather
// than the usual hairline, since outlines are the point of it.
//
// Four consequences worth knowing, because all look like mistakes:
// `cyberpunk` draws its hues from the marketing palettes (yellow, electric
// blue, hot pink, violet) but its ground from the in-game menus, which are
// burgundy rather than black — the two references disagree and each is right
// about a different half. Yellow goes on `gold` and blue on `accent` rather
// than the reverse, so the two never collide, and the yellow still dominates
// via every accepting ring. Its green is the one invented colour in any of
// these: 2077's palette has no green at all, but a start ring needs a fourth
// separated hue, so it is borrowed from the wider neon vocabulary. That red
// ground is also why the reject-wash rule above exists. `marathon` splits its
// acid lime and ultramarine the same way, and is dark for a reason that is
// arithmetic rather than taste: lime at #ccff00 has almost no contrast on
// white, so a light Marathon cannot carry its own signature colour.
//
// `japan-day` puts no pink on any semantic slot even though it is the sakura
// theme — blossom reads far better as the light the page sits in than as any
// one element, so it is the ground, and chrome is instead the prussian blue
// that Hokusai's Fuji prints were actually built from. `japan-night` is the
// only original with a violet accent, which is both what Tokyo signage throws
// and the only way to fit four separated hues around a `--red` that has to stay
// red — `--red` is the destructive-action colour everywhere in the UI, so it
// cannot be relocated around the wheel for a theme's convenience.
//
// `yumekawa` (ゆめかわ, from yumekawaii, "dream-cute") is the one where the
// spec and the aesthetic genuinely fight: a pastel palette on a pastel ground
// has no contrast anywhere. It is resolved by splitting them — the grounds,
// glows and note colours stay pastel, while the four semantic colours are
// those same hues taken down to full saturation. Its text is a deep plum
// rather than black on purpose; harshness is the one thing that reads as
// wrong in this aesthetic, so the ramp bottoms out warm.
export const Themes = {
  dark: {
    label: 'Dark',
    swatch: ['#12151b', '#5ea1ff'],
    export: {
      bg: '#12151b',
      nodeFill: '#1c212b',
      nodeStroke: 'rgba(230, 233, 240, 0.13)',
      startStroke: '#4dca8b',
      accStroke: '#f0c14b',
      actFill: 'rgba(94, 161, 255, 0.2)',
      actStroke: '#5ea1ff',
      edgeStroke: '#737d90',
      textFill: '#a7afbe',
      nodeTextFill: '#e6e9f0',
      viewportStroke: 'rgba(94, 161, 255, 0.6)'
    }
  },
  light: {
    label: 'Light',
    swatch: ['#f7f8fa', '#2160d4'],
    export: {
      bg: '#f7f8fa',
      nodeFill: '#ffffff',
      nodeStroke: 'rgba(23, 28, 38, 0.18)',
      startStroke: '#16855a',
      accStroke: '#b07400',
      actFill: 'rgba(33, 96, 212, 0.13)',
      actStroke: '#2160d4',
      edgeStroke: '#7a8396',
      textFill: '#4b5466',
      nodeTextFill: '#171c26',
      viewportStroke: 'rgba(33, 96, 212, 0.5)'
    }
  },
  nord: {
    label: 'Nord',
    swatch: ['#2e3440', '#88c0d0'],
    export: {
      bg: '#2e3440',
      nodeFill: '#3b4252',
      nodeStroke: 'rgba(236, 239, 244, 0.14)',
      startStroke: '#a3be8c',
      accStroke: '#ebcb8b',
      actFill: 'rgba(136, 192, 208, 0.2)',
      actStroke: '#88c0d0',
      edgeStroke: '#6f7d97',
      textFill: '#b7bfce',
      nodeTextFill: '#eceff4',
      viewportStroke: 'rgba(136, 192, 208, 0.6)'
    }
  },
  'solarized-light': {
    label: 'Solarized Light',
    swatch: ['#fdf6e3', '#097cc1'],
    export: {
      bg: '#fdf6e3',
      nodeFill: '#fefbf4',
      nodeStroke: 'rgba(7, 54, 66, 0.2)',
      startStroke: '#7f9205',
      accStroke: '#ad8309',
      actFill: 'rgba(9, 124, 193, 0.13)',
      actStroke: '#097cc1',
      edgeStroke: '#77888a',
      textFill: '#556b72',
      nodeTextFill: '#073642',
      viewportStroke: 'rgba(9, 124, 193, 0.5)'
    }
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    swatch: ['#002b36', '#288dd4'],
    export: {
      bg: '#002b36',
      nodeFill: '#073642',
      nodeStroke: 'rgba(238, 232, 213, 0.14)',
      startStroke: '#859900',
      accStroke: '#b58900',
      actFill: 'rgba(40, 141, 212, 0.2)',
      actStroke: '#288dd4',
      edgeStroke: '#657b83',
      textFill: '#93a1a1',
      nodeTextFill: '#eee8d5',
      viewportStroke: 'rgba(40, 141, 212, 0.6)'
    }
  },
  dracula: {
    label: 'Dracula',
    swatch: ['#282a36', '#bd93f9'],
    export: {
      bg: '#282a36',
      nodeFill: '#343746',
      nodeStroke: 'rgba(248, 248, 242, 0.12)',
      startStroke: '#50fa7b',
      accStroke: '#f1fa8c',
      actFill: 'rgba(189, 147, 249, 0.2)',
      actStroke: '#bd93f9',
      edgeStroke: '#6272a4',
      textFill: '#bcc2d3',
      nodeTextFill: '#f8f8f2',
      viewportStroke: 'rgba(189, 147, 249, 0.6)'
    }
  },
  gruvbox: {
    label: 'Gruvbox Dark',
    swatch: ['#282828', '#83a598'],
    export: {
      bg: '#282828',
      nodeFill: '#3c3836',
      nodeStroke: 'rgba(235, 219, 178, 0.14)',
      startStroke: '#8ec07c',
      accStroke: '#fabd2f',
      actFill: 'rgba(131, 165, 152, 0.2)',
      actStroke: '#83a598',
      edgeStroke: '#928374',
      textFill: '#bdae93',
      nodeTextFill: '#ebdbb2',
      viewportStroke: 'rgba(131, 165, 152, 0.6)'
    }
  },
  'gruvbox-light': {
    label: 'Gruvbox Light',
    swatch: ['#fbf1c7', '#076678'],
    export: {
      bg: '#fbf1c7',
      nodeFill: '#f9f5d7',
      nodeStroke: 'rgba(60, 56, 54, 0.21)',
      startStroke: '#79740e',
      accStroke: '#b57614',
      actFill: 'rgba(7, 102, 120, 0.13)',
      actStroke: '#076678',
      edgeStroke: '#8f8071',
      textFill: '#665c54',
      nodeTextFill: '#3c3836',
      viewportStroke: 'rgba(7, 102, 120, 0.5)'
    }
  },
  'one-dark': {
    label: 'One Dark',
    swatch: ['#282c34', '#61afef'],
    export: {
      bg: '#282c34',
      nodeFill: '#2f343e',
      nodeStroke: 'rgba(220, 223, 228, 0.14)',
      startStroke: '#98c379',
      accStroke: '#e5c07b',
      actFill: 'rgba(97, 175, 239, 0.2)',
      actStroke: '#61afef',
      edgeStroke: '#7f848e',
      textFill: '#abb2bf',
      nodeTextFill: '#dcdfe4',
      viewportStroke: 'rgba(97, 175, 239, 0.6)'
    }
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    swatch: ['#1a1b26', '#7aa2f7'],
    export: {
      bg: '#1a1b26',
      nodeFill: '#24283b',
      nodeStroke: 'rgba(192, 202, 245, 0.15)',
      startStroke: '#9ece6a',
      accStroke: '#e0af68',
      actFill: 'rgba(122, 162, 247, 0.2)',
      actStroke: '#7aa2f7',
      edgeStroke: '#737aa2',
      textFill: '#a9b1d6',
      nodeTextFill: '#c0caf5',
      viewportStroke: 'rgba(122, 162, 247, 0.6)'
    }
  },
  catppuccin: {
    label: 'Catppuccin Mocha',
    swatch: ['#1e1e2e', '#89b4fa'],
    export: {
      bg: '#1e1e2e',
      nodeFill: '#313244',
      nodeStroke: 'rgba(205, 214, 244, 0.14)',
      startStroke: '#a6e3a1',
      accStroke: '#f9e2af',
      actFill: 'rgba(137, 180, 250, 0.2)',
      actStroke: '#89b4fa',
      edgeStroke: '#7f849c',
      textFill: '#a6adc8',
      nodeTextFill: '#cdd6f4',
      viewportStroke: 'rgba(137, 180, 250, 0.6)'
    }
  },
  'rose-pine': {
    label: 'Rosé Pine',
    swatch: ['#191724', '#c4a7e7'],
    export: {
      bg: '#191724',
      nodeFill: '#26233a',
      nodeStroke: 'rgba(224, 222, 244, 0.14)',
      startStroke: '#9ccfd8',
      accStroke: '#f6c177',
      actFill: 'rgba(196, 167, 231, 0.2)',
      actStroke: '#c4a7e7',
      edgeStroke: '#6e6a86',
      textFill: '#908caa',
      nodeTextFill: '#e0def4',
      viewportStroke: 'rgba(196, 167, 231, 0.6)'
    }
  },
  'github-light': {
    label: 'GitHub Light',
    swatch: ['#ffffff', '#0969da'],
    export: {
      bg: '#ffffff',
      nodeFill: '#ffffff',
      nodeStroke: 'rgba(31, 35, 40, 0.19)',
      startStroke: '#1a7f37',
      accStroke: '#9a6700',
      actFill: 'rgba(9, 105, 218, 0.13)',
      actStroke: '#0969da',
      edgeStroke: '#818b98',
      textFill: '#59636e',
      nodeTextFill: '#1f2328',
      viewportStroke: 'rgba(9, 105, 218, 0.5)'
    }
  },
  'github-dark': {
    label: 'GitHub Dark',
    swatch: ['#0d1117', '#4493f8'],
    export: {
      bg: '#0d1117',
      nodeFill: '#151b23',
      nodeStroke: 'rgba(240, 246, 252, 0.13)',
      startStroke: '#3fb950',
      accStroke: '#d29922',
      actFill: 'rgba(68, 147, 248, 0.2)',
      actStroke: '#4493f8',
      edgeStroke: '#6e7681',
      textFill: '#9198a1',
      nodeTextFill: '#f0f6fc',
      viewportStroke: 'rgba(68, 147, 248, 0.6)'
    }
  },
  sepia: {
    label: 'Sepia',
    swatch: ['#f4ecd8', '#34628a'],
    export: {
      bg: '#f4ecd8',
      nodeFill: '#fbf6e9',
      nodeStroke: 'rgba(63, 45, 28, 0.2)',
      startStroke: '#557a3a',
      accStroke: '#9c7412',
      actFill: 'rgba(52, 98, 138, 0.13)',
      actStroke: '#34628a',
      edgeStroke: '#8d7c61',
      textFill: '#6e5c45',
      nodeTextFill: '#3f2d1c',
      viewportStroke: 'rgba(52, 98, 138, 0.5)'
    }
  },
  'high-contrast': {
    label: 'High Contrast',
    swatch: ['#000000', '#00d9ff'],
    export: {
      bg: '#000000',
      nodeFill: '#121212',
      nodeStroke: 'rgba(255, 255, 255, 0.37)',
      startStroke: '#00ff9c',
      accStroke: '#ffd60a',
      actFill: 'rgba(0, 217, 255, 0.2)',
      actStroke: '#00d9ff',
      edgeStroke: '#bdbdbd',
      textFill: '#e6e6e6',
      nodeTextFill: '#ffffff',
      viewportStroke: 'rgba(0, 217, 255, 0.6)'
    }
  },
  'ayu-light': {
    label: 'Ayu Light',
    swatch: ['#fcfcfc', '#027cc0'],
    export: {
      bg: '#fcfcfc',
      nodeFill: '#ffffff',
      nodeStroke: 'rgba(78, 83, 88, 0.24)',
      startStroke: '#739a04',
      accStroke: '#c37d08',
      actFill: 'rgba(2, 124, 192, 0.13)',
      actStroke: '#027cc0',
      edgeStroke: '#898c91',
      textFill: '#6c6f74',
      nodeTextFill: '#4e5358',
      viewportStroke: 'rgba(2, 124, 192, 0.5)'
    }
  },
  'ayu-dark': {
    label: 'Ayu Dark',
    swatch: ['#0d1017', '#59c2ff'],
    export: {
      bg: '#0d1017',
      nodeFill: '#141821',
      nodeStroke: 'rgba(191, 189, 182, 0.17)',
      startStroke: '#aad94c',
      accStroke: '#e6b450',
      actFill: 'rgba(89, 194, 255, 0.2)',
      actStroke: '#59c2ff',
      edgeStroke: '#6c7380',
      textFill: '#a0a09e',
      nodeTextFill: '#bfbdb6',
      viewportStroke: 'rgba(89, 194, 255, 0.6)'
    }
  },
  'ayu-mirage': {
    label: 'Ayu Mirage',
    swatch: ['#242936', '#73d0ff'],
    export: {
      bg: '#242936',
      nodeFill: '#2d3341',
      nodeStroke: 'rgba(204, 202, 194, 0.15)',
      startStroke: '#d5ff80',
      accStroke: '#ffcc66',
      actFill: 'rgba(115, 208, 255, 0.2)',
      actStroke: '#73d0ff',
      edgeStroke: '#707a8c',
      textFill: '#b0b2b2',
      nodeTextFill: '#cccac2',
      viewportStroke: 'rgba(115, 208, 255, 0.6)'
    }
  },
  everforest: {
    label: 'Everforest',
    swatch: ['#2d353b', '#7fbbb3'],
    export: {
      bg: '#2d353b',
      nodeFill: '#3d484d',
      nodeStroke: 'rgba(211, 198, 170, 0.18)',
      startStroke: '#a7c080',
      accStroke: '#dbbc7f',
      actFill: 'rgba(127, 187, 179, 0.2)',
      actStroke: '#7fbbb3',
      edgeStroke: '#859289',
      textFill: '#abb7ae',
      nodeTextFill: '#d3c6aa',
      viewportStroke: 'rgba(127, 187, 179, 0.6)'
    }
  },
  kanagawa: {
    label: 'Kanagawa',
    swatch: ['#1f1f28', '#7e9cd8'],
    export: {
      bg: '#1f1f28',
      nodeFill: '#2a2a37',
      nodeStroke: 'rgba(220, 215, 186, 0.14)',
      startStroke: '#98bb6c',
      accStroke: '#e6c384',
      actFill: 'rgba(126, 156, 216, 0.2)',
      actStroke: '#7e9cd8',
      edgeStroke: '#727169',
      textFill: '#c8c093',
      nodeTextFill: '#dcd7ba',
      viewportStroke: 'rgba(126, 156, 216, 0.6)'
    }
  },
  melange: {
    label: 'Melange',
    swatch: ['#292522', '#89b3b6'],
    export: {
      bg: '#292522',
      nodeFill: '#34302c',
      nodeStroke: 'rgba(236, 225, 215, 0.13)',
      startStroke: '#85b695',
      accStroke: '#ebc06d',
      actFill: 'rgba(137, 179, 182, 0.2)',
      actStroke: '#89b3b6',
      edgeStroke: '#867462',
      textFill: '#c1a78e',
      nodeTextFill: '#ece1d7',
      viewportStroke: 'rgba(137, 179, 182, 0.6)'
    }
  },
  'melange-light': {
    label: 'Melange Light',
    swatch: ['#f1f1f1', '#3d6568'],
    export: {
      bg: '#f1f1f1',
      nodeFill: '#f8f7f6',
      nodeStroke: 'rgba(84, 67, 58, 0.23)',
      startStroke: '#3a684a',
      accStroke: '#a06d00',
      actFill: 'rgba(61, 101, 104, 0.13)',
      actStroke: '#3d6568',
      edgeStroke: '#997b69',
      textFill: '#776052',
      nodeTextFill: '#54433a',
      viewportStroke: 'rgba(61, 101, 104, 0.5)'
    }
  },
  nightfox: {
    label: 'Nightfox',
    swatch: ['#192330', '#719cd6'],
    export: {
      bg: '#192330',
      nodeFill: '#212e3f',
      nodeStroke: 'rgba(205, 206, 207, 0.15)',
      startStroke: '#81b29a',
      accStroke: '#dbc074',
      actFill: 'rgba(113, 156, 214, 0.2)',
      actStroke: '#719cd6',
      edgeStroke: '#738091',
      textFill: '#aeafb0',
      nodeTextFill: '#cdcecf',
      viewportStroke: 'rgba(113, 156, 214, 0.6)'
    }
  },
  dayfox: {
    label: 'Dayfox',
    swatch: ['#f6f2ee', '#2848a9'],
    export: {
      bg: '#f6f2ee',
      nodeFill: '#fbfaf8',
      nodeStroke: 'rgba(61, 43, 90, 0.21)',
      startStroke: '#396847',
      accStroke: '#ac5402',
      actFill: 'rgba(40, 72, 169, 0.13)',
      actStroke: '#2848a9',
      edgeStroke: '#837a72',
      textFill: '#643f61',
      nodeTextFill: '#3d2b5a',
      viewportStroke: 'rgba(40, 72, 169, 0.5)'
    }
  },
  cyberpunk: {
    label: 'Cyberpunk',
    swatch: ['#1a0a10', '#00bfff'],
    export: {
      bg: '#1a0a10',
      nodeFill: '#29141e',
      nodeStroke: 'rgba(246, 236, 240, 0.13)',
      startStroke: '#39ff6a',
      accStroke: '#ffea00',
      actFill: 'rgba(0, 191, 255, 0.2)',
      actStroke: '#00bfff',
      edgeStroke: '#8d7280',
      textFill: '#c9b0bb',
      nodeTextFill: '#f6ecf0',
      viewportStroke: 'rgba(0, 191, 255, 0.6)'
    }
  },
  marathon: {
    label: 'Marathon',
    swatch: ['#0b0b0e', '#6f6fff'],
    export: {
      bg: '#0b0b0e',
      nodeFill: '#18181d',
      nodeStroke: 'rgba(244, 244, 246, 0.13)',
      startStroke: '#00e5ff',
      accStroke: '#ccff00',
      actFill: 'rgba(111, 111, 255, 0.2)',
      actStroke: '#6f6fff',
      edgeStroke: '#78788a',
      textFill: '#b6b6c0',
      nodeTextFill: '#f4f4f6',
      viewportStroke: 'rgba(111, 111, 255, 0.6)'
    }
  },
  'japan-day': {
    label: 'Japan Day',
    swatch: ['#fdf4f4', '#235d8b'],
    export: {
      bg: '#fdf4f4',
      nodeFill: '#fffafa',
      nodeStroke: 'rgba(36, 29, 32, 0.19)',
      startStroke: '#4f7a42',
      accStroke: '#b07d0a',
      actFill: 'rgba(35, 93, 139, 0.13)',
      actStroke: '#235d8b',
      edgeStroke: '#928288',
      textFill: '#6b5a60',
      nodeTextFill: '#241d20',
      viewportStroke: 'rgba(35, 93, 139, 0.5)'
    }
  },
  'japan-night': {
    label: 'Japan Night',
    swatch: ['#0d1020', '#b44dff'],
    export: {
      bg: '#0d1020',
      nodeFill: '#191e35',
      nodeStroke: 'rgba(238, 240, 255, 0.13)',
      startStroke: '#3fffa8',
      accStroke: '#ffc24d',
      actFill: 'rgba(180, 77, 255, 0.2)',
      actStroke: '#b44dff',
      edgeStroke: '#7e85ab',
      textFill: '#b6bcdd',
      nodeTextFill: '#eef0ff',
      viewportStroke: 'rgba(180, 77, 255, 0.6)'
    }
  },
  yumekawa: {
    label: 'Yumekawa',
    swatch: ['#fcf4fb', '#9d3fc4'],
    export: {
      bg: '#fcf4fb',
      nodeFill: '#fffbfe',
      nodeStroke: 'rgba(61, 42, 68, 0.2)',
      startStroke: '#1f8a6d',
      accStroke: '#a8780c',
      actFill: 'rgba(157, 63, 196, 0.13)',
      actStroke: '#9d3fc4',
      edgeStroke: '#967d9c',
      textFill: '#7a5c80',
      nodeTextFill: '#3d2a44',
      viewportStroke: 'rgba(157, 63, 196, 0.5)'
    }
  },
  india: {
    label: 'India',
    swatch: ['#12132a', '#00b3a4'],
    export: {
      bg: '#12132a',
      nodeFill: '#1f2143',
      nodeStroke: 'rgba(245, 236, 217, 0.13)',
      startStroke: '#7cb342',
      accStroke: '#f0b429',
      actFill: 'rgba(0, 179, 164, 0.2)',
      actStroke: '#00b3a4',
      edgeStroke: '#8e86a8',
      textFill: '#c9bfa8',
      nodeTextFill: '#f5ecd9',
      viewportStroke: 'rgba(0, 179, 164, 0.6)'
    }
  },
  forest: {
    label: 'Forest',
    swatch: ['#101a14', '#6cc2a1'],
    export: {
      bg: '#101a14',
      nodeFill: '#1b2b21',
      nodeStroke: 'rgba(223, 232, 220, 0.13)',
      startStroke: '#8fbc4a',
      accStroke: '#ddb14a',
      actFill: 'rgba(108, 194, 161, 0.2)',
      actStroke: '#6cc2a1',
      edgeStroke: '#6f8a72',
      textFill: '#a8bda6',
      nodeTextFill: '#dfe8dc',
      viewportStroke: 'rgba(108, 194, 161, 0.6)'
    }
  },
  rivers: {
    label: 'Rivers',
    swatch: ['#eef2f2', '#0f7a8c'],
    export: {
      bg: '#eef2f2',
      nodeFill: '#f9fcfc',
      nodeStroke: 'rgba(30, 47, 54, 0.2)',
      startStroke: '#3d7a4f',
      accStroke: '#96701a',
      actFill: 'rgba(15, 122, 140, 0.13)',
      actStroke: '#0f7a8c',
      edgeStroke: '#72878e',
      textFill: '#4d666f',
      nodeTextFill: '#1e2f36',
      viewportStroke: 'rgba(15, 122, 140, 0.5)'
    }
  },
  space: {
    label: 'Space',
    swatch: ['#070917', '#6fa8ff'],
    export: {
      bg: '#070917',
      nodeFill: '#12163a',
      nodeStroke: 'rgba(232, 235, 255, 0.14)',
      startStroke: '#4fd6a8',
      accStroke: '#ffc857',
      actFill: 'rgba(111, 168, 255, 0.2)',
      actStroke: '#6fa8ff',
      edgeStroke: '#7178a8',
      textFill: '#b0b6dd',
      nodeTextFill: '#e8ebff',
      viewportStroke: 'rgba(111, 168, 255, 0.6)'
    }
  },
  himalaya: {
    label: 'Himalaya',
    swatch: ['#eff4f8', '#1f7a9c'],
    export: {
      bg: '#eff4f8',
      nodeFill: '#fbfdff',
      nodeStroke: 'rgba(27, 42, 56, 0.19)',
      startStroke: '#3f7a3a',
      accStroke: '#9a6f12',
      actFill: 'rgba(31, 122, 156, 0.13)',
      actStroke: '#1f7a9c',
      edgeStroke: '#71889a',
      textFill: '#4a6274',
      nodeTextFill: '#1b2a38',
      viewportStroke: 'rgba(31, 122, 156, 0.5)'
    }
  }
};

export const DEFAULT_THEME = 'light';
