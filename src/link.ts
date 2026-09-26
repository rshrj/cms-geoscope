import { encode, type ViewState } from './share';

/** Keep the address bar in step with the view, and copy it on request. */
export function bindLink(getState: () => ViewState, paused: () => boolean) {
  const hash = () => `#${encode(getState())}`;
  let last = '';
  setInterval(() => {
    if (paused()) return;
    const h = hash();
    if (h !== last) {
      last = h;
      history.replaceState(null, '', h);
    }
  }, 400);

  return async function share(button: HTMLElement) {
    history.replaceState(null, '', hash());
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = 'Link copied';
    } catch {
      prompt('Copy this link', url);
    }
    setTimeout(() => {
      button.textContent = 'Share link';
    }, 1600);
  };
}
