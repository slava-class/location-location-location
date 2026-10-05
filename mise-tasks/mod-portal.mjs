const origin = "https://mods.factorio.com";
const sha1 = /^[a-f0-9]{40}$/;
const errorCodes = new Set(["InvalidApiKey", "InvalidRequest", "InternalError", "Forbidden", "Unknown", "InvalidModRelease", "InvalidModUpload", "UnknownMod", "InvalidImageUpload"]);

export class ModPortal {
  constructor(transport = fetch) { this.transport = transport; }
  async request(url, label, {fields, key, body} = {}) {
    if (fields) {
      body = new FormData();
      for (const [name, value] of Object.entries(fields)) body.set(name, value);
    }
    let response;
    try {
      response = await this.transport(url, {method: body ? "POST" : "GET", body,
        headers: key ? {Authorization: `Bearer ${key}`} : {}, redirect: "error"});
    } catch {
      // Fetch errors can contain credentials or signed upload URLs. Never echo them.
      throw new Error(`${label}: transport failed; any attempted mutation has an unknown outcome`);
    }
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}; check Portal status before another mutation`);
    let data;
    try { data = await response.json(); } catch { throw new Error(`${label}: invalid JSON response; outcome unconfirmed`); }
    if (!data || typeof data !== "object") throw new Error(`${label}: invalid response object`);
    if (data.error) {
      const code = errorCodes.has(data.error) ? data.error : "UnrecognizedError";
      throw new Error(`${label}: ${code}`);
    }
    return data;
  }
  async metadata(mod) {
    const data = await this.request(`${origin}/api/mods/${encodeURIComponent(mod)}/full`, "Portal readback");
    if (data.name !== mod || !Array.isArray(data.releases) || !Array.isArray(data.images)) throw new Error("Portal metadata has an unexpected mod ID or shape");
    return data;
  }
  async upload(kind, mod, file, key) {
    const release = kind === "release";
    if (!release && kind !== "image") throw new Error("Unknown Portal upload kind");
    const path = release ? "releases/init_upload" : "images/add";
    const label = release ? "Release upload" : `Image upload ${file.file}`;
    const init = await this.request(`${origin}/api/v2/mods/${path}`, `${label} initialization`, {fields: {mod}, key});
    let url;
    try { url = new URL(init.upload_url); } catch { throw new Error(`${label}: invalid upload URL`); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${label}: upload URL must use HTTPS without embedded credentials`);
    const body = new FormData();
    body.set(release ? "file" : "image", new Blob([file.bytes], {type: release ? "application/zip" : "image/png"}), file.file);
    // The Portal delegates uploads with a signed URL. The API key stays on the init endpoint.
    const data = await this.request(url.href, label, {body});
    if (release) {
      if (data?.success !== true) throw new Error(`${label}: success not confirmed`);
    } else if (!sha1.test(data?.id) || data.id !== file.sha1) {
      throw new Error(`${label}: returned image ID differs from uploaded SHA1`);
    }
    return data;
  }
  async gallery(mod, ids, key) {
    if (!ids.length || ids.some(id => !sha1.test(id)) || new Set(ids).size !== ids.length) throw new Error("Gallery needs distinct SHA1 image IDs");
    const data = await this.request(`${origin}/api/v2/mods/images/edit`, "Gallery ordering", {fields: {mod, images: ids.join(",")}, key});
    if (data.success !== true || !Array.isArray(data.images) || data.images.map(image => image.id).join(",") !== ids.join(",")) throw new Error("Gallery ordering was not confirmed by the API");
    return data;
  }
  async listing(mod, fields, key) {
    const data = await this.request(`${origin}/api/v2/mods/edit_details`, "Listing update", {fields: {mod, ...fields}, key});
    if (data.success !== true) throw new Error("Listing update was not confirmed by the API");
    return data;
  }
}
