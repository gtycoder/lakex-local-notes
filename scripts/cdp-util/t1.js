(() => {
  const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "同步");
  if (!b) return "no-sync";
  b.click();
  return "clicked";
})()