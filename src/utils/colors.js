// Chart palette. Colors are assigned to categories in a FIXED order so a category keeps
// its color everywhere (and doesn't change when filters change). These hues were checked
// for color-blind separation; the dark set is the same hues re-stepped for dark backgrounds.

export const PALETTE = {
  light: {
    series: [
      '#2a78d6',
      '#eb6834',
      '#1baf7a',
      '#eda100',
      '#e87ba4',
      '#008300',
      '#6250d6',
      '#e34948',
    ],
    other: '#8a8984', // gray for "Other" / neutral reference lines
    grid: '#e3ebe7',
    axis: '#46574f',
  },
  dark: {
    series: [
      '#3987e5',
      '#d95926',
      '#199e70',
      '#c98500',
      '#d55181',
      '#008300',
      '#9085e9',
      '#e66767',
    ],
    other: '#8a8984',
    grid: '#24332e',
    axis: '#a8b8b1',
  },
};

// Human-friendly names for the 8 series slots, in the same order (used in color pickers).
export const SERIES_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Pink', 'Green', 'Violet', 'Red'];

export const getPalette = (scheme) => PALETTE[scheme] ?? PALETTE.light;
