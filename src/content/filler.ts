export function fillField(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}