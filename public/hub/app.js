const copyUrlButton = document.querySelector('#copyUrlButton');

copyUrlButton?.addEventListener('click', async () => {
  const url = window.location.href;

  try {
    await navigator.clipboard.writeText(url);
    const originalText = copyUrlButton.textContent;
    copyUrlButton.textContent = 'Adresse copiée ✓';
    setTimeout(() => {
      copyUrlButton.textContent = originalText;
    }, 1800);
  } catch (error) {
    window.prompt('Copiez l’adresse du Hub :', url);
  }
});
