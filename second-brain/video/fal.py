"""Tiny fal.ai queue helper. Usage: python3 fal.py <model> <json-args-file> <out-prefix>
Auth header is injected by the session proxy; the placeholder below is overwritten."""
import json, sys, time, requests, os

H = {"Authorization": "Key proxy-injected", "Content-Type": "application/json"}


def run(model, args, out_prefix, timeout=900):
    r = requests.post(f"https://queue.fal.run/{model}", headers=H, json=args, timeout=60)
    if r.status_code >= 300:
        raise SystemExit(f"submit {r.status_code}: {r.text[:500]}")
    j = r.json()
    status_url, resp_url = j["status_url"], j["response_url"]
    t0 = time.time()
    while True:
        s = requests.get(status_url, headers=H, timeout=60).json()
        if s.get("status") == "COMPLETED":
            break
        if time.time() - t0 > timeout:
            raise SystemExit("timeout")
        time.sleep(3)
    res = requests.get(resp_url, headers=H, timeout=60)
    if res.status_code >= 300:
        raise SystemExit(f"result {res.status_code}: {res.text[:800]}")
    res = res.json()
    urls = []
    for key in ("images", "video"):
        v = res.get(key)
        if isinstance(v, list):
            urls += [x["url"] for x in v]
        elif isinstance(v, dict):
            urls.append(v["url"])
    files = []
    for i, u in enumerate(urls):
        ext = os.path.splitext(u.split("?")[0])[1] or ".bin"
        fn = f"{out_prefix}{'' if len(urls) == 1 else '_' + str(i)}{ext}"
        with open(fn, "wb") as f:
            f.write(requests.get(u, timeout=300).content)
        files.append(fn)
    with open(out_prefix + ".json", "w") as f:
        json.dump({"result": res, "files": files}, f, indent=1)
    return res, files


if __name__ == "__main__":
    model, argf, out = sys.argv[1:4]
    res, files = run(model, json.load(open(argf)), out)
    print(json.dumps({"files": files, "urls": [x.get("url") for x in res.get("images", [])] or res.get("video", {}).get("url")}))
