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
const Themes = {
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
  monokai: {
    label: 'Monokai',
    swatch: ['#272822', '#66d9ef'],
    export: {
      bg: '#272822',
      nodeFill: '#49483e',
      nodeStroke: 'rgba(102, 217, 239, 0.24)',
      startStroke: '#a6e22e',
      accStroke: '#e6db74',
      actFill: 'rgba(102, 217, 239, 0.2)',
      actStroke: '#66d9ef',
      edgeStroke: '#8f9081',
      textFill: '#c2c2bc',
      nodeTextFill: '#f8f8f2',
      viewportStroke: 'rgba(102, 217, 239, 0.6)'
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
      startStroke: '#86b300',
      accStroke: '#f2ae49',
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
  material: {
    label: 'Material',
    swatch: ['#292d3e', '#82aaff'],
    export: {
      bg: '#292d3e',
      nodeFill: '#3a3f58',
      nodeStroke: 'rgba(130, 170, 255, 0.24)',
      startStroke: '#c3e88d',
      accStroke: '#ffcb6b',
      actFill: 'rgba(130, 170, 255, 0.2)',
      actStroke: '#82aaff',
      edgeStroke: '#676e95',
      textFill: '#a6accd',
      nodeTextFill: '#eeffff',
      viewportStroke: 'rgba(130, 170, 255, 0.6)'
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
  }
};

const DEFAULT_THEME = 'dark';
