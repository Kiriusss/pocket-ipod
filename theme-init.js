// Apply the saved appearance before the stylesheet paints. Music stays untouched.
try {
  const preference = JSON.parse(localStorage.getItem('pocket-preferences') || '{}');
  const theme = ['light', 'dark'].includes(preference?.theme)
    ? preference.theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#141615' : '#eeede7';
} catch {
  document.documentElement.dataset.theme = 'light';
}
