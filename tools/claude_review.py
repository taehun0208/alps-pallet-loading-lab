"""Send a local UTF-8 prompt to Anthropic, without logging credentials.

Usage: python3 tools/claude_review.py prompt.txt output.json
Loads the project-root .env as literal KEY=VALUE entries, without shell execution.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-tokens", type=int, default=None)
    parser.add_argument("--timeout", type=int, default=None)
    parser.add_argument("--stream", action="store_true", help="Read SSE for large output budgets")
    parser.add_argument("--continue-until-complete", action="store_true", help="Continue truncated text until end_turn")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    values = {}
    for line in (root / ".env").read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip("\"'")
    key = values.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    model = values.get("ANTHROPIC_MODEL")
    if not key or not model:
        sys.exit("Missing ANTHROPIC_API_KEY or ANTHROPIC_MODEL in .env")
    if args.output.exists():
        sys.exit("Output already exists; choose a new path.")
    body = {
        "model": model,
        "max_tokens": args.max_tokens or int(values.get("ANTHROPIC_MAX_TOKENS", "4096")),
        "messages": [{"role": "user", "content": args.prompt.read_text()}],
    }
    body["stream"] = args.stream
    args.output.parent.mkdir(parents=True, exist_ok=True)
    parts = []
    while True:
        request = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(body).encode(),
            headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(
                request, timeout=args.timeout or int(values.get("ANTHROPIC_TIMEOUT_SECONDS", "60"))
            ) as response:
                result = read_stream(response) if args.stream else json.load(response)
        except urllib.error.HTTPError as error:
            sys.exit(f"Anthropic HTTP {error.code}; credentials and response body omitted.")
        except (urllib.error.URLError, TimeoutError):
            sys.exit("Anthropic connection failed (network/DNS/timeout); credentials omitted.")
        parts.append(result)
        part_path = args.output.with_name(args.output.stem + f".part-{len(parts)}.json")
        with part_path.open("x") as output:
            json.dump(result, output, ensure_ascii=False, indent=2)
        print(json.dumps({"model": result.get("model"), "usage": result.get("usage"),
                          "stop_reason": result.get("stop_reason"), "saved": str(part_path)},
                         ensure_ascii=False), flush=True)
        if not args.continue_until_complete or result.get("stop_reason") != "max_tokens":
            break
        text = "\n".join(block["text"] for block in result.get("content", []) if block.get("type") == "text")
        if text:
            body["messages"].extend([{"role":"assistant", "content":text},
                                     {"role":"user", "content":"Continue the unfinished review from where it stopped, without repeating completed content."}])
        else:
            # No final text is available to continue. Do not expose internal reasoning;
            # request the concrete findings again with the same full output budget.
            body["messages"].append({"role":"user", "content":"The previous request exhausted its output budget without a final answer. Return your concrete review findings now."})
    final = parts[0] if len(parts) == 1 else {"model":model, "stop_reason":parts[-1].get("stop_reason"), "parts":parts,
        "content":[block for part in parts for block in part.get("content", []) if block.get("type") == "text"]}
    with args.output.open("x") as output:
        json.dump(final, output, ensure_ascii=False, indent=2)


def read_stream(response):
    result = None
    for raw in response:
        line = raw.decode("utf-8").strip()
        if not line.startswith("data:"):
            continue
        event = json.loads(line[5:].strip())
        kind = event.get("type")
        if kind == "error":
            raise RuntimeError("Anthropic streaming error; response body omitted")
        if kind == "message_start":
            result = event["message"]
            result["content"] = []
        elif kind == "content_block_start" and result is not None:
            result["content"].append(event["content_block"])
        elif kind == "content_block_delta" and result is not None:
            block = result["content"][event["index"]]
            delta = event["delta"]
            for key in ("text", "thinking", "signature"):
                if key in delta:
                    block[key] = block.get(key, "") + delta[key]
        elif kind == "message_delta" and result is not None:
            result.update(event["delta"])
            result.setdefault("usage", {}).update(event.get("usage", {}))
        elif kind == "message_stop":
            return result
    raise RuntimeError("Incomplete Anthropic stream; no final message_stop")


if __name__ == "__main__":
    main()
