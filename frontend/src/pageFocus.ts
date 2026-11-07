export function schedulePageTitleFocus() {
  const previousFocus = document.activeElement;
  const frame = window.requestAnimationFrame(() => {
    const currentFocus = document.activeElement;
    const focusChanged = currentFocus !== previousFocus && currentFocus !== document.body;
    const editing = currentFocus instanceof HTMLElement &&
      currentFocus.matches('input, textarea, select, [contenteditable="true"]');
    const contentControl = currentFocus instanceof HTMLElement &&
      currentFocus.closest('#main-content') &&
      currentFocus.matches('button, a[href], [role="button"], [role="textbox"]');
    if (focusChanged || editing || contentControl ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    document.getElementById('page-title')?.focus({ preventScroll: true });
  });
  return () => window.cancelAnimationFrame(frame);
}
