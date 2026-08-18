export function openImagePicker(sectionId, opener) {
  const picker = document.querySelector("#detail-page-image-picker");
  if (!picker) return;
  picker.dataset.sectionId = sectionId;
  picker.dataset.openerSectionId = opener.closest("[data-editor-section]")?.dataset.sectionId ?? "";
  picker.classList.remove("is-hidden");
  picker.removeAttribute("hidden");
  (picker.querySelector("[data-detail-asset]") ?? picker.querySelector("[data-action='close-detail-image-picker']"))?.focus();
}

export function closeImagePicker(openerSectionId) {
  const picker = document.querySelector("#detail-page-image-picker");
  const sectionId = openerSectionId ?? picker?.dataset.openerSectionId;
  picker?.classList.add("is-hidden");
  picker?.setAttribute("hidden", "");
  [...document.querySelectorAll("[data-editor-section]")]
    .find((node) => node.dataset.sectionId === sectionId)
    ?.querySelector("[data-action='open-detail-image-picker']")
    ?.focus();
}

export function sectionIdFromPicker() {
  return document.querySelector("#detail-page-image-picker")?.dataset.sectionId;
}
