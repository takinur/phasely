export function submitForm(): boolean {
  const submitButton = document.querySelector('button[type="submit"], input[type="submit"]') as HTMLButtonElement | HTMLInputElement | null;

  if (!submitButton) {
    return false;
  }

  submitButton.click();
  return true;
}