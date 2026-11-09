"""fal.ai queue helper: submit a job, wait for it, download the results.

The session's network proxy adds the real API key; the placeholder below is overwritten.
Downloads come from v3.fal.media / v3b.fal.media (allowed on the environment).
"""
import base64, json, mimetypes, os, time
import requests

H = {"Authorization": "Key proxy-injected", "Content-Type": "application/json"}


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def _once(model, args, out_prefix, timeout):
    r = requests.post(f"https://queue.fal.run/{model}", headers=H, json=args, timeout=120)
    if r.status_code >= 300:
        raise RuntimeError(f"{model} submit {r.status_code}: {r.text[:400]}")
    j = r.json()
    t0 = time.time()
    while True:
        s = requests.get(j["status_url"], headers=H, timeout=60).json()
        if s.get("status") == "COMPLETED":
            break
        if time.time() - t0 > timeout:
            raise RuntimeError(f"{model} timed out after {timeout}s")
        time.sleep(4)
    res = requests.get(j["response_url"], headers=H, timeout=120)
    if res.status_code >= 300:
        raise RuntimeError(f"{model} result {res.status_code}: {res.text[:600]}")
    res = res.json()
    urls = []
    for key in ("images", "video"):
        v = res.get(key)
        if isinstance(v, list):
            urls += [x["url"] for x in v]
        elif isinstance(v, dict) and v.get("url"):
            urls.append(v["url"])
    if not urls:
        raise RuntimeError(f"{model} returned no files: {json.dumps(res)[:400]}")
    files = []
    for i, u in enumerate(urls):
        ext = os.path.splitext(u.split("?")[0])[1] or ".bin"
        fn = f"{out_prefix}{'' if len(urls) == 1 else '_' + str(i)}{ext}"
        with open(fn, "wb") as f:
            f.write(requests.get(u, timeout=300).content)
        files.append(fn)
    with open(out_prefix + ".json", "w") as f:
        json.dump({"model": model, "result": res, "files": files}, f, indent=1)
    return files


def run(model, args, out_prefix, timeout=1200, tries=2):
    """Run a fal model; retry once on failure. Returns the downloaded file paths."""
    err = None
    for k in range(tries):
        try:
            return _once(model, args, out_prefix, timeout)
        except Exception as e:  # network hiccup, model error, out of credit...
            err = e
            if "credit" in str(e).lower() or "balance" in str(e).lower():
                break
            time.sleep(6 * (k + 1))
    raise err
