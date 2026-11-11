import { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useBeforeUnload, useBlocker } from 'react-router';

export function useUnsavedChanges(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty
    && `${currentLocation.pathname}${currentLocation.search}`
      !== `${nextLocation.pathname}${nextLocation.search}`,
  );

  useBeforeUnload(useCallback((event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }, [dirty]));

  return blocker;
}

export function UnsavedChangesDialog({
  open,
  onStay,
  onDiscard,
}: {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stayRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onStay();
      }
      if(event.key==='Tab'){
        const buttons=Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button')??[]);
        const first=buttons[0],last=buttons.at(-1);
        if(!dialogRef.current?.contains(document.activeElement)||(event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)){
          event.preventDefault();(event.shiftKey?last:first)?.focus();
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.requestAnimationFrame(() => previous?.focus());
    };
  }, [onStay, open]);

  if (!open) return null;
  return <div className="modal-layer unsaved-layer" role="presentation">
    <button className="modal-scrim" onClick={onStay} aria-label="Ở lại biểu mẫu" />
    <section ref={dialogRef} className="decision-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-description">
      <header>
        <div><p className="eyebrow">Dữ liệu chưa lưu</p><h2 id="unsaved-title">Bỏ các thay đổi đang nhập?</h2><span id="unsaved-description">Nếu rời trang bây giờ, nội dung chưa gửi sẽ không được lưu.</span></div>
        <AlertTriangle size={22} aria-hidden="true" />
      </header>
      <footer>
        <button ref={stayRef} className="secondary-button" onClick={onStay}>Ở lại</button>
        <button className="danger-button" onClick={onDiscard}>Bỏ thay đổi</button>
      </footer>
    </section>
  </div>;
}
