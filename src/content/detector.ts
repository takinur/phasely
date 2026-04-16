export type DetectedField = {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  score: number;
  label?: string;
};

export function detectFields(): DetectedField[] {
  return [];
}