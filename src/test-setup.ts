import "@testing-library/jest-dom/vitest";

// jsdom lacks the <dialog> modal methods (Sheet).
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

// jsdom lacks scrollIntoView.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
