import "@testing-library/jest-dom";

// jsdom doesn't implement the <dialog> modal methods. Components (CinemaSheet,
// SeenResetDialog) call showModal()/close() in an effect keyed off an `open`-
// like prop; stub them so those effects don't throw in tests that trigger them.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
