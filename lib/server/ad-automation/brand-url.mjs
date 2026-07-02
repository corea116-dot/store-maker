import { readObject } from "./utils.mjs";

export function readBrandInput(value) {
  const input = readObject(value);
  const normalized = normalizeBrandUrl(input.url);
  return {
    url: normalized.brandUrl,
    source: {
      brandUrl: normalized.brandUrl,
      urlSafety: normalized.urlSafety,
      snapshotStatus: "skipped",
      generatedAt: new Date().toISOString(),
      confidence: normalized.brandUrl ? (normalized.urlSafety.safeForFutureFetch ? 0.48 : 0.36) : 0.28,
    },
    warnings: normalized.warnings,
  };
}

function normalizeBrandUrl(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) return absentBrandUrl();

  let url;
  try {
    url = new URL(raw);
  } catch {
    return invalidBrandUrl("URL 형식이 올바르지 않습니다.", "브랜드 URL 형식을 해석할 수 없어 상품 정보 기준으로 Brand DNA를 추정했습니다.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return invalidBrandUrl("http 또는 https URL만 참조할 수 있습니다.", "지원하지 않는 URL 형식이어서 브랜드 URL을 결과에 포함하지 않았습니다.");
  }

  const stripped = Boolean(url.username || url.password || url.search || url.hash);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const unsafeReason = unsafeHostReason(url.hostname);
  if (unsafeReason) {
    return {
      brandUrl: url.toString(),
      urlSafety: { status: "unsafe-for-future-fetch", safeForFutureFetch: false, reason: unsafeReason },
      warnings: ["브랜드 URL은 참조 문자열로만 보관했고, 향후 자동 가져오기는 차단해야 합니다."],
    };
  }

  return {
    brandUrl: url.toString(),
    urlSafety: {
      status: "safe-reference",
      safeForFutureFetch: true,
      reason: stripped
        ? "URL의 자격 정보, query, fragment를 제외한 참조 주소만 사용했습니다."
        : "공개 참조 주소 형식입니다. Phase 1에서는 페이지를 가져오지 않습니다.",
    },
    warnings: stripped ? ["브랜드 URL의 부가 파라미터는 저장/전달하지 않았습니다."] : [],
  };
}

function absentBrandUrl() {
  return {
    brandUrl: null,
    urlSafety: { status: "absent", safeForFutureFetch: false, reason: "브랜드 URL이 제공되지 않았습니다." },
    warnings: ["브랜드 URL이 없어 상품 정보와 첨부 자료 기준으로 Brand DNA를 추정했습니다."],
  };
}

function invalidBrandUrl(reason, warning) {
  return {
    brandUrl: null,
    urlSafety: { status: "invalid", safeForFutureFetch: false, reason },
    warnings: [warning],
  };
}

function unsafeHostReason(hostname) {
  const host = stripIpv6Brackets(String(hostname ?? "").toLowerCase());
  if (host === "localhost" || host.endsWith(".local")) return "로컬 또는 사설 호스트는 자동 가져오기 대상이 아닙니다.";
  const mappedIpv4 = host.includes(":") ? ipv4MappedAddress(host) : undefined;
  const ipv4Reason = unsafeIpv4Reason(mappedIpv4 ?? host);
  if (ipv4Reason) return ipv4Reason;
  if (host.includes(":")) return unsafeIpv6Reason(host);
  return undefined;
}

function unsafeIpv4Reason(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return undefined;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  if (parts[0] === 0) return "미지정 IPv4 주소는 자동 가져오기 대상이 아닙니다.";
  if (parts[0] === 127) return "루프백 IPv4 주소는 자동 가져오기 대상이 아닙니다.";
  if (parts[0] === 10) return "사설 IPv4 주소는 자동 가져오기 대상이 아닙니다.";
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return "사설 IPv4 주소는 자동 가져오기 대상이 아닙니다.";
  if (parts[0] === 192 && parts[1] === 168) return "사설 IPv4 주소는 자동 가져오기 대상이 아닙니다.";
  if (parts[0] === 169 && parts[1] === 254) return "링크 로컬 주소는 자동 가져오기 대상이 아닙니다.";
  return undefined;
}

function unsafeIpv6Reason(host) {
  const first = Number.parseInt(host.split(":")[0] || "0", 16);
  if (host === "::" || host === "0:0:0:0:0:0:0:0") return "미지정 IPv6 주소는 자동 가져오기 대상이 아닙니다.";
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "루프백 주소는 자동 가져오기 대상이 아닙니다.";
  if (Number.isInteger(first) && (first & 0xfe00) === 0xfc00) return "사설 IPv6 주소는 자동 가져오기 대상이 아닙니다.";
  if (Number.isInteger(first) && (first & 0xffc0) === 0xfe80) return "링크 로컬 주소는 자동 가져오기 대상이 아닙니다.";
  return undefined;
}

function ipv4MappedAddress(host) {
  if (!host.startsWith("::ffff:")) return undefined;
  const tail = host.slice("::ffff:".length);
  if (tail.includes(".")) return tail;
  const groups = tail.split(":");
  if (groups.length !== 2) return undefined;
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return undefined;
  return [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255].join(".");
}

function stripIpv6Brackets(hostname) {
  return hostname.replace(/^\[/u, "").replace(/\]$/u, "");
}
