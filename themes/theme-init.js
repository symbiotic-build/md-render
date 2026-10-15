(() => {
  try {
    const theme = localStorage.getItem('md-render-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (error) { console.warn('Theme preference could not be read; using System.', error); }
})();
