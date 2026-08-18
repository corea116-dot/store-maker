function localHeaders(extra = {}) {
  const token = document.querySelector("meta[name='store-maker-token']")?.content;
  return token ? { ...extra, "x-store-maker-token": token } : extra;
}

export async function getDetailPageProject(projectUrl) {
  const response = await fetch(projectUrl, { headers: localHeaders() });
  const payload = await readPayload(response);
  if (!response.ok) throw requestError(response, payload);
  return payload;
}

export async function saveDetailPageProject(projectUrl, expectedRevision, documentValue) {
  const response = await fetch(projectUrl, {
    method: "PUT",
    headers: localHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ expectedRevision, document: documentValue }),
  });
  const payload = await readPayload(response);
  if (response.status === 409 && payload.error?.code === "REVISION_CONFLICT") {
    return { conflict: true, payload };
  }
  if (!response.ok) throw requestError(response, payload);
  return { conflict: false, payload };
}

export async function copyDetailPageJson(value) {
  const text = JSON.stringify(value, null, 2);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("브라우저가 클립보드 복사를 허용하지 않았습니다.");
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch (error) {
    return { error: { message: `HTTP ${response.status}` } };
  }
}

function requestError(response, payload) {
  const error = new Error(payload.error?.message ?? `HTTP ${response.status}`);
  error.status = response.status;
  error.code = payload.error?.code;
  return error;
}
