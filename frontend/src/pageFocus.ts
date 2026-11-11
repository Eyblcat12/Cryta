export function schedulePageTitleFocus() {
  const previousFocus = document.activeElement;
  let pendingHeading: MutationObserver | undefined;
  const focusTitle = () => {
    const currentFocus = document.activeElement;
    const focusChanged = currentFocus !== previousFocus && currentFocus !== document.body;
    const editing = currentFocus instanceof HTMLElement &&
      currentFocus.matches('input, textarea, select, [contenteditable="true"]');
    const contentControl = currentFocus instanceof HTMLElement &&
      currentFocus.closest('#main-content') &&
      currentFocus.matches('button, a[href], [role="button"], [role="textbox"]');
    if (focusChanged || editing || contentControl ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) {
      pendingHeading?.disconnect();
      return;
    }
    const title = document.getElementById('page-title');
    if (title) {
      pendingHeading?.disconnect();
      title.focus({ preventScroll: true });
    } else if (!pendingHeading) {
      const main = document.getElementById('main-content');
      if (!main) return;
      // Lazy pages can commit their heading after the initial navigation frame.
      pendingHeading = new MutationObserver(focusTitle);
      pendingHeading.observe(main, { childList: true, subtree: true });
    }
  };
  const frame = window.requestAnimationFrame(focusTitle);
  return () => {
    window.cancelAnimationFrame(frame);
    pendingHeading?.disconnect();
  };
}
