"""Download public test inputs without executing or altering their content."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib, json, time, urllib.request

ROOT = Path(__file__).resolve().parents[1] / "qa" / "samples"
ROOT.mkdir(parents=True, exist_ok=True)
COURSE = "https://www.cs.cmu.edu/~16385/"
SAMPLES = [
    {"id": f"cmu-lecture-{i}", "url": f"{COURSE}lectures/lecture{i}.pptx", "source": COURSE, "kind": "pptx"}
    for i in range(1, 5)
] + [
    {"id": "dsu-korean", "url": "https://cess.dsu.ac.kr/lifelong/index.php?idx=2039&mode=fdn&num=1&pCode=lecture", "source": "https://cess.dsu.ac.kr/lifelong/index.php?idx=2039&mode=view&pCode=lecture", "kind": "pptx"},
] + [
    {"id": f"cmu-lecture-{i}", "url": f"{COURSE}lectures/lecture{i}.pdf", "source": COURSE, "kind": "pdf"}
    for i in range(1, 5)
]
SAMPLES += json.loads((ROOT.parent / "workplace-samples.json").read_text())

def fetch(sample):
    result = dict(sample)
    target = ROOT / f"{sample['id']}.{sample['kind']}"
    started = time.monotonic()
    try:
        if not target.exists():
            request = urllib.request.Request(sample["url"], headers={"User-Agent": "SlideStudio-QA/1.0", "Referer": sample["source"]})
            with urllib.request.urlopen(request, timeout=45) as response:
                result["final_url"] = response.url
                result["content_type"] = response.headers.get("Content-Type")
                length = int(response.headers.get("Content-Length", "0"))
                if length > 200 * 1024 * 1024:
                    raise ValueError(f"Download exceeds test acquisition cap: {length} bytes")
                temporary = target.with_suffix(target.suffix + ".partial")
                total = 0
                with temporary.open("wb") as output:
                    while chunk := response.read(1024 * 1024):
                        total += len(chunk)
                        if total > 200 * 1024 * 1024:
                            raise ValueError("Download exceeds test acquisition cap")
                        output.write(chunk)
                temporary.replace(target)
        data = target.read_bytes()
        expected = b"PK" if sample["kind"] == "pptx" else b"%PDF"
        if not data.startswith(expected):
            raise ValueError("Response is not the expected document format")
        if sample.get("sha256") and hashlib.sha256(data).hexdigest() != sample["sha256"]:
            raise ValueError("Public sample changed; review and update its pinned fixture before testing")
        result.update(path=str(target), bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), status="downloaded")
    except Exception as error:
        result.update(status="failed", error=str(error))
    result["elapsed_seconds"] = round(time.monotonic() - started, 2)
    print(json.dumps({k: result[k] for k in ["id", "kind", "status", "elapsed_seconds"]} | {k: result[k] for k in ["bytes", "error"] if k in result}), flush=True)
    return result

with ThreadPoolExecutor(max_workers=3) as pool:
    results = list(pool.map(fetch, SAMPLES))
(ROOT / "sources.json").write_text(json.dumps({"downloaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "samples": results}, ensure_ascii=False, indent=2))
