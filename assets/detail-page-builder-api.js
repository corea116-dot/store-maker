function localHeaders(extra = {}) {
  const token = document.querySelector("meta[name='store-maker-token']")?.content;
  return token ? { ...extra, "x-store-maker-token": token } : extra;
}

export async function getDetailPageBuilderRegistry() {
  return request("/api/detail-page-builder/registry");
}

export async function createDetailPageBuilderCandidate(projectId, body) {
  return request(candidateCollectionUrl(projectId), { method: "POST", body });
}

export async function getDetailPageBuilderCandidate(projectId, candidateId) {
  return request(candidateUrl(projectId, candidateId));
}

export async function cancelDetailPageBuilderCandidate(projectId, candidateId) {
  return request(candidateUrl(projectId, candidateId), { method: "DELETE" });
}

export async function regenerateDetailPageBuilderCandidate(projectId, candidateId, body = {}) {
  return request(`${candidateUrl(projectId, candidateId)}/regenerate`, { method: "POST", body });
}

export async function materializeDetailPageBuilderCandidate(projectId, candidateId) {
  return request(`${candidateUrl(projectId, candidateId)}/materialize`, { method: "POST", body: {} });
}

async function request(url, options = {}) {
  const hasBody = options.body !== undefined;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: localHeaders(hasBody ? { "content-type": "application/json" } : {}),
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw requestError(response, payload);
  return payload;
}

function candidateCollectionUrl(projectId) {
  return `/api/detail-page-projects/${encodeURIComponent(projectId)}/builder-candidates`;
}

function candidateUrl(projectId, candidateId) {
  return `${candidateCollectionUrl(projectId)}/${encodeURIComponent(candidateId)}`;
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch (error) {
    return { error: { message: `HTTP ${response.status}` } };
  }
}

function requestError(response, payload) {
  const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  error.status = response.status;
  error.code = payload?.error?.code;
  return error;
}
