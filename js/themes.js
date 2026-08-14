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
//   Gruvbox / Gruvbox Light             morhetz/gruvbox              MIT
//   One Dark                            atom/one-dark-syntax         MIT
//   Tokyo Night                         folke/tokyonight.nvim        Apache-2.0
//   Catppuccin                          catppuccin/catppuccin        MIT
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
//  DESIGN NOTES  (the ten original themes)
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
// active, or a start state looks accepting. So the ten themes above were
// each checked to hold, and any new one should hold too:
//
//   * pairwise hue separation >= 35 deg across those four (they land 40-64);
//   * gold, green AND accent >= 3:1 against `surface2`, the node fill all
//     three are drawn on — above the 2.5 floor tests/themes.test.js
//     enforces, for headroom. Accent is easy to forget here because it is
//     mostly thought of as chrome, and it is the check that stops a pastel
//     theme from having an invisible active state;
//   * `on-accent` >= 4.5:1 on `accent`, since it is button-label text. Note
//     that this pulls against the rule above — accent must be light enough
//     to ring a dark node and dark enough to label. A mid-luminance accent
//     can fail both at once, and the way out is to move it further from the
//     middle and flip `on-accent` to the other end, not to split the
//     difference;
//   * text >= 7:1, text2 >= 4.5:1, text3 >= 2.6:1 against `bg` — text3 is
//     also the edge stroke, so it is a legibility floor, not a hint colour;
//   * the rejected-state wash stays visible: `--state-reject-fill` is red at
//     10% over `surface2`, and that composite must sit >= 18 (RGB distance)
//     from the bare fill. Free in most themes, and not free at all in one
//     that tints its surfaces toward red — which `cyberpunk` now does.
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
// registry's only violet accent, which is both what Tokyo signage throws and
// the only way to fit four separated hues around a `--red` that has to stay
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
    swatch: ['#080c18', '#4fc3f7'],
    export: {
      bg: '#080c18',
      nodeFill: '#161d2e',
      nodeStroke: 'rgba(100,130,200,0.22)',
      startStroke: '#69f0ae',
      accStroke: '#ffd54f',
      actFill: 'rgba(79,195,247,.18)',
      actStroke: '#4fc3f7',
      edgeStroke: '#4a5878',
      textFill: '#7a8ab0',
      nodeTextFill: '#c8d4f0',
      viewportStroke: 'rgba(79,195,247,0.6)'
    }
  },
  light: {
    label: 'Light',
    swatch: ['#eef4fb', '#178ed8'],
    export: {
      bg: '#eef4fb',
      nodeFill: '#ffffff',
      nodeStroke: 'rgba(41,73,109,0.2)',
      startStroke: '#198b63',
      accStroke: '#b7791f',
      actFill: 'rgba(23,142,216,.12)',
      actStroke: '#178ed8',
      edgeStroke: '#7d92a6',
      textFill: '#496277',
      nodeTextFill: '#16324a',
      viewportStroke: 'rgba(23,142,216,0.45)'
    }
  },
  nord: {
    label: 'Nord',
    swatch: ['#2e3440', '#88c0d0'],
    export: {
      bg: '#2e3440',
      nodeFill: '#434c5e',
      nodeStroke: 'rgba(136, 192, 208, 0.24)',
      startStroke: '#a3be8c',
      accStroke: '#ebcb8b',
      actFill: 'rgba(136, 192, 208, 0.2)',
      actStroke: '#88c0d0',
      edgeStroke: '#8b96ad',
      textFill: '#c3cad9',
      nodeTextFill: '#eceff4',
      viewportStroke: 'rgba(136, 192, 208, 0.6)'
    }
  },
  'solarized-light': {
    label: 'Solarized Light',
    swatch: ['#fdf6e3', '#b58900'],
    export: {
      bg: '#fdf6e3',
      nodeFill: '#f7f2e3',
      nodeStroke: 'rgba(101, 123, 131, 0.24)',
      startStroke: '#859900',
      accStroke: '#b58900',
      actFill: 'rgba(181, 137, 0, 0.13)',
      actStroke: '#b58900',
      edgeStroke: '#93a1a1',
      textFill: '#586e75',
      nodeTextFill: '#073642',
      viewportStroke: 'rgba(181, 137, 0, 0.48)'
    }
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    swatch: ['#002b36', '#2aa198'],
    export: {
      bg: '#002b36',
      nodeFill: '#0a4757',
      nodeStroke: 'rgba(42, 161, 152, 0.24)',
      startStroke: '#859900',
      accStroke: '#b58900',
      actFill: 'rgba(42, 161, 152, 0.2)',
      actStroke: '#2aa198',
      edgeStroke: '#657b83',
      textFill: '#93a1a1',
      nodeTextFill: '#eee8d5',
      viewportStroke: 'rgba(42, 161, 152, 0.6)'
    }
  },
  dracula: {
    label: 'Dracula',
    swatch: ['#282a36', '#bd93f9'],
    export: {
      bg: '#282a36',
      nodeFill: '#3d4052',
      nodeStroke: 'rgba(189, 147, 249, 0.24)',
      startStroke: '#50fa7b',
      accStroke: '#f1fa8c',
      actFill: 'rgba(189, 147, 249, 0.2)',
      actStroke: '#bd93f9',
      edgeStroke: '#7b7f9e',
      textFill: '#bfc1cc',
      nodeTextFill: '#f8f8f2',
      viewportStroke: 'rgba(189, 147, 249, 0.6)'
    }
  },
  gruvbox: {
    label: 'Gruvbox',
    swatch: ['#282828', '#fe8019'],
    export: {
      bg: '#282828',
      nodeFill: '#504945',
      nodeStroke: 'rgba(254, 128, 25, 0.24)',
      startStroke: '#b8bb26',
      accStroke: '#fabd2f',
      actFill: 'rgba(254, 128, 25, 0.2)',
      actStroke: '#fe8019',
      edgeStroke: '#a89984',
      textFill: '#bdae93',
      nodeTextFill: '#ebdbb2',
      viewportStroke: 'rgba(254, 128, 25, 0.6)'
    }
  },
  'gruvbox-light': {
    label: 'Gruvbox Light',
    swatch: ['#fbf1c7', '#076678'],
    export: {
      bg: '#fbf1c7',
      nodeFill: '#f5eecd',
      nodeStroke: 'rgba(80, 73, 69, 0.24)',
      startStroke: '#79740e',
      accStroke: '#b57614',
      actFill: 'rgba(7, 102, 120, 0.13)',
      actStroke: '#076678',
      edgeStroke: '#7c6f64',
      textFill: '#504945',
      nodeTextFill: '#3c3836',
      viewportStroke: 'rgba(7, 102, 120, 0.48)'
    }
  },
  'one-dark': {
    label: 'One Dark',
    swatch: ['#282c34', '#61afef'],
    export: {
      bg: '#282c34',
      nodeFill: '#333842',
      nodeStroke: 'rgba(97, 175, 239, 0.24)',
      startStroke: '#98c379',
      accStroke: '#e5c07b',
      actFill: 'rgba(97, 175, 239, 0.2)',
      actStroke: '#61afef',
      edgeStroke: '#5c6370',
      textFill: '#828997',
      nodeTextFill: '#abb2bf',
      viewportStroke: 'rgba(97, 175, 239, 0.6)'
    }
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    swatch: ['#1a1b26', '#7aa2f7'],
    export: {
      bg: '#1a1b26',
      nodeFill: '#292e42',
      nodeStroke: 'rgba(122, 162, 247, 0.24)',
      startStroke: '#9ece6a',
      accStroke: '#e0af68',
      actFill: 'rgba(122, 162, 247, 0.2)',
      actStroke: '#7aa2f7',
      edgeStroke: '#565f89',
      textFill: '#9099c4',
      nodeTextFill: '#c0caf5',
      viewportStroke: 'rgba(122, 162, 247, 0.6)'
    }
  },
  catppuccin: {
    label: 'Catppuccin',
    swatch: ['#1e1e2e', '#89b4fa'],
    export: {
      bg: '#1e1e2e',
      nodeFill: '#313244',
      nodeStroke: 'rgba(137, 180, 250, 0.24)',
      startStroke: '#a6e3a1',
      accStroke: '#f9e2af',
      actFill: 'rgba(137, 180, 250, 0.2)',
      actStroke: '#89b4fa',
      edgeStroke: '#6c7086',
      textFill: '#a6adc8',
      nodeTextFill: '#cdd6f4',
      viewportStroke: 'rgba(137, 180, 250, 0.6)'
    }
  },
  'rose-pine': {
    label: 'Rosé Pine',
    swatch: ['#191724', '#9ccfd8'],
    export: {
      bg: '#191724',
      nodeFill: '#26233a',
      nodeStroke: 'rgba(156, 207, 216, 0.24)',
      startStroke: '#31748f',
      accStroke: '#f6c177',
      actFill: 'rgba(156, 207, 216, 0.2)',
      actStroke: '#9ccfd8',
      edgeStroke: '#6e6a86',
      textFill: '#a8a4c5',
      nodeTextFill: '#e0def4',
      viewportStroke: 'rgba(156, 207, 216, 0.6)'
    }
  },
  'github-light': {
    label: 'GitHub Light',
    swatch: ['#ffffff', '#0969da'],
    export: {
      bg: '#ffffff',
      nodeFill: '#f6f8fa',
      nodeStroke: 'rgba(89, 99, 110, 0.24)',
      startStroke: '#1a7f37',
      accStroke: '#9a6700',
      actFill: 'rgba(9, 105, 218, 0.13)',
      actStroke: '#0969da',
      edgeStroke: '#8c959f',
      textFill: '#59636e',
      nodeTextFill: '#1f2328',
      viewportStroke: 'rgba(9, 105, 218, 0.48)'
    }
  },
  'github-dark': {
    label: 'GitHub Dark',
    swatch: ['#0d1117', '#58a6ff'],
    export: {
      bg: '#0d1117',
      nodeFill: '#1c2128',
      nodeStroke: 'rgba(88, 166, 255, 0.24)',
      startStroke: '#3fb950',
      accStroke: '#d29922',
      actFill: 'rgba(88, 166, 255, 0.2)',
      actStroke: '#58a6ff',
      edgeStroke: '#6e7681',
      textFill: '#9198a1',
      nodeTextFill: '#e6edf3',
      viewportStroke: 'rgba(88, 166, 255, 0.6)'
    }
  },
  sepia: {
    label: 'Sepia',
    swatch: ['#f4ecd8', '#a0522d'],
    export: {
      bg: '#f4ecd8',
      nodeFill: '#f2e8d0',
      nodeStroke: 'rgba(122, 105, 82, 0.24)',
      startStroke: '#6b8e4e',
      accStroke: '#b8860b',
      actFill: 'rgba(160, 82, 45, 0.13)',
      actStroke: '#a0522d',
      edgeStroke: '#a08f72',
      textFill: '#7a6952',
      nodeTextFill: '#4b3621',
      viewportStroke: 'rgba(160, 82, 45, 0.48)'
    }
  },
  'high-contrast': {
    label: 'High Contrast',
    swatch: ['#000000', '#00d9ff'],
    export: {
      bg: '#000000',
      nodeFill: '#1a1a1a',
      nodeStroke: 'rgba(0, 217, 255, 0.24)',
      startStroke: '#00ff9c',
      accStroke: '#ffd60a',
      actFill: 'rgba(0, 217, 255, 0.2)',
      actStroke: '#00d9ff',
      edgeStroke: '#a0a0a0',
      textFill: '#e0e0e0',
      nodeTextFill: '#ffffff',
      viewportStroke: 'rgba(0, 217, 255, 0.6)'
    }
  },
  'ayu-light': {
    label: 'Ayu Light',
    swatch: ['#fafafa', '#ff9940'],
    export: {
      bg: '#fafafa',
      nodeFill: '#f3f3f3',
      nodeStroke: 'rgba(120, 123, 128, 0.24)',
      startStroke: '#6a8f00',
      accStroke: '#bf7e00',
      actFill: 'rgba(255, 153, 64, 0.13)',
      actStroke: '#ff9940',
      edgeStroke: '#a3a6a6',
      textFill: '#787b80',
      nodeTextFill: '#5c6166',
      viewportStroke: 'rgba(255, 153, 64, 0.48)'
    }
  },
  'ayu-dark': {
    label: 'Ayu Dark',
    swatch: ['#0a0e14', '#ffb454'],
    export: {
      bg: '#0a0e14',
      nodeFill: '#131721',
      nodeStroke: 'rgba(89, 194, 255, 0.24)',
      startStroke: '#c2d94c',
      accStroke: '#e6b450',
      actFill: 'rgba(255, 180, 84, 0.2)',
      actStroke: '#ffb454',
      edgeStroke: '#4d5566',
      textFill: '#828c99',
      nodeTextFill: '#b3b1ad',
      viewportStroke: 'rgba(255, 180, 84, 0.6)'
    }
  },
  'ayu-mirage': {
    label: 'Ayu Mirage',
    swatch: ['#1f2430', '#ffcc66'],
    export: {
      bg: '#1f2430',
      nodeFill: '#2a2f3b',
      nodeStroke: 'rgba(92, 207, 230, 0.24)',
      startStroke: '#bae67e',
      accStroke: '#ffd173',
      actFill: 'rgba(255, 204, 102, 0.2)',
      actStroke: '#ffcc66',
      edgeStroke: '#5c6773',
      textFill: '#8a9199',
      nodeTextFill: '#cbccc6',
      viewportStroke: 'rgba(255, 204, 102, 0.6)'
    }
  },
  everforest: {
    label: 'Everforest',
    swatch: ['#2d353b', '#a7c080'],
    export: {
      bg: '#2d353b',
      nodeFill: '#3d484d',
      nodeStroke: 'rgba(167, 192, 128, 0.24)',
      startStroke: '#a7c080',
      accStroke: '#dbbc7f',
      actFill: 'rgba(167, 192, 128, 0.2)',
      actStroke: '#a7c080',
      edgeStroke: '#7a8478',
      textFill: '#9da9a0',
      nodeTextFill: '#d3c6aa',
      viewportStroke: 'rgba(167, 192, 128, 0.6)'
    }
  },
  'kanagawa': {
    label: 'Kanagawa',
    swatch: ['#1f1f28', '#7e9cd8'],
    export: {
      bg: '#1f1f28',
      nodeFill: '#30303f',
      nodeStroke: 'rgba(126, 156, 216, 0.24)',
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
  'melange': {
    label: 'Melange',
    swatch: ['#292522', '#89b3b6'],
    export: {
      bg: '#292522',
      nodeFill: '#3a3531',
      nodeStroke: 'rgba(137, 179, 182, 0.24)',
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
      nodeFill: '#f5f3f1',
      nodeStroke: 'rgba(125, 102, 88, 0.24)',
      startStroke: '#3a684a',
      accStroke: '#a06d00',
      actFill: 'rgba(61, 101, 104, 0.13)',
      actStroke: '#3d6568',
      edgeStroke: '#a98a78',
      textFill: '#7d6658',
      nodeTextFill: '#54433a',
      viewportStroke: 'rgba(61, 101, 104, 0.48)'
    }
  },
  'nightfox': {
    label: 'Nightfox',
    swatch: ['#192330', '#719cd6'],
    export: {
      bg: '#192330',
      nodeFill: '#29394f',
      nodeStroke: 'rgba(113, 156, 214, 0.24)',
      startStroke: '#81b29a',
      accStroke: '#dbc074',
      actFill: 'rgba(113, 156, 214, 0.2)',
      actStroke: '#719cd6',
      edgeStroke: '#71839b',
      textFill: '#aeafb0',
      nodeTextFill: '#cdcecf',
      viewportStroke: 'rgba(113, 156, 214, 0.6)'
    }
  },
  'dayfox': {
    label: 'Dayfox',
    swatch: ['#f6f2ee', '#2848a9'],
    export: {
      bg: '#f6f2ee',
      nodeFill: '#f7f3ef',
      nodeStroke: 'rgba(100, 63, 97, 0.24)',
      startStroke: '#396847',
      accStroke: '#ac5402',
      actFill: 'rgba(40, 72, 169, 0.13)',
      actStroke: '#2848a9',
      edgeStroke: '#837a72',
      textFill: '#643f61',
      nodeTextFill: '#3d2b5a',
      viewportStroke: 'rgba(40, 72, 169, 0.48)'
    }
  },
  cyberpunk: {
    label: 'Cyberpunk',
    swatch: ['#1a0a10', '#00bfff'],
    export: {
      bg: '#1a0a10',
      nodeFill: '#331b26',
      nodeStroke: 'rgba(0, 191, 255, 0.24)',
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
    swatch: ['#08080a', '#6f6fff'],
    export: {
      bg: '#08080a',
      nodeFill: '#202026',
      nodeStroke: 'rgba(111, 111, 255, 0.24)',
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
      nodeFill: '#f9eeee',
      nodeStroke: 'rgba(107, 90, 96, 0.24)',
      startStroke: '#4f7a42',
      accStroke: '#b07d0a',
      actFill: 'rgba(35, 93, 139, 0.13)',
      actStroke: '#235d8b',
      edgeStroke: '#a08f96',
      textFill: '#6b5a60',
      nodeTextFill: '#241d20',
      viewportStroke: 'rgba(35, 93, 139, 0.48)'
    }
  },
  'japan-night': {
    label: 'Japan Night',
    swatch: ['#0d1020', '#b44dff'],
    export: {
      bg: '#0d1020',
      nodeFill: '#212640',
      nodeStroke: 'rgba(180, 77, 255, 0.24)',
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
      nodeFill: '#faeff9',
      nodeStroke: 'rgba(122, 92, 128, 0.24)',
      startStroke: '#1f8a6d',
      accStroke: '#a8780c',
      actFill: 'rgba(157, 63, 196, 0.13)',
      actStroke: '#9d3fc4',
      edgeStroke: '#a289a8',
      textFill: '#7a5c80',
      nodeTextFill: '#3d2a44',
      viewportStroke: 'rgba(157, 63, 196, 0.48)'
    }
  },
  india: {
    label: 'India',
    swatch: ['#12132a', '#00b3a4'],
    export: {
      bg: '#12132a',
      nodeFill: '#282b52',
      nodeStroke: 'rgba(0, 179, 164, 0.24)',
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
      nodeFill: '#24382b',
      nodeStroke: 'rgba(108, 194, 161, 0.24)',
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
    swatch: ['#edf1f1', '#0f7a8c'],
    export: {
      bg: '#edf1f1',
      nodeFill: '#eaf0f0',
      nodeStroke: 'rgba(77, 102, 111, 0.24)',
      startStroke: '#3d7a4f',
      accStroke: '#96701a',
      actFill: 'rgba(15, 122, 140, 0.13)',
      actStroke: '#0f7a8c',
      edgeStroke: '#7f959c',
      textFill: '#4d666f',
      nodeTextFill: '#1e2f36',
      viewportStroke: 'rgba(15, 122, 140, 0.48)'
    }
  },
  space: {
    label: 'Space',
    swatch: ['#060814', '#6fa8ff'],
    export: {
      bg: '#060814',
      nodeFill: '#1a1f42',
      nodeStroke: 'rgba(111, 168, 255, 0.24)',
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
    swatch: ['#eef3f7', '#1f7a9c'],
    export: {
      bg: '#eef3f7',
      nodeFill: '#eaf1f6',
      nodeStroke: 'rgba(74, 98, 116, 0.24)',
      startStroke: '#3f7a3a',
      accStroke: '#9a6f12',
      actFill: 'rgba(31, 122, 156, 0.13)',
      actStroke: '#1f7a9c',
      edgeStroke: '#7d94a6',
      textFill: '#4a6274',
      nodeTextFill: '#1b2a38',
      viewportStroke: 'rgba(31, 122, 156, 0.48)'
    }
  }
};

export const DEFAULT_THEME = 'dark';
