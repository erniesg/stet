export function setManagedVisibility(
  element: HTMLElement,
  visible: boolean,
  displayValue: string,
): void {
  element.hidden = !visible;
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  element.style.setProperty('display', visible ? displayValue : 'none', 'important');
}
