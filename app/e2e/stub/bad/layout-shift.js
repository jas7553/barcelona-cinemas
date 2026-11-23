// Late content pushed in above everything, as a late banner or a regrouped list would.
addEventListener("load", () => {
  setTimeout(() => {
    const banner = document.createElement("p");
    banner.textContent = "A banner that arrived late.";
    document.body.prepend(banner);
  }, 300);
});
