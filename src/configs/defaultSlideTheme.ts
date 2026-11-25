import type { SlideTheme } from '@/types/slides'

export function createDefaultSlideTheme(): SlideTheme {
  return {
    themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
    fontColor: '#333',
    fontName: '',
    backgroundColor: '#fff',
    shadow: {
      h: 3,
      v: 3,
      blur: 2,
      color: '#808080',
    },
    outline: {
      width: 2,
      color: '#525252',
      style: 'solid',
    },
  }
}
